// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 72: disable, the emergency stop and Core exit release the hold AND publish exactly one
// `awake.session.ended` through the real runtime (real manager, bus and permission gateway), on a
// fake machine.
import { createAwakeCapability } from "@phoenix/capability-awake";
import type { PhoenixEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FakeSystem } from "../../../capabilities/awake/testing/fakes";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function boot() {
  const system = new FakeSystem();
  const holder: { core?: TestCore } = {};
  const awake = createAwakeCapability({
    env: system.env,
    battery: () => Promise.resolve({ kind: "none" }),
    feed: () => holder.core?.runtime.bus,
  });
  const core = await startCore({}, { capabilities: [awake] });
  holder.core = core;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await core.runtime.stop();
  };
  cleanups.push(stop);
  const ended: PhoenixEvent[] = [];
  core.runtime.bus.subscribe("test.ended", "awake.session.ended", (e) => void ended.push(e));
  expect((await core.api("POST", "/api/capabilities/awake/enable", {})).status).toBe(200);
  return { core, system, ended, stop };
}

async function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

/** Runs a command and answers its confirmation prompt like the user would. */
async function run(core: TestCore, command: string, input: unknown = {}) {
  const op = core.runtime.capabilities.invoke("awake", command, input, "user");
  for (let i = 0; i < 5_000 && (op.status === "pending" || op.status === "running"); i++) {
    for (const c of core.runtime.permissions.pendingConfirmations()) {
      core.runtime.permissions.resolveConfirmation(c.id, true);
    }
    await yieldToEventLoop();
  }
  expect(op.status).toBe("succeeded");
}

describe("awake.session.ended when the capability is stopped (real PhoenixRuntime)", () => {
  it("disabling the capability mid-session releases the hold and publishes one ended event", async () => {
    const { core, system, ended } = await boot();
    await run(core, "start", { minutes: 30 });
    expect(system.alive).toHaveLength(1);
    expect((await core.api("POST", "/api/capabilities/awake/disable", {})).status).toBe(200);
    await core.runtime.bus.drain();
    expect(system.alive).toHaveLength(0);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ source: "awake", payload: { reason: "disabled" } });
  });

  it("the emergency stop releases the hold and publishes one ended event", async () => {
    const { core, system, ended } = await boot();
    await run(core, "start", { minutes: 30 });
    core.runtime.permissions.engageKillSwitch("test");
    await core.runtime.bus.drain();
    await core.runtime.bus.drain();
    expect(system.alive).toHaveLength(0);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ source: "awake", payload: { reason: "kill_switch" } });
  });

  it("stopping Core releases the hold and the bus still delivers one ended event", async () => {
    const { system, core, ended, stop } = await boot();
    await run(core, "start", { minutes: 30 });
    await stop();
    expect(system.alive).toHaveLength(0);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ source: "awake", payload: { reason: "shutdown" } });
  });

  it("a normal end publishes exactly one ended event, and a later disable adds none", async () => {
    const { core, system, ended } = await boot();
    await run(core, "start", { minutes: 30 });
    await run(core, "end");
    await core.api("POST", "/api/capabilities/awake/disable", {});
    await core.runtime.bus.drain();
    expect(system.alive).toHaveLength(0);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.payload.reason).toBe("cancelled");
  });

  it("disabling with no session publishes no ended event", async () => {
    const { core, ended } = await boot();
    await core.api("POST", "/api/capabilities/awake/disable", {});
    await core.runtime.bus.drain();
    expect(ended).toHaveLength(0);
  });
});
