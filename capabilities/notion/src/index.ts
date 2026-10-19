// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Notion capability (Phase 67): announces when a page or database YOU LIST BY ID is edited.
// Read-only and GET-only. Notion's search and query endpoints are POST requests, so Phoenix does
// not use them: it cannot discover "recently edited pages", it only watches what `watch` names
// (see README). It uses ReadOnlyClient, which has no method that sends a body.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  nextDelay,
  realSleep,
  safeBaseUrl,
  ServiceError,
  startPolling,
  type ReadOnlyClient,
  type ServiceItem,
  type ServiceStatus,
  type Sleep,
} from "@phoenix/service-kit";
import {
  BOT_PATH,
  DEFAULT_BASE_URL,
  SECRET_NAME,
  SERVICE,
  notionClient,
  objectPath,
} from "./client";
import { ObjectDiff } from "./events";
import {
  canonicalId,
  parseBot,
  parseDatabase,
  parsePage,
  text,
  type NotionKind,
  type NotionObject,
} from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 60_000;
export const MIN_POLL_MS = 15_000;
export const MAX_WATCH = 20;
const ID_PATTERN =
  "^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$";
const NO_TOKEN_NOTE = "Add a Notion integration token in the capability's secrets";
const NO_WATCH_NOTE =
  "List the pages or databases to watch by id in `watch`; share each with your integration in Notion";

export interface NotionCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: Sleep;
  /**
   * Address of the Notion API. Code only, deliberately NOT a config setting: the token may only
   * ever be sent to Notion's own origin. Tests pass a loopback mock here.
   */
  apiUrl?: string;
}

interface Target {
  kind: NotionKind;
  /** Canonical id. */
  id: string;
}

interface Settings {
  pollMs: number;
  watch: Target[];
}

function targets(value: unknown): Target[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { type, id } = entry as { type?: unknown; id?: unknown };
    if ((type !== "page" && type !== "database") || typeof id !== "string") continue;
    const canonical = canonicalId(id);
    if (canonical === undefined || seen.has(`${type}:${canonical}`)) continue;
    seen.add(`${type}:${canonical}`);
    out.push({ kind: type, id: canonical });
    if (out.length >= MAX_WATCH) break;
  }
  return out;
}

function settings(ctx: CapabilityContext): Settings {
  const { poll_ms, watch } = ctx.config;
  return {
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
    watch: targets(watch),
  };
}

/** Failures that say nothing about one target: stop the cycle and back off. */
function endsCycle(err: ServiceError): boolean {
  return err.kind !== "not_found" && err.kind !== "forbidden" && err.kind !== "invalid";
}

function toItem(object: NotionObject): ServiceItem {
  return {
    id: object.id,
    title: object.title,
    state: object.archived ? "archived" : object.kind,
    ...(object.url ? { url: object.url } : {}),
    at: new Date(object.editedAt).toISOString(),
  };
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses `createNotionCapability()`. */
export function createNotionCapability(options: NotionCapabilityOptions = {}) {
  const checkedUrl = safeBaseUrl(options.apiUrl ?? DEFAULT_BASE_URL);
  if (checkedUrl === undefined) throw new TypeError("apiUrl must be https, or http to loopback");
  const apiUrl: string = checkedUrl;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  let client: ReadOnlyClient | undefined;
  let clientKey = "";
  let lifetime: AbortSignal | undefined;
  let diff = new ObjectDiff(0);
  let items = new Map<string, ServiceItem>();
  /** Why one watched object could not be read (never remote text). */
  let problems = new Map<string, string>();
  let polled = false;
  let inflight: Promise<void> | null = null;
  let failure: ServiceError | undefined;
  let failures = 0;
  let bot: string | undefined;

  async function readTarget(ctx: CapabilityContext, http: ReadOnlyClient, target: Target) {
    const name = `${target.kind}:${target.id}`;
    try {
      const object = await http.get(
        objectPath(target.kind, target.id),
        target.kind === "page" ? parsePage : parseDatabase,
      );
      problems.delete(name);
      items.set(name, toItem(object));
      for (const event of diff.update([object])) void ctx.emit(event);
    } catch (err) {
      if (!(err instanceof ServiceError) || endsCycle(err)) throw err;
      items.delete(name);
      problems.set(
        name,
        err.kind === "not_found"
          ? `${target.kind} ${target.id} was not found: share it with the integration`
          : err.message,
      );
    }
  }

  async function poll(ctx: CapabilityContext): Promise<void> {
    failure = undefined;
    const { watch } = settings(ctx);
    const token = await ctx.secret(SECRET_NAME);
    // Nothing to read, or no key: nothing is sent anywhere.
    if (!token || watch.length === 0) {
      items = new Map();
      problems = new Map();
      polled = true;
      return;
    }
    if (!client || clientKey !== token) {
      client = notionClient(apiUrl, token, lifetime ?? ctx.signal);
      clientKey = token;
      bot = undefined;
    }
    const names = new Set(watch.map((t) => `${t.kind}:${t.id}`));
    for (const name of [...items.keys(), ...problems.keys()]) {
      if (!names.has(name)) {
        items.delete(name);
        problems.delete(name);
      }
    }
    try {
      // Cheap check that the token works at all (and what the integration is called).
      if (bot === undefined) bot = (await client.get(BOT_PATH, parseBot)) ?? SERVICE;
      for (const target of watch) {
        if (ctx.signal.aborted) return;
        await readTarget(ctx, client, target);
      }
    } catch (err) {
      failure =
        err instanceof ServiceError
          ? err
          : new ServiceError(SERVICE, "invalid", "Unexpected error while reading Notion");
    }
    polled = true;
  }

  function pollOnce(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= poll(ctx).finally(() => (inflight = null)));
  }

  return defineCapability({
    manifest: {
      id: "notion",
      name: "Notion",
      version: "0.1.0",
      description:
        "Tells Fawkes when a Notion page or database you list by id is edited. Read-only (GET only). Limitation: Notion's search is a POST request, which Phoenix does not use, so it cannot find recently edited pages by itself; it watches only the pages and databases named in `watch` that you shared with your integration. Needs a Notion integration token.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["notion.page.updated", "notion.database.updated"],
      permissions: ["network", "external_api"],
      data_categories: ["Notion page and database titles", "edit times and links"],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: SECRET_NAME,
          description:
            "Notion internal integration token. Give the integration 'Read content' access only and share each watched page or database with it.",
        },
      ],
      commands: [
        {
          name: "status",
          description: "The watched Notion pages and databases and when each was last edited",
          side_effect: "read",
          permissions: ["network", "external_api"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          watch: {
            type: "array",
            maxItems: MAX_WATCH,
            description:
              "Pages and databases to watch, by id (the 32-character id at the end of the Notion URL). Each must be shared with your integration.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "id"],
              properties: {
                type: { type: "string", enum: ["page", "database"] },
                id: { type: "string", pattern: ID_PATTERN },
              },
            },
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS}). Checks pause while nothing is watching Phoenix.`,
          },
        },
      },
    },
    init(ctx) {
      lifetime = ctx.signal;
      client = undefined;
      clientKey = "";
      items = new Map();
      problems = new Map();
      polled = false;
      failure = undefined;
      failures = 0;
      bot = undefined;
      // History rule: edits made before this moment are background, not news.
      diff = new ObjectDiff(now());
      startPolling(
        ctx,
        async () => {
          await pollOnce(ctx);
          failures = failure ? failures + 1 : 0;
          return nextDelay(settings(ctx).pollMs, failures, failure);
        },
        sleep,
      );
    },
    commands: {
      async status(_input, ctx): Promise<ServiceStatus> {
        if (!(await ctx.secret(SECRET_NAME))) {
          return { configured: false, items: [], note: NO_TOKEN_NOTE };
        }
        if (settings(ctx).watch.length === 0) {
          return { configured: true, items: [], note: NO_WATCH_NOTE };
        }
        if (!polled) await pollOnce(ctx);
        if (failure) throw failure;
        return {
          configured: true,
          items: [...items.values()],
          ...(problems.size ? { note: [...problems.values()].join("; ") } : {}),
        };
      },
    },
    async health(ctx): Promise<HealthResult> {
      const { watch } = settings(ctx);
      if (!(await ctx.secret(SECRET_NAME))) return { status: "degraded", message: NO_TOKEN_NOTE };
      if (watch.length === 0) return { status: "degraded", message: NO_WATCH_NOTE };
      if (!polled) return { status: "healthy", message: "Reading Notion…" };
      if (failure?.kind === "auth" || failure?.kind === "rate_limit") {
        return { status: "degraded", message: failure.message };
      }
      if (failure) return { status: "unhealthy", message: failure.message };
      if (problems.size) return { status: "degraded", message: [...problems.values()].join("; ") };
      const who = bot && bot !== SERVICE ? ` as ${text(bot, 80)}` : "";
      return { status: "healthy", message: `Watching ${watch.length} Notion item(s)${who}` };
    },
  });
}
