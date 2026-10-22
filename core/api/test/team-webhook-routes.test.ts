// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AuditLog } from "@phoenix/permissions";
import { EventBus } from "@phoenix/event-bus";
import { MemorySecretStore, SettingsStore, openDatabase } from "@phoenix/persistence";
import type { PhoenixEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../../runtime/src/team-status/rate-limit";
import { TeamWebhooks, signWebhook } from "../../runtime/src/team-status/webhooks";
import {
  decodeParams,
  matchRoute,
  readJsonBody,
  sendError,
  sendJson,
  type Route,
} from "../src/http";
import { tokensEqual } from "../src/security";
import {
  WEBHOOK_BODY_MAX_BYTES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  teamStatusRoutes,
  teamWebhookRoutes,
} from "../src/team-webhook-routes";

const SESSION_TOKEN = "session-token-for-this-test-only";
const NOW = Date.parse("2026-10-22T12:00:00Z");
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/**
 * The same dispatch rules as ApiServer.onRequest for the pieces that matter here: a route marked
 * `public` skips the session-token check, every other route requires it, errors go through
 * sendError. (ApiServer itself needs the full CoreServices, which this phase does not wire.)
 */
async function serve(routes: Route[]): Promise<string> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const { route, params } = matchRoute(routes, req.method ?? "GET", url.pathname);
      if (!route) {
        sendJson(res, 404, { code: "RESOURCE_NOT_FOUND" });
        return;
      }
      if (!route.public) {
        const auth = req.headers.authorization;
        if (!auth?.startsWith("Bearer ") || !tokensEqual(auth.slice(7), SESSION_TOKEN)) {
          sendJson(res, 401, { code: "UNAUTHENTICATED" });
          return;
        }
      }
      const result = await route.handler({
        req,
        res,
        url,
        params: decodeParams(params),
        body: (max) => readJsonBody(req, max),
      });
      if (result !== undefined)
        sendJson(
          res,
          res.statusCode === 202 || res.statusCode === 201 ? res.statusCode : 200,
          result,
        );
    } catch (error) {
      sendError(res, error);
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

class Clock {
  constructor(public current = NOW) {}
  now(): number {
    return this.current;
  }
}

async function rig(options: { sourceBurst?: number } = {}) {
  const db = openDatabase(":memory:");
  const clock = new Clock();
  const bus = new EventBus({ retryDelayMs: 0 });
  const events: PhoenixEvent[] = [];
  bus.subscribe("test", "*", (event) => {
    events.push(event);
  });
  const hooks = new TeamWebhooks({
    settings: new SettingsStore(db),
    secrets: new MemorySecretStore(),
    bus,
    audit: new AuditLog(db, () => clock.now()),
    clock,
    preAuthLimit: new RateLimiter(100, 60),
    sourceLimit: new RateLimiter(options.sourceBurst ?? 100, 60),
  });
  hooks.setEnabled(true);
  const { secret } = await hooks.createSource("ci-main", ["deploy.started", "build.failed"]);
  const base = await serve(teamWebhookRoutes(hooks));
  const post = async (
    raw: string,
    headers: Record<string, string> = {},
    path = "/api/webhooks/in/ci-main",
  ) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    });
    return {
      status: response.status,
      headers: response.headers,
      json: (await response.json().catch(() => null)) as Record<string, unknown> | null,
    };
  };
  const signed = (raw: string, secretValue = secret, seconds = NOW / 1000) => ({
    [WEBHOOK_TIMESTAMP_HEADER]: String(seconds),
    [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secretValue, seconds, Buffer.from(raw)),
  });
  const payload = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ event_id: "delivery-0001", event_type: "deploy.started", ...overrides });
  return { base, hooks, bus, events, secret, post, signed, payload, clock };
}

describe("team webhook routes: authentication model", () => {
  it("marks only the ingest route public and every management route session-authenticated", async () => {
    const routes = teamWebhookRoutes({} as never);
    const publicRoutes = routes.filter((r) => r.public);
    expect(publicRoutes).toHaveLength(1);
    expect(publicRoutes[0]).toMatchObject({ method: "POST" });
    expect(publicRoutes[0]!.pattern.test("/api/webhooks/in/ci-main")).toBe(true);
    expect(publicRoutes[0]!.pattern.test("/api/team/webhooks")).toBe(false);
    expect(teamStatusRoutes({} as never).every((r) => r.public === undefined)).toBe(true);
    expect(routes.filter((r) => !r.public)).toHaveLength(6);
  });

  it("authenticates with the HMAC, not the session token", async () => {
    const { post, signed, payload, events, bus } = await rig();
    const raw = payload();
    // The session token is not an accepted credential here.
    const withToken = await post(raw, { authorization: `Bearer ${SESSION_TOKEN}` });
    expect(withToken.status).toBe(401);
    expect(withToken.json).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Webhook authentication failed",
    });
    expect(withToken.headers.get("www-authenticate")).toContain("Phoenix-HMAC-SHA256");
    // A valid signature works with no session token at all.
    const accepted = await post(raw, signed(raw));
    expect(accepted.status).toBe(202);
    expect(accepted.json).toMatchObject({ event_id: expect.stringMatching(/^evt_wh_/) });
    await bus.drain();
    expect(events).toHaveLength(1);
    // And sending the session token alongside a valid signature neither helps nor hurts.
    const second = payload({ event_id: "delivery-0002" });
    expect((await post(second, { ...signed(second), authorization: "Bearer wrong" })).status).toBe(
      202,
    );
  });

  it("returns the same 401 body for a wrong secret, an unknown source and missing headers", async () => {
    const { post, signed, payload } = await rig();
    const raw = payload();
    const responses = [
      await post(raw, signed(raw, `${"x".repeat(43)}`)),
      await post(raw, signed(raw), "/api/webhooks/in/unknown-source"),
      await post(raw, {}),
      await post(raw, { [WEBHOOK_TIMESTAMP_HEADER]: "abc", [WEBHOOK_SIGNATURE_HEADER]: "nope" }),
    ];
    for (const response of responses) expect(response.status).toBe(401);
    expect(new Set(responses.map((r) => JSON.stringify(r.json))).size).toBe(1);
  });

  it("management routes require the session token and never echo a stored secret", async () => {
    const { hooks, secret } = await rig();
    const base = await serve(teamWebhookRoutes(hooks));
    expect((await fetch(`${base}/api/team/webhooks`)).status).toBe(401);
    expect((await fetch(`${base}/api/team/webhooks`, { method: "POST" })).status).toBe(404);
    const auth = { authorization: `Bearer ${SESSION_TOKEN}`, "content-type": "application/json" };
    const status = await fetch(`${base}/api/team/webhooks`, { headers: auth });
    const text = await status.text();
    expect(status.status).toBe(200);
    expect(text).toContain("/api/webhooks/in/ci-main");
    expect(text).not.toContain(secret);

    const created = await fetch(`${base}/api/team/webhooks/sources`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ id: "alerts", eventTypes: ["alert.fired"] }),
    });
    expect(created.status).toBe(201);
    const { secret: fresh } = (await created.json()) as { secret: string };
    expect(fresh).toHaveLength(43);

    const rotated = await fetch(`${base}/api/team/webhooks/sources/alerts/rotate`, {
      method: "POST",
      headers: auth,
    });
    expect(((await rotated.json()) as { secret: string }).secret).not.toBe(fresh);

    const revoked = await fetch(`${base}/api/team/webhooks/sources/alerts`, {
      method: "DELETE",
      headers: auth,
    });
    expect(revoked.status).toBe(200);
    expect(
      (await fetch(`${base}/api/team/webhooks/sources/alerts`, { method: "DELETE", headers: auth }))
        .status,
    ).toBe(404);
  });

  it("rejects management bodies with unknown fields or non-boolean flags", async () => {
    const { hooks } = await rig();
    const base = await serve(teamWebhookRoutes(hooks));
    const auth = { authorization: `Bearer ${SESSION_TOKEN}`, "content-type": "application/json" };
    const put = (path: string, body: unknown) =>
      fetch(base + path, { method: "PUT", headers: auth, body: JSON.stringify(body) });
    expect((await put("/api/team/webhooks", { enabled: "yes" })).status).toBe(400);
    expect((await put("/api/team/webhooks", { enabled: true, secret: "x" })).status).toBe(400);
    expect((await put("/api/team/webhooks/sources/ci-main", { enabled: 0 })).status).toBe(400);
    const bad = await fetch(`${base}/api/team/webhooks/sources`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ id: "alerts", eventTypes: ["dictation.idle"] }),
    });
    expect(bad.status).toBe(400);
    expect(hooks.status().sources.map((s) => s.id)).toEqual(["ci-main"]);
    expect((await put("/api/team/webhooks/sources/ci-main", { enabled: false })).status).toBe(200);
    expect(hooks.status().sources[0]!.enabled).toBe(false);
  });
});

describe("team webhook routes: body, schema, replay, limits", () => {
  it("refuses a body over the cap by declaration and by streaming, before any signature work", async () => {
    const { post, signed, hooks, secret } = await rig();
    const big = JSON.stringify({
      event_id: "delivery-0001",
      event_type: "deploy.started",
      message: "x".repeat(WEBHOOK_BODY_MAX_BYTES),
    });
    expect(Buffer.byteLength(big)).toBeGreaterThan(WEBHOOK_BODY_MAX_BYTES);
    const refused = await post(big, signed(big, secret));
    expect(refused.status).toBe(413);
    // Chunked (no content-length): the cap still applies while streaming.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(4096));
        for (let i = 0; i < 8; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const chunked = await fetch(
      `${await serve(teamWebhookRoutes(hooks))}/api/webhooks/in/ci-main`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit,
    );
    expect(chunked.status).toBe(413);
  });

  it("requires a JSON content type", async () => {
    const { base, signed, payload } = await rig();
    const raw = payload();
    const wrongType = await fetch(`${base}/api/webhooks/in/ci-main`, {
      method: "POST",
      headers: { "content-type": "text/plain", ...signed(raw) },
      body: raw,
    });
    expect(wrongType.status).toBe(400);
  });

  it("verifies the exact bytes: whitespace changes after signing fail authentication", async () => {
    const { post, signed, payload } = await rig();
    const raw = payload();
    const headers = signed(raw);
    expect((await post(`${raw} `, headers)).status).toBe(401);
    expect((await post(raw, headers)).status).toBe(202);
  });

  it("answers 202 once, then 409 for a replay inside the window and 401 after it", async () => {
    const { post, signed, payload, clock } = await rig();
    const raw = payload();
    const headers = signed(raw);
    expect((await post(raw, headers)).status).toBe(202);
    expect((await post(raw, headers)).status).toBe(409);
    clock.current += 6 * 60_000;
    expect((await post(raw, headers)).status).toBe(401);
  });

  it("answers 400 for a schema violation and 403 for an event type outside the source's grant", async () => {
    const { post, signed, payload } = await rig();
    const unknownField = payload({ source: "core" });
    expect((await post(unknownField, signed(unknownField))).status).toBe(400);
    const notGranted = payload({ event_id: "delivery-0009", event_type: "release.published" });
    const response = await post(notGranted, signed(notGranted));
    expect(response.status).toBe(403);
    expect(response.json).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("answers 429 with Retry-After once a source exceeds its rate", async () => {
    const { post, signed, payload, clock } = await rig({ sourceBurst: 1 });
    const first = payload({ event_id: "delivery-0001" });
    const second = payload({ event_id: "delivery-0002" });
    expect((await post(first, signed(first))).status).toBe(202);
    const limited = await post(second, signed(second));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(limited.json).toMatchObject({ code: "SECURITY_POLICY_BLOCKED" });
    clock.current += 1000;
    expect((await post(second, signed(second, undefined, clock.current / 1000))).status).toBe(202);
  });

  it("stops accepting the moment the source is disabled or the master switch is off", async () => {
    const { post, signed, payload, hooks } = await rig();
    hooks.setSourceEnabled("ci-main", false);
    const raw = payload();
    expect((await post(raw, signed(raw))).status).toBe(401);
    hooks.setSourceEnabled("ci-main", true);
    hooks.setEnabled(false);
    expect((await post(raw, signed(raw))).status).toBe(401);
    hooks.setEnabled(true);
    expect((await post(raw, signed(raw))).status).toBe(202);
  });

  it("does not let the posted body choose the event source", async () => {
    const { post, signed, payload, events, bus } = await rig();
    const raw = payload({ event_id: "delivery-0042" });
    await post(raw, signed(raw));
    await bus.drain();
    expect(events[0]!.source).toBe("webhook-ci-main");
  });
});

describe("team sharing routes", () => {
  function sharingApi() {
    const calls: string[] = [];
    const state = {
      enabled: false,
      consent: { deploying: false, agent_run: false, meeting: false },
    };
    return {
      calls,
      api: {
        view: () => ({ ...state }) as never,
        setEnabled: (enabled: boolean) => {
          calls.push(`enabled:${enabled}`);
          state.enabled = enabled;
        },
        setConsent: (change: Record<string, unknown>) => {
          for (const [kind, value] of Object.entries(change)) {
            if (!(kind in state.consent)) throw new RangeError(`Unknown team item kind: ${kind}`);
            calls.push(`consent:${kind}:${String(value)}`);
            (state.consent as Record<string, unknown>)[kind] = value;
          }
        },
      },
    };
  }

  it("requires the session token and applies consent before the master switch", async () => {
    const { api, calls } = sharingApi();
    const base = await serve(teamStatusRoutes(api));
    expect((await fetch(`${base}/api/team/status`)).status).toBe(401);
    const auth = { authorization: `Bearer ${SESSION_TOKEN}`, "content-type": "application/json" };
    const response = await fetch(`${base}/api/team/sharing`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ consent: { meeting: true }, enabled: true }),
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["consent:meeting:true", "enabled:true"]);
  });

  it("turns an unknown consent kind into a 400 and changes nothing else", async () => {
    const { api, calls } = sharingApi();
    const base = await serve(teamStatusRoutes(api));
    const auth = { authorization: `Bearer ${SESSION_TOKEN}`, "content-type": "application/json" };
    const put = (body: unknown) =>
      fetch(`${base}/api/team/sharing`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify(body),
      });
    expect((await put({ enabled: true, consent: { location: true } })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ enabled: "on" })).status).toBe(400);
    expect((await put({ enabled: true, extra: 1 })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
