// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { HealthResult } from "@phoenix/capability-manager";
import {
  createEvent,
  validateManifest,
  type CapabilityManifest,
  type NewEvent,
  type PhoenixEvent,
} from "@phoenix/protocol";
import type { EventInput } from "@phoenix/sdk-events";
import { DEFAULT_CORE_URL, resolveSessionToken } from "./session";

const TOKEN_HEADER = "x-phoenix-capability-token";
const MAX_BODY = 256 * 1024;

export interface ExternalContext {
  readonly id: string;
  /** Configuration Phoenix sent when the capability was enabled. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  emit(event: EventInput): Promise<EmitResult>;
}

export type EmitResult =
  { ok: true; eventId: string } | { ok: false; code: string; message: string };

export interface ExternalCapabilityOptions {
  manifest: CapabilityManifest;
  commands?: Record<
    string,
    (input: unknown, ctx: ExternalContext, meta: { operationId: string }) => unknown
  >;
  health?: (ctx: ExternalContext) => HealthResult | Promise<HealthResult>;
  onEnable?: (ctx: ExternalContext) => void | Promise<void>;
  onDisable?: (ctx: ExternalContext) => void | Promise<void>;
  /** Phoenix Core URL (default http://127.0.0.1:4870 or $PHOENIX_CORE_URL). */
  coreUrl?: string;
  /**
   * Session token, or a function returning the current one. When omitted it is
   * read from the environment / token file — again on every re-registration,
   * because core issues a new session token each time it starts.
   */
  sessionToken?: string | (() => string);
  /** Port for this capability's own server (default: random). Always bound to 127.0.0.1. */
  port?: number;
}

export interface ExternalCapability extends ExternalContext {
  readonly endpoint: string;
  close(): Promise<void>;
}

/**
 * Runs an external capability: starts a loopback HTTP server implementing the
 * Phoenix external-capability contract, registers with Phoenix Core, and
 * re-registers automatically if core restarts (its token changes).
 */
export async function runExternalCapability(
  options: ExternalCapabilityOptions,
): Promise<ExternalCapability> {
  const valid = validateManifest(options.manifest);
  if (!valid.ok) throw new Error(`Invalid manifest: ${valid.error.details.join("; ")}`);
  const manifest = valid.manifest;
  const coreUrl = (options.coreUrl ?? process.env.PHOENIX_CORE_URL ?? DEFAULT_CORE_URL).replace(
    /\/$/,
    "",
  );
  const sessionToken =
    typeof options.sessionToken === "function"
      ? options.sessionToken
      : options.sessionToken
        ? () => options.sessionToken as string
        : () => resolveSessionToken();

  // capability → core: token issued by core at registration (changes when core restarts).
  let capabilityToken = "";
  // core → capability: our own secret, sent at registration so we can verify core immediately.
  const callbackSecret = randomBytes(32).toString("base64url");
  let config: Record<string, unknown> = {};
  let enabled = false;

  const ctx: ExternalContext = {
    id: manifest.id,
    get config() {
      return config;
    },
    get enabled() {
      return enabled;
    },
    emit: (event) => emit(event),
  };

  const server: Server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function register(): Promise<void> {
    const res = await fetch(`${coreUrl}/api/capabilities/register`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ manifest, endpoint, callback_secret: callbackSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
    if (!res.ok || !body.token) {
      throw new Error(
        `Registration with Phoenix Core failed (${res.status}): ${body.message ?? "unknown error"}`,
      );
    }
    capabilityToken = body.token;
  }

  function emit(input: EventInput): Promise<EmitResult> {
    // One envelope for all attempts: core de-duplicates by event_id, so retries are safe.
    return send(createEvent({ ...input, source: manifest.id } as NewEvent));
  }

  async function send(event: PhoenixEvent, attempt = 1, reregistered = false): Promise<EmitResult> {
    let res: Response;
    try {
      res = await fetch(`${coreUrl}/api/capabilities/${manifest.id}/events`, {
        method: "POST",
        headers: { [TOKEN_HEADER]: capabilityToken, "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch {
      // Typically a pooled connection to a core that has since restarted.
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 100 * attempt));
        return send(event, attempt + 1, reregistered);
      }
      return { ok: false, code: "CAPABILITY_UNAVAILABLE", message: "Phoenix Core is unreachable" };
    }
    if (res.status === 401 && !reregistered) {
      // Core restarted and issued new tokens: register again, then retry once.
      try {
        await register();
      } catch (err) {
        return { ok: false, code: "UNAUTHENTICATED", message: (err as Error).message };
      }
      return send(event, attempt, true);
    }
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      event_id?: string;
    };
    return res.ok
      ? { ok: true, eventId: body.event_id ?? event.event_id }
      : { ok: false, code: body.code ?? "UNKNOWN", message: body.message ?? res.statusText };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const presented = req.headers[TOKEN_HEADER];
    if (typeof presented !== "string" || !safeEqual(presented, callbackSecret)) {
      return send(401, { message: "Invalid capability token" });
    }
    let body: Record<string, unknown> = {};
    try {
      body = await readBody(req);
    } catch (err) {
      return send(400, { message: (err as Error).message });
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, options.health ? await options.health(ctx) : { status: "healthy" });
      }
      if (req.method === "POST" && url.pathname === "/phoenix/lifecycle") {
        if (body.action === "enable") {
          config = (body.config as Record<string, unknown>) ?? {};
          enabled = true;
          await options.onEnable?.(ctx);
        } else if (body.action === "disable") {
          enabled = false;
          await options.onDisable?.(ctx);
        }
        return send(200, { ok: true });
      }
      const m = /^\/commands\/([^/]+)$/.exec(url.pathname);
      if (req.method === "POST" && m) {
        const handler = options.commands?.[decodeURIComponent(m[1]!)];
        if (!handler) return send(404, { message: "Unknown command" });
        const result = await handler(body.input, ctx, {
          operationId: String(body.operation_id ?? ""),
        });
        return send(200, { result: result ?? null });
      }
      return send(404, { message: "Not found" });
    } catch (err) {
      return send(500, { message: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    await register();
  } catch (err) {
    server.close();
    throw err;
  }

  return Object.assign(ctx, {
    endpoint,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }) as ExternalCapability;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
