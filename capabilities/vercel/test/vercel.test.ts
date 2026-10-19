// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Vercel capability against a mock shaped from Vercel's docs, on 127.0.0.1 only. Nothing in
// this file contacts the real Vercel.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVercelCapability } from "../src";
import { Clock } from "../testing/clock";
import {
  MOCK_TOKEN,
  REMOTE_MARKER,
  deployment,
  startMockVercel,
  type MockVercel,
} from "../testing/mock-vercel";
import { setImmediate as yieldToLoop } from "node:timers/promises";

const T0 = Date.parse("2026-10-05T09:00:00Z");
const KEY = "plan1-redeploy-abcdef0123456789";
const OTHER_KEY = "plan1-redeploy-fedcba9876543210";

let h: Harness | undefined;
let mock: MockVercel | undefined;
let clock: Clock;

afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

async function ready(
  options: {
    token?: string | null;
    config?: Record<string, unknown>;
    data?: (m: MockVercel) => void;
  } = {},
) {
  mock = await startMockVercel();
  clock = new Clock();
  options.data?.(mock);
  h = createHarness({
    modules: [
      createVercelCapability({ apiUrl: mock.url, now: () => clock.now, sleep: clock.sleep }),
    ],
  });
  if (options.config) h.manager.configure("vercel", options.config);
  const token = options.token === undefined ? MOCK_TOKEN : options.token;
  if (token) await h.manager.setSecret("vercel", "token", token);
  await h.enable("vercel");
  await clock.first();
  return { h, mock };
}

const types = () => h!.types("vercel");
const health = async () => (await h!.manager.checkHealth("vercel")).health;
const everything = (ops: unknown[] = []) =>
  JSON.stringify({ ops, events: h!.events, audit: h!.db.prepare("SELECT * FROM audit_log").all() });

describe("manifest", () => {
  it("asks for network + external_api; only redeploy changes anything and it is external", async () => {
    await ready();
    const view = h!.manager.get("vercel");
    expect(view.permissions.map((p) => p.permission)).toEqual(["network", "external_api"]);
    expect(view.commands).toEqual([
      expect.objectContaining({ name: "status", side_effect: "read" }),
      expect.objectContaining({ name: "redeploy", side_effect: "external" }),
    ]);
    expect(view.secrets).toEqual([expect.objectContaining({ name: "token", set: true })]);
    expect(JSON.stringify(view)).not.toContain(MOCK_TOKEN);
  });

  it("the token can only go to Vercel's own origin: base_url is not a setting, so a token holder cannot redirect it", async () => {
    await ready();
    const attacker = await startMockVercel();
    try {
      for (const base_url of [attacker.url, "https://attacker.example", "http://127.0.0.1:1"]) {
        expect(() => h!.manager.configure("vercel", { base_url }), base_url).toThrow();
      }
      expect(h!.manager.get("vercel").config_schema).not.toHaveProperty("properties.base_url");
      await h!.manager.disable("vercel");
      const before = mock!.service.requests.length;
      await h!.enable("vercel");
      await vi.waitFor(() => expect(mock!.service.requests.length).toBeGreaterThan(before));
      expect(attacker.service.requests).toEqual([]);
      expect(() => h!.manager.configure("vercel", { token: MOCK_TOKEN })).toThrow();
    } finally {
      await attacker.close();
    }
  });

  it("the code-only apiUrl option itself refuses plain http to a non-loopback host", () => {
    expect(() => createVercelCapability({ apiUrl: "http://api.example.com" })).toThrow();
    expect(() => createVercelCapability({ apiUrl: "https://user:pw@example.com" })).toThrow();
  });
});

describe("polling", () => {
  it("history rule: deployments that finished before enabling are not replayed", async () => {
    await ready({
      data: (m) =>
        m.deployments.push(
          deployment({ uid: "dpl_old1", state: "ERROR", created: T0 - 86_400_000 }),
          deployment({ uid: "dpl_old2", state: "READY", created: T0 - 3_600_000 }),
        ),
    });
    expect(types()).toEqual([]);
    expect(h!.state.snapshot().state).toBe("IDLE");
  });

  it("a deployment that starts after enabling drives DEPLOYING, then SUCCESS", async () => {
    await ready();
    mock!.deployments.push(deployment({ uid: "dpl_live", state: "BUILDING", created: T0 + 5_000 }));
    await clock.tick();
    await vi.waitFor(() => expect(types()).toEqual(["vercel.deploy.started"]));
    await h!.drain();
    expect(h!.state.snapshot()).toMatchObject({
      state: "DEPLOYING",
      explanation: "Deploying to production",
      source: "vercel",
    });
    mock!.deployments[0]!.state = "READY";
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("vercel.deploy.succeeded"));
    await h!.drain();
    expect(h!.state.snapshot().state).toBe("SUCCESS");
    // The same deployment is not announced twice.
    await clock.tick();
    expect(types()).toEqual(["vercel.deploy.started", "vercel.deploy.succeeded"]);
  });

  it("a failed deployment is ERROR until dismissed", async () => {
    await ready();
    mock!.deployments.push(deployment({ uid: "dpl_bad", state: "ERROR", created: T0 + 5_000 }));
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("vercel.deploy.failed"));
    await h!.drain();
    expect(h!.state.snapshot()).toMatchObject({
      state: "ERROR",
      explanation: "Deploy failed: web (production)",
    });
  });

  it("sends the token only as a Bearer header to base_url, with GET only", async () => {
    await ready();
    const reqs = mock!.service.requests;
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) {
      expect(r.method).toBe("GET");
      expect(r.headers.authorization).toBe(`Bearer ${MOCK_TOKEN}`);
    }
    expect(reqs[0]!.path).toBe("/v6/deployments?limit=20");
  });

  it("scopes the request to the configured team and project", async () => {
    await ready({ config: { team_id: "team_abc", project: "web" } });
    expect(mock!.service.requests[0]!.path).toBe(
      "/v6/deployments?limit=20&projectId=web&teamId=team_abc",
    );
  });

  it("without a token it makes no request and health is degraded", async () => {
    await ready({ token: null });
    expect(mock!.service.requests).toEqual([]);
    expect(await health()).toMatchObject({ status: "degraded" });
  });

  it("a branch or actor that looks like a credential still yields a delivered event, redacted", async () => {
    // Built at runtime: it must match the secret scanner without being a literal in the tree.
    const lookalike = ["gh", "p_", "a1B2".repeat(8)].join("");
    await ready();
    mock!.deployments.push(
      deployment({
        uid: "dpl_tok1",
        state: "ERROR",
        created: T0 + 1000,
        meta: { githubCommitRef: `fix-${lookalike}` },
        creator: { username: `Bearer ${lookalike}` },
      }),
    );
    await clock.tick();
    await vi.waitFor(() => expect(types()).toEqual(["vercel.deploy.failed"]));
    await h!.drain();
    const event = h!.events.find((e) => e.source === "vercel")!;
    expect(event.payload.branch).toBe("fix-[REDACTED]");
    expect(JSON.stringify(event)).not.toContain(lookalike);
    expect(h!.state.snapshot().state).toBe("ERROR");
    const status = await h!.run("vercel", "status");
    expect(status.result).toMatchObject({ events_refused: 0 });
  });
});

describe("failures", () => {
  it("401: degraded, waits at least five minutes, the token is not in any message", async () => {
    await ready({
      data: (m) => (m.override.current = () => ({ status: 401, body: { error: REMOTE_MARKER } })),
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(300_000);
    const status = await health();
    expect(status.status).toBe("degraded");
    expect(status.message).toMatch(/401/);
    expect(JSON.stringify(status)).not.toContain(REMOTE_MARKER);
    expect(JSON.stringify(status)).not.toContain(MOCK_TOKEN);
  });

  it("429 with Retry-After is honoured", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({ status: 429, headers: { "retry-after": "120" }, body: {} })),
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(120_000);
    expect((await health()).status).toBe("degraded");
  });

  it("a redirect is not followed (the token would go to another host)", async () => {
    const other = await startMockVercel();
    try {
      await ready({
        data: (m) =>
          (m.override.current = () => ({
            status: 302,
            headers: { location: `${other.url}/v6/deployments` },
            body: {},
          })),
      });
      expect(other.service.requests).toEqual([]);
      expect((await health()).status).toBe("unhealthy");
    } finally {
      await other.close();
    }
  });

  it("an oversized response is cut off and reported, not parsed", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({
          body: JSON.stringify({ deployments: [], pad: "x".repeat(2 * 1024 * 1024 + 10) }),
        })),
    });
    expect((await health()).status).toBe("unhealthy");
    expect(types()).toEqual([]);
  });

  it.each([
    ["not JSON", "<html>REMOTE</html>"],
    ["a number", "5"],
    ["wrong shape", JSON.stringify({ deployments: { a: 1 } })],
  ])("a hostile body (%s) produces no events and no leaked text", async (_n, body) => {
    await ready({ data: (m) => (m.override.current = () => ({ body })) });
    expect(types()).toEqual([]);
    const status = await health();
    expect(status.status).toBe("unhealthy");
    expect(JSON.stringify(status)).not.toContain("REMOTE");
  });

  it("hostile deployment fields never reach events: links are https, ids safe, text clipped", async () => {
    await ready();
    mock!.deployments.push(
      deployment({
        uid: "dpl_h1",
        state: "READY",
        created: T0 + 1000,
        inspectorUrl: "javascript:alert(1)",
        url: "x.y/../../z",
        meta: { githubCommitRef: `${REMOTE_MARKER}${"y".repeat(500)}` },
      }),
      deployment({ uid: "../../etc", state: "READY", created: T0 + 1000 }),
    );
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("vercel.deploy.succeeded"));
    const events = h!.events.filter((e) => e.source === "vercel");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.url).toBeUndefined();
    expect(String(events[0]!.payload.branch).length).toBeLessThanOrEqual(100);
  });
});

describe("pausing when nothing is watching", () => {
  it("makes no request while unwatched and resumes the moment someone watches", async () => {
    mock = await startMockVercel();
    clock = new Clock();
    h = createHarness({
      modules: [
        createVercelCapability({ apiUrl: mock.url, now: () => clock.now, sleep: clock.sleep }),
      ],
    });
    const presence = h.manager.presence;
    presence.setClients(0);
    // No base_url setting exists; the mock is injected in code.
    await h.manager.setSecret("vercel", "token", MOCK_TOKEN);
    await h.enable("vercel");
    await yieldToLoop();
    expect(mock.service.requests).toEqual([]);
    expect(clock.sleeps).toEqual([]);
    presence.setClients(1);
    await clock.first();
    expect(mock.service.requests).toHaveLength(1);
    // Unwatched again: after the wait ends no further request is made.
    presence.setClients(0);
    clock.release();
    await yieldToLoop();
    await yieldToLoop();
    expect(mock.service.requests).toHaveLength(1);
    presence.setClients(1);
    await vi.waitFor(() => expect(mock!.service.requests).toHaveLength(2));
  });
});

describe("redeploy (approval path)", () => {
  const ARGS = { deployment_id: "dpl_ABC123", idempotency_key: KEY };

  it("declining the confirmation never calls Vercel", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    const before = mock!.service.requests.length;
    const op = await h!.run("vercel", "redeploy", ARGS, false);
    expect(op.status).toBe("failed");
    expect(mock!.service.requests).toHaveLength(before);
    expect(mock!.posts).toEqual([]);
  });

  it("without any decision the operation waits and sends nothing", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    const before = mock!.service.requests.length;
    const op = h!.manager.invoke("vercel", "redeploy", ARGS);
    await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
    expect(op.status).toBe("pending");
    expect(h!.permissions.pendingConfirmations()[0]).toMatchObject({ sideEffect: "external" });
    expect(mock!.service.requests).toHaveLength(before);
    for (const c of h!.permissions.pendingConfirmations())
      h!.permissions.resolveConfirmation(c.id, false);
  });

  it("approved: looks the deployment up, then makes exactly one POST naming it", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    const op = await h!
      .run("vercel", "redeploy", { ...ARGS, extra: 1 }, true)
      .catch((e: unknown) => e);
    // additionalProperties:false: unknown fields are rejected before anything is asked or sent.
    expect(op).toBeInstanceOf(Error);
    const ok = await h!.run("vercel", "redeploy", ARGS, true);
    expect(ok.status).toBe("succeeded");
    expect(ok.result).toMatchObject({
      status: "started",
      deployment_id: "dpl_NEW1",
      state: "queued",
    });
    expect(mock!.posts).toHaveLength(1);
    expect(mock!.posts[0]!.body).toEqual({
      name: "web",
      deploymentId: "dpl_ABC123",
      target: "production",
    });
    expect(mock!.posts[0]!.path).toBe("/v13/deployments?forceNew=1");
    expect(everything([ok])).not.toContain(MOCK_TOKEN);
  });

  it("the same idempotency_key does not start a second deployment; a new key does", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    await h!.run("vercel", "redeploy", ARGS, true);
    const again = await h!.run("vercel", "redeploy", ARGS, true);
    expect(again.result).toMatchObject({ status: "already_requested", deployment_id: "dpl_NEW1" });
    expect(mock!.posts).toHaveLength(1);
    await h!.run("vercel", "redeploy", { ...ARGS, idempotency_key: OTHER_KEY }, true);
    expect(mock!.posts).toHaveLength(2);
  });

  it("a key reused for a different deployment is refused, not answered with the first outcome", async () => {
    await ready({
      data: (m) =>
        m.deployments.push(
          deployment({ created: T0 - 1000 }),
          deployment({ uid: "dpl_OTHER9", created: T0 - 2000 }),
        ),
    });
    await h!.run("vercel", "redeploy", ARGS, true);
    const other = await h!.run(
      "vercel",
      "redeploy",
      { ...ARGS, deployment_id: "dpl_OTHER9" },
      true,
    );
    expect(other.status).toBe("failed");
    expect(other.error?.message).toMatch(/different deployment/);
    expect(mock!.posts).toHaveLength(1);
    // The original target still gets its remembered outcome.
    const again = await h!.run("vercel", "redeploy", ARGS, true);
    expect(again.result).toMatchObject({ status: "already_requested" });
  });

  it("aborts before the POST when Vercel answers with a different deployment than asked for", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    mock!.override.current = (path, method) =>
      method === "GET" && path.startsWith("/v13/deployments/")
        ? { body: { ...deployment({ uid: "dpl_EVIL99", name: "payments" }), id: "dpl_EVIL99" } }
        : undefined;
    const op = await h!.run("vercel", "redeploy", ARGS, true);
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/different deployment/);
    expect(mock!.posts).toEqual([]);
  });

  it("an unknown deployment is a 404 with nothing posted, and the key stays usable", async () => {
    await ready();
    const op = await h!.run("vercel", "redeploy", ARGS, true);
    expect(op.status).toBe("failed");
    expect(mock!.posts).toEqual([]);
    mock!.deployments.push(deployment({ created: T0 - 1000 }));
    const retry = await h!.run("vercel", "redeploy", ARGS, true);
    expect(retry.status).toBe("succeeded");
    expect(mock!.posts).toHaveLength(1);
  });

  it("a dropped POST says the outcome is unknown, and the same key is not blindly re-sent", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    const real = mock!.override;
    real.current = (_path, method) =>
      method === "POST" ? { status: 502, body: REMOTE_MARKER } : undefined;
    const first = await h!.run("vercel", "redeploy", ARGS, true);
    expect(first.status).toBe("failed");
    expect(first.error?.message).toMatch(/outcome is unknown/);
    expect(JSON.stringify(first)).not.toContain(REMOTE_MARKER);
    real.current = undefined;
    const second = await h!.run("vercel", "redeploy", ARGS, true);
    expect(second.status).toBe("failed");
    expect(second.error?.message).toMatch(/outcome is unknown/);
    // One POST reached the server (the override answered it); the repeat sent nothing.
    expect(mock!.service.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("rejects ids that could reshape the request path", async () => {
    await ready();
    for (const deployment_id of ["../x", "a/b", "a b", ""]) {
      await expect(
        h!.run("vercel", "redeploy", { deployment_id, idempotency_key: KEY }),
      ).rejects.toThrow();
    }
    expect(mock!.posts).toEqual([]);
  });
});

describe("status", () => {
  it("lists recent deployments as plain items and never the token", async () => {
    await ready({ data: (m) => m.deployments.push(deployment({ created: T0 - 1000 })) });
    const op = await h!.run("vercel", "status");
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      configured: true,
      events_refused: 0,
      items: [
        {
          id: "dpl_ABC123",
          title: "web (production)",
          state: "ready",
          detail: "main",
          url: "https://vercel.com/acme/web/dpl_ABC123",
          at: new Date(T0 - 1000).toISOString(),
        },
      ],
    });
    expect(everything([op])).not.toContain(MOCK_TOKEN);
  });

  it("says so when no token is set, without calling out", async () => {
    await ready({ token: null });
    const op = await h!.run("vercel", "status");
    expect(op.result).toMatchObject({ configured: false, items: [] });
    expect(mock!.service.requests).toEqual([]);
  });
});
