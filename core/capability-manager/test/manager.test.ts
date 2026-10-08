// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { EventBus } from "@phoenix/event-bus";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, openDatabase, type Database } from "@phoenix/persistence";
import {
  createEvent,
  ErrorCode,
  PhoenixError,
  type CapabilityManifest,
  type PhoenixEvent,
} from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityManager, type CapabilityModule } from "../src";

const managers: CapabilityManager[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.close();
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

function setup(db: Database = openDatabase(":memory:")) {
  const events = new EventStore(db);
  const bus = new EventBus({ store: events, retryDelayMs: 0 });
  const published: PhoenixEvent[] = [];
  bus.subscribe("test", "*", (e) => void published.push(e));
  const state = new StateEngine();
  bus.subscribe("state", "*", (e) => void state.handle(e));
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  const manager = new CapabilityManager({
    db,
    bus,
    events,
    permissions,
    state,
    callTimeoutMs: 300,
    defaultHealthIntervalMs: 60_000,
  });
  managers.push(manager);
  const types = () => published.map((e) => e.event_type);
  return { db, bus, events, state, permissions, manager, published, types };
}

const manifest = (over: Partial<CapabilityManifest> = {}): CapabilityManifest => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  description: "Test capability",
  license: "GPL-3.0-or-later",
  events: ["build.*", "demo.*"],
  permissions: ["repository_access"],
  commands: [
    {
      name: "status",
      description: "Read status",
      side_effect: "read",
      permissions: ["repository_access"],
    },
    { name: "deploy", description: "Deploy the thing", side_effect: "production", permissions: [] },
  ],
  state_rules: [
    { match: "demo.thinking", effect: { state: "THINKING", explain: "Demo is thinking" } },
  ],
  ...over,
});

function builtin(over: Partial<CapabilityModule> = {}, m = manifest()): CapabilityModule {
  return {
    manifest: m,
    commands: { status: () => ({ ok: true }), deploy: () => "deployed" },
    ...over,
  };
}

async function errCode(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
    return "ok";
  } catch (e) {
    return e instanceof PhoenixError ? e.code : String(e);
  }
}

describe("registration", () => {
  it("rejects invalid manifests and missing handlers", async () => {
    const { manager } = setup();
    expect(
      await errCode(() => manager.registerBuiltin(builtin({}, { ...manifest(), id: "core" }))),
    ).toBe(ErrorCode.INVALID_REQUEST);
    expect(
      await errCode(() => manager.registerBuiltin(builtin({ commands: { status: () => 1 } }))),
    ).toBe(ErrorCode.INVALID_REQUEST);
  });

  it("applies the reserved-namespace rule to in-process modules too, not only to external ones", async () => {
    // state_rules is cleared: otherwise its "demo.thinking" rule no longer matches a declared
    // event and rejects the manifest for an unrelated reason.
    const base = { ...manifest(), state_rules: [] };
    // Positive control: the same manifest is accepted, so the rejections below are about events.
    expect(await errCode(() => setup().manager.registerBuiltin(builtin({}, base)))).toBe("ok");
    for (const events of [["security.*"], ["capability.failed"], ["pet.state.changed"]]) {
      const { manager } = setup();
      expect(await errCode(() => manager.registerBuiltin(builtin({}, { ...base, events })))).toBe(
        ErrorCode.INVALID_REQUEST,
      );
      expect(manager.list()).toEqual([]);
    }
  });

  it("lists capabilities with permission disclosure", () => {
    const { manager } = setup();
    manager.registerBuiltin(builtin());
    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: "demo",
        status: "installed",
        permissions: [
          {
            permission: "repository_access",
            description: "Access source code repositories",
            granted: false,
          },
        ],
      }),
    ]);
    expect(() => manager.registerBuiltin(builtin())).toThrow(PhoenixError);
  });
});

describe("lifecycle", () => {
  it("enable grants declared permissions, inits, and emits events", async () => {
    const { manager, types, permissions, bus } = setup();
    let initCtx: unknown;
    manager.registerBuiltin(builtin({ init: (ctx) => void (initCtx = ctx) }));
    const view = await manager.enable("demo");
    await bus.drain();
    expect(view.status).toBe("enabled");
    expect(initCtx).toMatchObject({ id: "demo" });
    expect(permissions.grants.has("demo", "repository_access")).toBe(true);
    expect(types()).toEqual(
      expect.arrayContaining([
        "capability.registered",
        "capability.enabled",
        "capability.available",
      ]),
    );
  });

  it("a throwing or hanging init leaves core healthy and marks the capability failed", async () => {
    const { manager, state, bus } = setup();
    manager.registerBuiltin(
      builtin({
        init: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(await errCode(manager.enable("demo"))).toBe(ErrorCode.CAPABILITY_UNAVAILABLE);
    expect(manager.get("demo")).toMatchObject({ status: "failed", lastError: "boom" });
    await bus.drain();
    expect(state.snapshot()).toMatchObject({ state: "ERROR", explanation: "Demo failed to start" });

    const s2 = setup();
    s2.manager.registerBuiltin(builtin({ init: () => new Promise(() => {}) }));
    expect(await errCode(s2.manager.enable("demo"))).toBe(ErrorCode.CAPABILITY_UNAVAILABLE);
    expect(s2.manager.get("demo").lastError).toBe("Operation timed out");
  });

  it("disable aborts the context, calls shutdown and removes state rules", async () => {
    const { manager, state, bus } = setup();
    let signal: AbortSignal | undefined;
    let shutdown = 0;
    let ctxRef: { emit: (e: never) => { ok: boolean } } | undefined;
    manager.registerBuiltin(
      builtin({
        init: (ctx) => {
          signal = ctx.signal;
          ctxRef = ctx as never;
        },
        shutdown: () => void shutdown++,
      }),
    );
    await manager.enable("demo");
    ctxRef!.emit({ event_type: "demo.thinking", severity: "info" } as never);
    await bus.drain();
    expect(state.snapshot().state).toBe("THINKING");

    await manager.disable("demo");
    expect(signal!.aborted).toBe(true);
    expect(shutdown).toBe(1);
    expect(ctxRef!.emit({ event_type: "demo.thinking", severity: "info" } as never).ok).toBe(false);
    state.handle(
      createEvent({
        event_type: "demo.thinking",
        source: "demo",
        severity: "info",
        correlation_id: "x",
      }),
    );
    expect(
      state.snapshot().conditions.some((c) => c.state === "THINKING" && c.key === "corr:x"),
    ).toBe(false);
  });

  it("restores enabled builtins after restart; new permissions need the user", async () => {
    const db = openDatabase(":memory:");
    const first = setup(db);
    first.manager.registerBuiltin(builtin());
    await first.manager.enable("demo");

    const second = setup(db);
    second.manager.registerBuiltin(builtin());
    await second.manager.restore();
    expect(second.manager.get("demo").status).toBe("enabled");

    const third = setup(db);
    third.manager.registerBuiltin(
      builtin({}, { ...manifest(), permissions: ["repository_access", "network"] }),
    );
    await third.manager.restore();
    expect(third.manager.get("demo").status).toBe("installed");
  });

  it("uninstall revokes permissions and deletes history unless retained", async () => {
    const { manager, permissions, events, bus } = setup();
    let ctx: { emit: (e: never) => unknown } | undefined;
    manager.registerBuiltin(builtin({ init: (c) => void (ctx = c as never) }));
    await manager.enable("demo");
    ctx!.emit({ event_type: "build.started", severity: "info" } as never);
    await bus.drain();
    expect(events.recent({ source: "demo" })).toHaveLength(1);
    await manager.uninstall("demo");
    expect(permissions.grants.list("demo")).toEqual([]);
    expect(events.recent({ source: "demo" })).toHaveLength(0);
    expect(manager.list()).toEqual([]);
  });
});

describe("configuration", () => {
  it("validates against config_schema and refuses secrets", () => {
    const { manager } = setup();
    manager.registerBuiltin(
      builtin(
        {},
        manifest({
          config_schema: {
            type: "object",
            properties: { repo: { type: "string" } },
            additionalProperties: false,
          },
        }),
      ),
    );
    expect(manager.configure("demo", { repo: "phoenix" }).config).toEqual({ repo: "phoenix" });
    expect(() => manager.configure("demo", { repo: 5 })).toThrow(PhoenixError);
    expect(() => manager.configure("demo", { api_key: "x" })).toThrow(PhoenixError);
  });
});

describe("events from capabilities", () => {
  it("only declared event types under the capability's own source are accepted", async () => {
    const { manager } = setup();
    let ctx: { emit: (e: never) => { ok: boolean; error?: PhoenixError } } | undefined;
    manager.registerBuiltin(builtin({ init: (c) => void (ctx = c as never) }));
    await manager.enable("demo");
    expect(ctx!.emit({ event_type: "build.started", severity: "info" } as never).ok).toBe(true);
    const r = ctx!.emit({ event_type: "deploy.started", severity: "info" } as never);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
  });
});

describe("commands", () => {
  it("read commands run without confirmation and report results", async () => {
    const { manager, types, bus } = setup();
    manager.registerBuiltin(builtin());
    await manager.enable("demo");
    const op = await manager.invokeAndWait("demo", "status");
    expect(op).toMatchObject({ status: "succeeded", result: { ok: true } });
    await bus.drain();
    expect(types()).toContain("capability.command.completed");
  });

  it("production commands wait for user confirmation", async () => {
    const { manager, permissions } = setup();
    manager.registerBuiltin(builtin());
    await manager.enable("demo");
    const op = manager.invoke("demo", "deploy");
    await new Promise((r) => setTimeout(r, 10));
    expect(op.status).toBe("pending");
    const [conf] = permissions.pendingConfirmations();
    expect(conf?.summary).toBe("Demo: Deploy the thing");
    permissions.resolveConfirmation(conf!.id, false);
    await new Promise((r) => setTimeout(r, 10));
    expect(op).toMatchObject({ status: "failed", error: { code: ErrorCode.PERMISSION_DENIED } });
  });

  it("validates input, rejects unknown commands and disabled capabilities", async () => {
    const { manager } = setup();
    manager.registerBuiltin(
      builtin(
        {},
        manifest({
          commands: [
            {
              name: "status",
              description: "s",
              side_effect: "read",
              input_schema: { type: "object", required: ["repo"] },
            },
            { name: "deploy", description: "d", side_effect: "production" },
          ],
        }),
      ),
    );
    expect(await errCode(() => manager.invoke("demo", "status"))).toBe(
      ErrorCode.CAPABILITY_DISABLED,
    );
    await manager.enable("demo");
    expect(await errCode(() => manager.invoke("demo", "nope"))).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(await errCode(() => manager.invoke("demo", "status", {}))).toBe(
      ErrorCode.INVALID_REQUEST,
    );
    expect(await errCode(() => manager.invoke("demo", "status", { repo: "x", token: "y" }))).toBe(
      ErrorCode.SECURITY_POLICY_BLOCKED,
    );
  });

  it("a throwing or hanging command fails its operation, not core", async () => {
    const { manager } = setup();
    manager.registerBuiltin(
      builtin({
        commands: {
          status: () => {
            throw new Error("bad");
          },
          deploy: () => new Promise(() => {}),
        },
      }),
    );
    await manager.enable("demo");
    expect(await manager.invokeAndWait("demo", "status")).toMatchObject({
      status: "failed",
      error: { message: "bad" },
    });
    // production → needs confirmation first
    const op = manager.invoke("demo", "deploy");
    await new Promise((r) => setTimeout(r, 10));
    manager["o"].permissions.resolveConfirmation(
      manager["o"].permissions.pendingConfirmations()[0]!.id,
      true,
    );
    while (op.status === "pending" || op.status === "running")
      await new Promise((r) => setTimeout(r, 10));
    expect(op.error?.code).toBe(ErrorCode.OPERATION_TIMEOUT);
  });
});

describe("health", () => {
  it("emits availability transitions only once each", async () => {
    const { manager, types, state, bus } = setup();
    let healthy = true;
    manager.registerBuiltin(
      builtin({
        health: () => ({ status: healthy ? "healthy" : "unhealthy", message: "db down" }),
      }),
    );
    await manager.enable("demo");
    await manager.checkHealth("demo");
    healthy = false;
    await manager.checkHealth("demo");
    await manager.checkHealth("demo");
    await bus.drain();
    expect(types().filter((t) => t === "capability.unavailable")).toHaveLength(1);
    expect(state.snapshot()).toMatchObject({
      state: "WARNING",
      explanation: "Demo is unavailable",
    });
    expect(manager.get("demo").health).toMatchObject({ status: "unhealthy", message: "db down" });
    healthy = true;
    await manager.checkHealth("demo");
    await bus.drain();
    expect(state.snapshot().state).toBe("IDLE");
  });
});

describe("kill switch", () => {
  it("disables every enabled capability and blocks enabling", async () => {
    const { manager, permissions, bus } = setup();
    manager.registerBuiltin(builtin());
    await manager.enable("demo");
    permissions.engageKillSwitch();
    await bus.drain();
    expect(manager.get("demo")).toMatchObject({
      status: "disabled",
      disabledReason: "kill_switch",
    });
    expect(await errCode(manager.enable("demo"))).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
  });
});

describe("external capabilities (separate process)", () => {
  async function spawnExternal() {
    const script = fileURLToPath(new URL("./fixtures/external-capability.mjs", import.meta.url));
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
    children.push(child);
    const [line] = (await once(child.stdout!, "data")) as [Buffer];
    const { port } = JSON.parse(line.toString()) as { port: number };
    return { child, endpoint: `http://127.0.0.1:${port}` };
  }

  const extManifest = () =>
    manifest({
      id: "ext",
      name: "External",
      state_rules: [],
      commands: [
        { name: "echo", description: "Echo", side_effect: "read", permissions: [] },
        { name: "explode", description: "Fails", side_effect: "none", permissions: [] },
      ],
    });

  it("rejects weak callback secrets", async () => {
    const { manager } = setup();
    expect(
      await errCode(manager.registerExternal(extManifest(), "http://127.0.0.1:9", "short")),
    ).toBe(ErrorCode.INVALID_REQUEST);
  });

  it("only loopback endpoints are allowed", async () => {
    const { manager } = setup();
    expect(await errCode(manager.registerExternal(extManifest(), "http://10.0.0.5:9000"))).toBe(
      ErrorCode.SECURITY_POLICY_BLOCKED,
    );
  });

  it("runs commands, authenticates events, and survives the process being killed", async () => {
    const { manager, bus, state } = setup();
    const { child, endpoint } = await spawnExternal();
    const { token } = await manager.registerExternal(extManifest(), endpoint);
    await fetch(`${endpoint}/__set_token`, { method: "POST", body: JSON.stringify({ token }) });

    await manager.enable("ext");
    expect(await manager.invokeAndWait("ext", "echo", { hi: 1 })).toMatchObject({
      status: "succeeded",
      result: { echoed: { hi: 1 } },
    });
    expect(await manager.invokeAndWait("ext", "explode")).toMatchObject({
      status: "failed",
      error: { message: "kaboom" },
    });

    const ev = createEvent({ event_type: "build.started", source: "ext", severity: "info" });
    expect(manager.ingest("ext", token, ev).ok).toBe(true);
    expect(await errCode(() => manager.ingest("ext", "wrong", ev))).toBe(ErrorCode.UNAUTHENTICATED);
    expect(
      manager.ingest(
        "ext",
        token,
        createEvent({ event_type: "build.passed", source: "other", severity: "info" }),
      ).ok,
    ).toBe(false);

    child.kill("SIGKILL");
    await once(child, "exit");
    const view = await manager.checkHealth("ext");
    expect(view.health.status).toBe("unhealthy");
    await bus.drain();
    expect(state.snapshot()).toMatchObject({
      state: "WARNING",
      explanation: "External is unavailable",
    });
    expect(await manager.invokeAndWait("ext", "echo")).toMatchObject({
      status: "failed",
      error: { code: ErrorCode.CAPABILITY_UNAVAILABLE },
    });
  });

  it("shows disconnected externals after restart and resumes them on re-register", async () => {
    const db = openDatabase(":memory:");
    const first = setup(db);
    const a = await spawnExternal();
    await first.manager.registerExternal(extManifest(), a.endpoint);
    await first.manager.enable("ext");

    const second = setup(db);
    await second.manager.restore();
    expect(second.manager.list()).toEqual([
      expect.objectContaining({ id: "ext", status: "disconnected" }),
    ]);
    const b = await spawnExternal();
    const { capability } = await second.manager.registerExternal(extManifest(), b.endpoint);
    expect(capability.status).toBe("enabled");
  });
});
