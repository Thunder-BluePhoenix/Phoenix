// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage } from "node:http";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type {
  WebhookOutcome,
  WebhookRequest,
  WebhookSourceSecret,
  WebhookStatus,
} from "../../runtime/src/team-status/webhooks";
import type { TeamStatusView } from "../../runtime/src/team-status/service";
import { BodyTooLargeError, expectObject, route, sendJson, type Route } from "./http";

/** Largest webhook body the endpoint reads; the signature covers exactly these bytes. */
export const WEBHOOK_BODY_MAX_BYTES = 16 * 1024;
export const WEBHOOK_TIMESTAMP_HEADER = "x-phoenix-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "x-phoenix-signature";
/** Prefix of the one session-token-free route; a sender POSTs to `${prefix}<source id>`. */
export const WEBHOOK_INGEST_PREFIX = "/api/webhooks/in/";
/** Sent on every 401 from the ingest route so the scheme is explicit to the sender. */
export const WEBHOOK_AUTH_CHALLENGE = 'Phoenix-HMAC-SHA256 realm="phoenix-webhook"';

export interface TeamWebhookApi {
  status(): WebhookStatus;
  setEnabled(enabled: boolean): WebhookStatus;
  createSource(id: unknown, eventTypes: unknown): Promise<WebhookSourceSecret>;
  rotateSecret(id: string): Promise<WebhookSourceSecret>;
  setSourceEnabled(id: string, enabled: boolean): WebhookStatus;
  revoke(id: string): Promise<WebhookStatus>;
  accept(request: WebhookRequest): Promise<WebhookOutcome>;
}

export interface TeamStatusApi {
  view(): TeamStatusView;
  setEnabled(enabled: boolean): void;
  setConsent(change: Record<string, unknown>): void;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

const WEBHOOK_BODY_TIMEOUT_MS = 10_000;

export interface TeamWebhookRouteOptions {
  /** Longest an unauthenticated sender may take to finish sending its body. */
  bodyTimeoutMs?: number;
}

/** Reads the raw bytes (the HMAC is over bytes, not over re-serialized JSON) up to the cap. */
async function readRawBody(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/json")) {
    req.resume();
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Content-Type must be application/json");
  }
  const declared = req.headers["content-length"];
  if (declared !== undefined && !/^\d+$/.test(declared))
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid Content-Length");
  if (Number(declared ?? 0) > maxBytes) throw new BodyTooLargeError(maxBytes);
  const done = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  let size = 0;
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    chunks.length = 0;
    req.destroy();
    done.reject(new PhoenixError(ErrorCode.INVALID_REQUEST, "Webhook body timed out"));
  }, timeoutMs);
  timer.unref();
  req.on("data", (chunk: Buffer) => {
    if (finished) return;
    size += chunk.length;
    if (size > maxBytes) {
      finished = true;
      chunks.length = 0;
      req.pause();
      clearTimeout(timer);
      done.reject(new BodyTooLargeError(maxBytes));
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!finished) {
      finished = true;
      clearTimeout(timer);
      done.resolve(Buffer.concat(chunks));
    }
  });
  req.on("error", (error) => {
    clearTimeout(timer);
    done.reject(error);
  });
  return done.promise;
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw new PhoenixError(ErrorCode.INVALID_REQUEST, what);
  return value;
}

/** Rejects a body that carries anything beyond the named keys. */
function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Unexpected field "${key}"`);
  }
}

/**
 * Incoming webhooks (Phase 92).
 *
 * `POST /api/webhooks/in/:source` is the ONE public route here, and it is public only in the sense
 * that it does not use the Core session token: the caller is an external service that must never
 * hold that token. It authenticates every request itself with a per-source HMAC-SHA256 over
 * `<x-phoenix-timestamp>.<raw body>` (header `x-phoenix-signature: v1=<hex>`), with a replay
 * window, event-id dedupe, a body cap and rate limits, all enforced by {@link TeamWebhookApi.accept}.
 * A session token sent to this route is not read and grants nothing. Every other route below is
 * authenticated with the session token as usual.
 */
export function teamWebhookRoutes(
  service: TeamWebhookApi,
  options: TeamWebhookRouteOptions = {},
): Route[] {
  return [
    route(
      "POST",
      `${WEBHOOK_INGEST_PREFIX}:source`,
      async ({ req, res, params }) => {
        const body = await readRawBody(
          req,
          WEBHOOK_BODY_MAX_BYTES,
          options.bodyTimeoutMs ?? WEBHOOK_BODY_TIMEOUT_MS,
        );
        let outcome: WebhookOutcome;
        try {
          outcome = await service.accept({
            sourceId: params.source ?? "",
            timestamp: header(req, WEBHOOK_TIMESTAMP_HEADER),
            signature: header(req, WEBHOOK_SIGNATURE_HEADER),
            body,
          });
        } catch (error) {
          if (error instanceof PhoenixError && error.code === ErrorCode.UNAUTHENTICATED)
            res.setHeader("www-authenticate", WEBHOOK_AUTH_CHALLENGE);
          throw error;
        }
        if (!outcome.ok) {
          res.setHeader("retry-after", String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1000))));
          sendJson(res, 429, {
            code: ErrorCode.SECURITY_POLICY_BLOCKED,
            message: "Too many webhook deliveries; retry later",
            details: [],
          });
          return undefined;
        }
        res.statusCode = 202;
        return { event_id: outcome.eventId, seq: outcome.seq };
      },
      true,
    ),
    route("GET", "/api/team/webhooks", () => service.status()),
    route("PUT", "/api/team/webhooks", async ({ body }) => {
      const input = expectObject(await body());
      onlyKeys(input, ["enabled"]);
      return service.setEnabled(flag(input.enabled, '"enabled" must be a boolean'));
    }),
    route("POST", "/api/team/webhooks/sources", async ({ body, res }) => {
      const input = expectObject(await body());
      onlyKeys(input, ["id", "eventTypes"]);
      const created = await service.createSource(input.id, input.eventTypes);
      res.statusCode = 201;
      return created;
    }),
    route("POST", "/api/team/webhooks/sources/:source/rotate", async ({ params }) =>
      service.rotateSecret(params.source ?? ""),
    ),
    route("PUT", "/api/team/webhooks/sources/:source", async ({ body, params }) => {
      const input = expectObject(await body());
      onlyKeys(input, ["enabled"]);
      return service.setSourceEnabled(
        params.source ?? "",
        flag(input.enabled, '"enabled" must be a boolean'),
      );
    }),
    route("DELETE", "/api/team/webhooks/sources/:source", async ({ params }) =>
      service.revoke(params.source ?? ""),
    ),
  ];
}

/** Authenticated routes for the local team-sharing choices and the consented teammate view. */
export function teamStatusRoutes(service: TeamStatusApi): Route[] {
  return [
    route("GET", "/api/team/status", () => service.view()),
    route("PUT", "/api/team/sharing", async ({ body }) => {
      const input = expectObject(await body());
      onlyKeys(input, ["enabled", "consent"]);
      if (input.enabled === undefined && input.consent === undefined)
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected "enabled" and/or "consent"');
      try {
        if (input.consent !== undefined) service.setConsent(expectObject(input.consent));
      } catch (error) {
        if (error instanceof RangeError)
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, error.message);
        throw error;
      }
      if (input.enabled !== undefined)
        service.setEnabled(flag(input.enabled, '"enabled" must be a boolean'));
      return service.view();
    }),
  ];
}
