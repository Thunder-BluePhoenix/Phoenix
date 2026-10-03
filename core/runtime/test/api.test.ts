// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { connect, event, startCore } from "./helpers";

type Core = Awaited<ReturnType<typeof startCore>>;
let core: Core | undefined;
const open: { ws: { close(): void } }[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) c.ws.close();
  await core?.runtime.stop();
  core = undefined;
});
const start = async (...args: Parameters<typeof startCore>) => (core = await startCore(...args));
const ws = (port: number, token?: string) => {
  const c = connect(port, token);
  open.push(c);
  return c;
};

/** Raw request so we can forge the Host header (fetch forbids it). */
function rawGet(port: number, path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

describe("authentication and origin checks", () => {
  it("requires the session token on non-public routes", async () => {
    const { api } = await start();
    expect(
      (await api("GET", "/api/pet/state", undefined, { authorization: "" })).json,
    ).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(
      (await api("GET", "/api/pet/state", undefined, { authorization: "Bearer wrong" })).status,
    ).toBe(401);
    expect((await api("GET", "/api/pet/state")).status).toBe(200);
  });

  it("blocks DNS-rebinding hosts", async () => {
    const { port } = await start();
    expect(await rawGet(port, "/api/health", { host: "evil.example:80" })).toBe(403);
    expect(await rawGet(port, "/api/health", { host: `localhost:${port}` })).toBe(200);
  });

  it("allows configured and same origins only, with CORS headers", async () => {
    const { api, port } = await start({ allowedOrigins: ["http://localhost:5173"] });
    const ok = await api("GET", "/api/pet/state", undefined, { origin: "http://localhost:5173" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(
      (await api("GET", "/api/pet/state", undefined, { origin: `http://127.0.0.1:${port}` }))
        .status,
    ).toBe(200);
    expect(
      (await api("GET", "/api/pet/state", undefined, { origin: "https://evil.example" })).status,
    ).toBe(403);
    const pre = await api("OPTIONS", "/api/events", undefined, { origin: "http://localhost:5173" });
    expect(pre.status).toBe(204);
  });

  it("returns 404 / 405 with error bodies", async () => {
    const { api } = await start();
    expect((await api("GET", "/api/nope")).json).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect((await api("DELETE", "/api/pet/state")).status).toBe(405);
  });
});

describe("events", () => {
  it("POST /api/events drives Fawkes and appears in history", async () => {
    const { api, runtime } = await start();
    const res = await api("POST", "/api/events", event("build.failed", { severity: "error" }));
    expect(res.status).toBe(202);
    expect(res.json.seq).toBeGreaterThan(0);
    await runtime.bus.drain();
    expect((await api("GET", "/api/pet/state")).json).toMatchObject({ state: "ERROR" });
    const history = await api("GET", "/api/events?type=build.*&limit=5");
    expect(history.json.events.map((e: any) => e.event.event_type)).toEqual(["build.failed"]);
    const after = await api("GET", `/api/events?after_seq=${res.json.seq}`);
    expect(after.json.events).toEqual([]);
  });

  it("rejects invalid, duplicate, secret-bearing and core-sourced events", async () => {
    const { api } = await start();
    expect((await api("POST", "/api/events", { event_type: "x" })).json.code).toBe("INVALID_EVENT");
    const e = event("build.started");
    await api("POST", "/api/events", e);
    expect((await api("POST", "/api/events", e)).json.code).toBe("EVENT_DUPLICATE");
    expect(
      (await api("POST", "/api/events", event("build.started", { payload: { password: "x" } })))
        .json.code,
    ).toBe("SECURITY_POLICY_BLOCKED");
    expect(
      (await api("POST", "/api/events", event("system.online", { source: "core" }))).status,
    ).toBe(403);
  });

  it("rejects malformed requests", async () => {
    const { api } = await start();
    expect((await api("POST", "/api/events", "{not json")).json.code).toBe("INVALID_REQUEST");
    expect((await api("POST", "/api/events", "{}", { "content-type": "text/plain" })).status).toBe(
      400,
    );
    expect((await api("GET", "/api/events?limit=-1")).status).toBe(400);
    const big = await api("POST", "/api/events", JSON.stringify({ pad: "x".repeat(300_000) }));
    expect(big.status).toBe(413);
    expect(big.json.code).toBe("INVALID_REQUEST");
  });
});

describe("streamed bodies", () => {
  it("answers 413 for an oversized chunked body without a Content-Length", async () => {
    const { port } = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/events",
          method: "POST",
          headers: {
            authorization: "Bearer test-token-0123456789",
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      for (let i = 0; i < 40; i++) req.write("x".repeat(10_000));
      req.end();
    });
    expect(status).toBe(413);
  });
});

describe("pet controls", () => {
  it("sleep persists across restarts", async () => {
    const { api, runtime } = await start();
    expect((await api("POST", "/api/pet/sleep", { sleeping: true })).json).toMatchObject({
      state: "SLEEPING",
    });
    expect(runtime.settings.get("pet.sleeping", false)).toBe(true);
    expect((await api("POST", "/api/pet/sleep", { sleeping: "yes" })).status).toBe(400);
  });

  it("acknowledge clears errors", async () => {
    const { api, runtime } = await start();
    await api("POST", "/api/events", event("build.failed", { severity: "error" }));
    await runtime.bus.drain();
    expect((await api("POST", "/api/pet/acknowledge", {})).json).toEqual({ acknowledged: 1 });
    expect((await api("GET", "/api/pet/state")).json.state).toBe("IDLE");
    expect((await api("POST", "/api/pet/acknowledge", { key: "missing" })).status).toBe(404);
  });

  it("lists active tasks", async () => {
    const { api, runtime } = await start();
    await api(
      "POST",
      "/api/events",
      event("deploy.started", { payload: { environment: "staging" } }),
    );
    await runtime.bus.drain();
    expect((await api("GET", "/api/pet/tasks")).json.tasks).toEqual([
      expect.objectContaining({ state: "DEPLOYING", title: "Deploying to staging" }),
    ]);
  });
});

describe("permissions, confirmations, audit, kill switch", () => {
  it("approving a confirmation over the API completes the action", async () => {
    const { api, runtime } = await start();
    runtime.permissions.grant("github", ["external_api"]);
    const action = runtime.permissions.authorize({
      capabilityId: "github",
      command: "issue.create",
      permissions: ["external_api"],
      sideEffect: "external",
      summary: "Create issue",
    });
    await runtime.bus.drain();
    expect((await api("GET", "/api/pet/state")).json).toMatchObject({ state: "WAITING" });
    const [conf] = (await api("GET", "/api/confirmations")).json.confirmations;
    expect((await api("POST", `/api/confirmations/${conf.id}`, { approve: true })).status).toBe(
      200,
    );
    await expect(action).resolves.toMatchObject({ confirmationId: conf.id });
    await runtime.bus.drain();
    expect((await api("GET", "/api/pet/state")).json.state).toBe("IDLE");
    expect((await api("POST", `/api/confirmations/${conf.id}`, { approve: true })).status).toBe(
      404,
    );

    const audit = (await api("GET", "/api/audit?capability=github")).json.entries.map(
      (e: any) => e.action,
    );
    expect(audit).toContain("confirmation.approved");
    expect((await api("GET", "/api/permissions?capability=github")).json.grants).toHaveLength(1);
    await api("POST", "/api/permissions/github/revoke", {});
    expect((await api("GET", "/api/permissions?capability=github")).json.grants).toHaveLength(0);
    expect(
      (await api("POST", "/api/permissions/github/revoke", { permissions: ["bogus"] })).status,
    ).toBe(400);
  });

  it("kill switch toggles over the API and shows a warning", async () => {
    const { api, runtime } = await start();
    expect((await api("POST", "/api/security/kill-switch", { engaged: true })).json).toEqual({
      engaged: true,
    });
    await runtime.bus.drain();
    expect((await api("GET", "/api/security/kill-switch")).json).toEqual({ engaged: true });
    expect((await api("GET", "/api/pet/state")).json.state).toBe("WARNING");
    await api("POST", "/api/security/kill-switch", { engaged: false });
    await runtime.bus.drain();
    expect((await api("GET", "/api/pet/state")).json.state).toBe("IDLE");
  });
});

describe("capabilities", () => {
  const manifest = {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    description: "Demo capability",
    license: "GPL-3.0-or-later",
    events: ["build.*"],
    permissions: ["repository_access"],
    commands: [
      {
        name: "status",
        description: "Status",
        side_effect: "read",
        permissions: ["repository_access"],
      },
    ],
  };
  const demo = (status: () => unknown) => [{ manifest: manifest as never, commands: { status } }];

  it("builtin: list, enable, run a command, poll the operation, disable", async () => {
    const { api } = await start({}, { capabilities: demo(() => ({ clean: true })) });
    expect((await api("GET", "/api/capabilities")).json.capabilities).toEqual([
      expect.objectContaining({ id: "demo", status: "installed", kind: "builtin" }),
    ]);
    expect((await api("POST", "/api/capabilities/demo/commands/status", {})).json.code).toBe(
      "CAPABILITY_DISABLED",
    );
    expect((await api("POST", "/api/capabilities/demo/enable", {})).json.status).toBe("enabled");
    const op = await api("POST", "/api/capabilities/demo/commands/status", { input: {} });
    expect(op.status).toBe(202);
    let polled;
    for (let i = 0; i < 50; i++) {
      polled = (await api("GET", `/api/operations/${op.json.id}`)).json;
      if (polled.status === "succeeded") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(polled).toMatchObject({ status: "succeeded", result: { clean: true } });
    expect((await api("POST", "/api/capabilities/demo/disable", {})).json.status).toBe("disabled");
    expect((await api("GET", "/api/capabilities/nope")).status).toBe(404);
    expect((await api("GET", "/api/operations/op_nope")).status).toBe(404);
  });

  it("external: register over the API and submit events with the capability token", async () => {
    const { api, runtime } = await start();
    const ext = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/health" ? { status: "healthy" } : { ok: true }));
    });
    await new Promise<void>((r) => ext.listen(0, "127.0.0.1", () => r()));
    const endpoint = `http://127.0.0.1:${(ext.address() as { port: number }).port}`;
    try {
      const reg = await api("POST", "/api/capabilities/register", { manifest, endpoint });
      expect(reg.status).toBe(201);
      const capToken = reg.json.token as string;
      expect(reg.json.capability).toMatchObject({ id: "demo", kind: "external" });
      await api("POST", "/api/capabilities/demo/enable", {});

      const post = (body: unknown, token: string) =>
        api("POST", "/api/capabilities/demo/events", body, {
          authorization: "",
          "x-phoenix-capability-token": token,
        });
      expect((await post(event("build.started", { source: "demo" }), capToken)).status).toBe(202);
      expect((await post(event("build.started", { source: "demo" }), "wrong")).status).toBe(401);
      expect((await post(event("deploy.started", { source: "demo" }), capToken)).json.code).toBe(
        "SECURITY_POLICY_BLOCKED",
      );
      expect((await post(event("build.passed", { source: "terminal" }), capToken)).json.code).toBe(
        "SECURITY_POLICY_BLOCKED",
      );
      await runtime.bus.drain();
      expect((await api("GET", "/api/pet/state")).json.state).toBe("WORKING");

      const remote = await api("POST", "/api/capabilities/register", {
        manifest,
        endpoint: "http://192.168.1.2:1",
      });
      expect(remote.status).toBe(403);
      expect(
        (await api("POST", "/api/capabilities/demo/uninstall", { retain_data: false })).status,
      ).toBe(200);
      expect((await api("GET", "/api/capabilities")).json.capabilities).toEqual([]);
    } finally {
      ext.close();
    }
  });

  it("config endpoint rejects secrets", async () => {
    const { api } = await start({}, { capabilities: demo(() => 1) });
    const secret = await api("POST", "/api/capabilities/demo/config", {
      config: { password: "x" },
    });
    expect(secret.status).toBe(403);
    const ok = await api("POST", "/api/capabilities/demo/config", { config: { branch: "main" } });
    expect(ok.json.config).toEqual({ branch: "main" });
  });
});

describe("WebSocket", () => {
  it("rejects connections without a valid token", async () => {
    const { port } = await start();
    await expect(ws(port, "wrong").opened).rejects.toThrow("401");
  });

  it("streams state, tasks and events", async () => {
    const { port, api } = await start();
    const c = ws(port);
    await c.opened;
    expect(await c.next((m) => m.type === "hello")).toMatchObject({ protocol: "1.1" });
    c.send({ type: "subscribe", channels: ["state.changed", "event.created", "task.updated"] });
    await c.next((m) => m.type === "subscribed");
    expect(await c.next((m) => m.channel === "state.changed")).toMatchObject({
      data: { state: "IDLE" },
    });

    await api("POST", "/api/events", event("deploy.started", { payload: { environment: "prod" } }));
    expect(await c.next((m) => m.channel === "state.changed")).toMatchObject({
      data: { state: "DEPLOYING" },
    });
    expect(await c.next((m) => m.channel === "event.created")).toMatchObject({
      data: { event: { event_type: "deploy.started" } },
    });
    expect(
      await c.next((m) => m.channel === "task.updated" && m.data.tasks.length === 1),
    ).toBeTruthy();
  });

  it("replays missed events after reconnect with since_seq", async () => {
    const { port, api, runtime } = await start();
    const first = (await api("POST", "/api/events", event("build.started"))).json.seq;
    await api("POST", "/api/events", event("build.passed", { severity: "success" }));
    await runtime.bus.drain();

    const c = ws(port);
    await c.opened;
    c.send({ type: "subscribe", channels: ["event.created"], since_seq: first });
    const replayed = await c.next((m) => m.channel === "event.created");
    expect(replayed.data.event.event_type).toBe("build.passed");
    expect(runtime.health().websocket).toMatchObject({ reconnects: 1, connections: 1 });
  });

  it("reports bad subscribe messages", async () => {
    const { port } = await start();
    const c = ws(port);
    await c.opened;
    c.send({ type: "subscribe", channels: ["nope"] });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "INVALID_REQUEST" });
    c.ws.send("not json");
    expect(await c.next((m) => m.type === "error")).toMatchObject({ message: "Invalid JSON" });
  });
});
