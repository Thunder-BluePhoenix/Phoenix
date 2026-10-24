// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 72: the read-only countdown the desktop tray asks for, through the real runtime and HTTP
// API (real manager, bus and permission gateway) with the keep-awake capability on a fake machine:
// no caffeinate, systemd-inhibit or PowerShell ever runs.
import { createAwakeCapability, type AwakeModule } from "@phoenix/capability-awake";
import { FakeSystem } from "../../../capabilities/awake/testing/fakes";
import { afterEach, describe, expect, it } from "vitest";
import { AwakeStatusService } from "../src/awake-status";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const PATH = "/api/awake/status";
const NOTHING = { available: false, active: false };

async function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

/** Runs an awake command and answers its confirmation prompt like the user would. */
async function run(core: TestCore, command: string, input: unknown = {}): Promise<unknown> {
  const op = core.runtime.capabilities.invoke("awake", command, input, "user");
  for (let i = 0; i < 5_000 && (op.status === "pending" || op.status === "running"); i++) {
    for (const c of core.runtime.permissions.pendingConfirmations()) {
      core.runtime.permissions.resolveConfirmation(c.id, true);
    }
    await yieldToEventLoop();
  }
  expect(op.status).toBe("succeeded");
  return op.result;
}

async function boot() {
  const system = new FakeSystem({ platform: "darwin" });
  const holder: { core?: TestCore } = {};
  const awake = createAwakeCapability({
    env: system.env,
    battery: () => Promise.resolve({ kind: "none" }),
    feed: () => holder.core?.runtime.bus,
    modules: [] satisfies AwakeModule[],
    onSession: (session) => holder.core?.runtime.awakeStatus.bind(session),
  });
  const core = await startCore({}, { capabilities: [awake] });
  holder.core = core;
  cleanups.push(() => core.runtime.stop());
  return core;
}

describe("the tray countdown route through the running Core (Phase 72)", () => {
  it("needs the session token and routes only GET", async () => {
    const core = await boot();
    expect((await fetch(`${core.base}${PATH}`)).status).toBe(401);
    expect((await core.api("POST", PATH, {})).status).toBe(405);
  });

  it("says nothing is known until the capability has run, then that nothing runs", async () => {
    const core = await boot();
    expect((await core.api("GET", PATH)).json).toEqual(NOTHING);
    expect((await core.api("POST", "/api/capabilities/awake/enable", {})).status).toBe(200);
    expect((await core.api("GET", PATH)).json).toEqual({ available: true, active: false });
  });

  it("shows the running session's mode and seconds left, and nothing that identifies it", async () => {
    const core = await boot();
    await core.api("POST", "/api/capabilities/awake/enable", {});
    await run(core, "start", { minutes: 60, reason: "private label" });
    const res = await core.api("GET", PATH);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ available: true, active: true, mode: "timed" });
    expect(res.json.remaining_seconds).toBeGreaterThan(3_500);
    expect(res.json.remaining_seconds).toBeLessThanOrEqual(3_600);
    expect(Object.keys(res.json).sort()).toEqual([
      "active",
      "available",
      "mode",
      "remaining_seconds",
    ]);
    expect(JSON.stringify(res.json)).not.toContain("private label");

    await run(core, "end");
    expect((await core.api("GET", PATH)).json).toEqual({ available: true, active: false });
  });

  it("is unavailable again once the capability is disabled", async () => {
    const core = await boot();
    await core.api("POST", "/api/capabilities/awake/enable", {});
    await run(core, "start", { minutes: 5 });
    expect((await core.api("POST", "/api/capabilities/awake/disable", {})).status).toBe(200);
    expect((await core.api("GET", PATH)).json).toEqual(NOTHING);
  });

  it("rejects a query parameter without reading anything", async () => {
    const core = await boot();
    const res = await core.api("GET", `${PATH}?x=1`);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INVALID_REQUEST");
  });
});

describe("AwakeStatusService", () => {
  it("is unavailable before it is bound and when the status throws", () => {
    const svc = new AwakeStatusService();
    expect(svc.status()).toEqual(NOTHING);
    svc.bind({
      status: () => {
        throw new Error("boom");
      },
    });
    expect(svc.status()).toEqual(NOTHING);
    svc.bind(undefined);
    expect(svc.status()).toEqual(NOTHING);
  });

  it("keeps an agents_grace session without an end as null seconds", () => {
    const svc = new AwakeStatusService();
    svc.bind({
      status: () => ({
        active: true,
        session: {
          id: "awk_x",
          mode: "agents_grace",
          started_at: "2026-10-20T09:00:00.000Z",
          ends_at: null,
          remaining_seconds: null,
          agents_working: 2,
          grace_minutes: 10,
        },
        battery_floor_percent: 10,
        min_minutes: 1,
        max_minutes: 10080,
      }),
    });
    expect(svc.status()).toEqual({
      available: true,
      active: true,
      mode: "agents_grace",
      remaining_seconds: null,
    });
  });
});
