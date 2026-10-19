// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pollers of remote services pause when nothing is watching Core. This drives the real chain:
// a WebSocket client connects and disconnects, and a capability's context reports it.
import type { CapabilityContext, CapabilityModule } from "@phoenix/capability-manager";
import { afterEach, describe, expect, it } from "vitest";
import { connect, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface Probe {
  module: CapabilityModule;
  context(): CapabilityContext;
}

function probeCapability(): Probe {
  let captured: CapabilityContext | undefined;
  return {
    module: {
      manifest: {
        id: "presence-probe",
        name: "Presence probe",
        version: "1.0.0",
        description: "Reports whether anything is watching",
        license: "GPL-3.0-or-later",
        events: [],
        permissions: [],
        commands: [],
      },
      init(ctx) {
        captured = ctx;
      },
    },
    context() {
      if (!captured) throw new Error("capability was not initialised");
      return captured;
    },
  };
}

interface Running {
  core: TestCore;
  ctx: CapabilityContext;
  /** Resolves once Core has been told the connected-client count is `count`. */
  countIs(count: number): Promise<void>;
}

async function start(): Promise<Running> {
  const probe = probeCapability();
  const core = await startCore({}, { capabilities: [probe.module] });
  cleanups.push(() => core.runtime.stop());
  const seen: number[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  const original = core.runtime.viewersChanged.bind(core.runtime);
  core.runtime.viewersChanged = (count) => {
    original(count);
    seen.push(count);
    for (const w of waiters.filter((x) => x.count === count)) w.resolve();
  };
  expect((await core.api("POST", "/api/capabilities/presence-probe/enable", {})).status).toBe(200);
  return {
    core,
    ctx: probe.context(),
    countIs(count) {
      if (seen.at(-1) === count) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push({ count, resolve });
      return promise;
    },
  };
}

describe("viewer presence", () => {
  it("is watched at start, so a capability enabled before any window opens still works", async () => {
    const { ctx } = await start();
    expect(ctx.watched()).toBe(true);
  });

  it("follows WebSocket connections: unwatched with none, watched while one is open", async () => {
    const { core, ctx, countIs } = await start();

    const first = connect(core.port);
    await first.opened;
    await countIs(1);
    expect(ctx.watched()).toBe(true);
    first.ws.close();
    await countIs(0);
    expect(ctx.watched()).toBe(false);

    // Something connects again: a poller waiting on untilWatched() is released.
    const waiting = ctx.untilWatched();
    let released = false;
    void waiting.then(() => (released = true));
    expect(released).toBe(false);
    const second = connect(core.port);
    await second.opened;
    await waiting;
    expect(ctx.watched()).toBe(true);
    second.ws.close();
    await countIs(0);
    expect(ctx.watched()).toBe(false);
  });

  it("stays watched until the LAST of several clients leaves", async () => {
    const { core, ctx, countIs } = await start();
    const a = connect(core.port);
    const b = connect(core.port);
    await Promise.all([a.opened, b.opened]);
    await countIs(2);
    a.ws.close();
    await countIs(1);
    expect(ctx.watched()).toBe(true);
    b.ws.close();
    await countIs(0);
    expect(ctx.watched()).toBe(false);
  });

  it("releases a waiting poller when the capability is disabled", async () => {
    const { core, ctx, countIs } = await start();
    const client = connect(core.port);
    await client.opened;
    await countIs(1);
    client.ws.close();
    await countIs(0);
    const waiting = ctx.untilWatched();
    expect((await core.api("POST", "/api/capabilities/presence-probe/disable", {})).status).toBe(
      200,
    );
    await waiting;
    expect(ctx.signal.aborted).toBe(true);
  });
});
