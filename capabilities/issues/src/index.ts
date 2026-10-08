// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Issue-tracker capability (Phase 26). Read-only awareness of the issues assigned to you in
// GitHub Issues, Linear and Jira, through one provider interface and one event protocol:
// issues.assigned, issues.status_changed, issues.unassigned (plus the ephemeral
// issues.completed that lets Fawkes celebrate). Phoenix never creates, edits, closes or
// comments on an issue.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import { CONFIG_SCHEMA, createProvider, parseTrackers, type TrackerKind } from "./config";
import { baseline, reconcile, type IssueSnapshot } from "./diff";
import { MAX_RETRY_AFTER_MS } from "./http";
import type { ProviderOptions } from "./provider-base";
import { TrackerError, type HttpLimits, type IssueProvider, type RawIssueChange } from "./types";
import { isRecord, maxIso } from "./validate";

export * from "./config";
export * from "./diff";
export * from "./github";
export * from "./jira";
export * from "./linear";
export * from "./types";
export { sanitiseText, toIso } from "./validate";

export const DEFAULT_POLL_MS = 120_000;
/** Wait after a rate limit that did not say how long. */
const DEFAULT_BACKOFF_MS = 60_000;

export interface IssuesOptions {
  /** Clock for rate-limit back-off only; tracker cursors always come from tracker timestamps. */
  now?: () => number;
  limits?: Partial<HttpLimits>;
  maxPages?: number;
  /** Pause between poll cycles; tests replace it to step cycles deterministically. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const done = Promise.withResolvers<void>();
  const timer = setTimeout(done.resolve, ms);
  signal.addEventListener("abort", () => (clearTimeout(timer), done.resolve()), { once: true });
  return done.promise;
}

interface Tracker {
  kind: TrackerKind;
  provider: IssueProvider;
  snapshots: Map<string, IssueSnapshot>;
  /** Newest `updatedAt` seen from the tracker; undefined until the baseline has been taken. */
  cursor: string | undefined;
  /** Rate-limited until this time (ms, `now()` clock). */
  backoffUntil: number;
  /** Why the last poll failed; undefined while healthy. */
  problem: { kind: string; message: string } | undefined;
  assigned: number;
}

/** One-line state of a tracker, as shown in health. */
function describe(t: Tracker): string {
  if (t.problem) return `${t.kind}: ${t.problem.message}`;
  if (t.cursor === undefined) return `${t.kind}: not polled yet`;
  const note = t.provider.note();
  return `${t.kind}: ${t.assigned} assigned${note ? ` (${note})` : ""}`;
}

/** A fresh capability instance (own per-tracker state); Phoenix Core uses `issuesCapability`. */
export function createIssuesCapability(options: IssuesOptions = {}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  let trackers: Tracker[] = [];
  let configProblems: string[] = [];

  function start(ctx: CapabilityContext): void {
    const parsed = parseTrackers(ctx.config);
    configProblems = parsed.problems;
    const providerOptions: ProviderOptions = {
      secret: (name) => ctx.secret(name),
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    };
    trackers = parsed.specs.map((spec) => ({
      kind: spec.kind,
      provider: createProvider(spec, providerOptions),
      snapshots: new Map(),
      cursor: undefined,
      backoffUntil: 0,
      problem: undefined,
      assigned: 0,
    }));
  }

  function emitAll(ctx: CapabilityContext, t: Tracker, changes: readonly RawIssueChange[]): void {
    for (const e of reconcile(t.snapshots, changes)) {
      const result = ctx.emit(
        {
          event_type: e.event_type,
          severity: e.severity,
          correlation_id: e.correlation_id,
          subject: e.subject,
          payload: e.payload,
        },
        { ephemeral: e.ephemeral },
      );
      if (!result.ok) ctx.logger.warn("issues event rejected", { event: e.event_type });
    }
  }

  async function pollTracker(ctx: CapabilityContext, t: Tracker): Promise<void> {
    if (now() < t.backoffUntil) return;
    try {
      const refs = [...t.snapshots.values()].map((s) => s.ref);
      const changes = await t.provider.poll(t.cursor, ctx.signal, refs);
      if (ctx.signal.aborted) return;
      if (t.cursor === undefined) {
        // First poll: remember what is already assigned, say nothing about it. The cursor is the
        // tracker's own clock (a little behind, so nothing slips between polls), else the newest
        // timestamp seen. With neither, stay un-baselined and try again next time.
        const newest = changes.reduce<string | undefined>((m, c) => maxIso(m, c.updatedAt), undefined);
        const cursor = t.provider.serverTime() ?? newest;
        if (cursor !== undefined) {
          baseline(t.snapshots, changes);
          t.cursor = cursor;
        }
      } else {
        emitAll(ctx, t, changes);
        t.cursor = changes.reduce<string | undefined>((m, c) => maxIso(m, c.updatedAt), t.cursor);
      }
      t.assigned = t.snapshots.size;
      t.problem = undefined;
    } catch (err) {
      if (ctx.signal.aborted) return;
      if (err instanceof TrackerError) {
        t.problem = { kind: err.kind, message: err.message };
        if (err.kind === "rate_limit") {
          t.backoffUntil = now() + Math.min(err.retryAfterMs ?? DEFAULT_BACKOFF_MS, MAX_RETRY_AFTER_MS);
        }
      } else {
        // A bug in a provider must cost that tracker one poll, never the process.
        t.problem = { kind: "unavailable", message: "unexpected error while polling" };
        ctx.logger.error("issues poll failed", { tracker: t.kind, error: err });
      }
    }
  }

  async function listOpen(ctx: CapabilityContext, t: Tracker) {
    try {
      const all = await t.provider.poll(undefined, ctx.signal, []);
      return {
        tracker: t.kind,
        issues: all
          .filter((c) => c.assignedToMe && (c.category === "open" || c.category === "in_progress"))
          .map((c) => ({
            key: c.key,
            title: c.title,
            url: c.url,
            status: c.status,
            category: c.category,
          })),
      };
    } catch (err) {
      return {
        tracker: t.kind,
        issues: [],
        error: err instanceof TrackerError ? err.message : "unexpected error",
      };
    }
  }

  return defineCapability({
    manifest: {
      id: "issues",
      name: "Issue trackers",
      version: "0.1.0",
      description:
        "Tells Fawkes when a GitHub, Linear or Jira issue is assigned to you or changes status. Read-only.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["issues.*"],
      // Polling only reads from trackers; nothing is written to them, so `network` is the
      // whole footprint. `external_api` (acting on your behalf) is deliberately not requested.
      permissions: ["network"],
      data_categories: ["issue keys and titles", "issue assignment and status"],
      healthcheck: { interval_ms: 30_000 },
      secrets: [
        {
          name: "github_token",
          description: "GitHub token (optional for public repositories; needs read access to issues)",
        },
        { name: "linear_api_key", description: "Linear personal API key (Settings → API)" },
        { name: "jira_email", description: "Email address of your Atlassian account" },
        {
          name: "jira_api_token",
          description: "Atlassian API token (id.atlassian.com → Security → API tokens)",
        },
      ],
      commands: [
        {
          name: "list",
          description: "Open issues assigned to you, per tracker",
          side_effect: "read",
          timeout_ms: 60_000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: { tracker: { enum: ["github", "linear", "jira"] } },
          },
        },
      ],
      config_schema: CONFIG_SCHEMA,
      state_rules: [
        // Assignment and status changes appear in the activity feed only: being assigned is not
        // something that needs the user right now, so it must not turn Fawkes to WAITING.
        {
          match: "issues.completed",
          effect: { state: "SUCCESS", explain: "Done: {subject}", ttlMs: 8_000 },
        },
      ],
    },
    init(ctx) {
      start(ctx);
      const interval =
        typeof ctx.config.poll_ms === "number" ? ctx.config.poll_ms : DEFAULT_POLL_MS;
      void (async () => {
        while (!ctx.signal.aborted) {
          await Promise.all(trackers.map((t) => pollTracker(ctx, t)));
          await wait(interval, ctx.signal);
        }
      })();
    },
    commands: {
      async list(input, ctx) {
        const wanted = isRecord(input) && typeof input.tracker === "string" ? input.tracker : undefined;
        const selected = trackers.filter((t) => wanted === undefined || t.kind === wanted);
        return await Promise.all(selected.map((t) => listOpen(ctx, t)));
      },
    },
    health(): HealthResult {
      if (trackers.length === 0) {
        const why = configProblems[0] ?? "No trackers are configured";
        return { status: "degraded", message: why };
      }
      const failing = trackers.filter((t) => t.problem);
      const lines = [...configProblems, ...trackers.map(describe)].join(" · ");
      if (failing.length === 0) return { status: "healthy", message: lines };
      const onlyConfig = failing.every((t) => t.problem?.kind === "config");
      const allFailing = failing.length === trackers.length;
      return { status: allFailing && !onlyConfig ? "unhealthy" : "degraded", message: lines };
    },
  });
}

export const issuesCapability = createIssuesCapability();
