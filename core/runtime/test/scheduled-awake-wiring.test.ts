// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAwakeCapability } from "@phoenix/capability-awake";
import { afterEach, describe, expect, it } from "vitest";
import { FakeSystem, settle } from "../../../capabilities/awake/testing/fakes";
import type { PowerSnapshot } from "../src/scheduled-awake/power";
import { parseLowPowerMode } from "../src/scheduled-awake/system-power";
import { ScheduledAwakeService, SCHEDULED_AWAKE_KEY } from "../src/scheduled-awake/service";
import { startCore, type ApiResponse, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const HOUR = 3_600_000;
/** FakeClock starts at 2026-10-20T09:00:00Z. */
const NIGHT = {
  id: "nightly",
  label: "Overnight build",
  timeZone: "UTC",
  start: "10:00",
  end: "12:00",
  days: [0, 1, 2, 3, 4, 5, 6],
};

interface Rig {
  core: TestCore;
  system: FakeSystem;
  power: { current: PowerSnapshot };
}

async function boot(databasePath?: string, system = new FakeSystem()): Promise<Rig> {
  const power = { current: { battery: { kind: "none" }, lowPowerMode: false } as PowerSnapshot };
  const holder: { core?: TestCore } = {};
  const awake = createAwakeCapability({
    env: system.env,
    battery: () => Promise.resolve({ kind: "none" }),
    feed: () => holder.core?.runtime.bus,
    onSession: (session) => holder.core?.runtime.scheduledAwake.bindSession(session),
  });
  const core = await startCore(
    {},
    {
      capabilities: [awake],
      runtime: {
        scheduledAwake: {
          clock: system.clock,
          power: { read: () => Promise.resolve(power.current) },
        },
        ...(databasePath ? { databasePath } : {}),
      },
    },
  );
  holder.core = core;
  cleanups.push(() => core.runtime.stop());
  return { core, system, power };
}

async function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 5_000 && !done(); i++) await yieldToEventLoop();
  expect(done()).toBe(true);
}

/** Starts a request that waits for the user, answers the prompt, and returns the response. */
async function answered(
  core: TestCore,
  approve: boolean,
  request: () => Promise<ApiResponse>,
): Promise<{ response: ApiResponse; summary: string }> {
  const pending = request();
  await until(() => core.runtime.permissions.pendingConfirmations().length === 1);
  const confirmation = core.runtime.permissions.pendingConfirmations()[0]!;
  core.runtime.permissions.resolveConfirmation(confirmation.id, approve);
  return { response: await pending, summary: confirmation.summary };
}

const turnOn = (rig: Rig) =>
  answered(rig.core, true, () => rig.core.api("PUT", "/api/scheduled-awake", { enabled: true }));
const save = (rig: Rig, spec: unknown = NIGHT) =>
  answered(rig.core, true, () => rig.core.api("POST", "/api/scheduled-awake/schedules", spec));

async function ready(): Promise<Rig> {
  const rig = await boot();
  expect((await rig.core.api("POST", "/api/capabilities/awake/enable", {})).status).toBe(200);
  expect((await save(rig)).response.status).toBe(200);
  expect((await turnOn(rig)).response.status).toBe(200);
  return rig;
}

const status = async (rig: Rig) => (await rig.core.api("GET", "/api/scheduled-awake")).json;

describe("scheduled awake windows through the running Core", () => {
  it("is off by default, holds nothing, and needs the session token", async () => {
    const rig = await boot();
    expect(await status(rig)).toMatchObject({ enabled: false, state: "off", schedules: [] });
    expect((await fetch(`${rig.core.base}/api/scheduled-awake`)).status).toBe(401);
    await rig.system.clock.advance(24 * HOUR);
    expect(rig.system.children).toEqual([]);
  });

  it("asks before turning on and before saving a window, and a refusal changes nothing", async () => {
    const rig = await boot();
    const refusedOn = await answered(rig.core, false, () =>
      rig.core.api("PUT", "/api/scheduled-awake", { enabled: true }),
    );
    expect(refusedOn.response.status).not.toBe(200);
    expect((await status(rig)).enabled).toBe(false);

    const refusedSave = await answered(rig.core, false, () =>
      rig.core.api("POST", "/api/scheduled-awake/schedules", NIGHT),
    );
    expect(refusedSave.response.status).not.toBe(200);
    expect(refusedSave.summary).toContain("10:00 to 12:00");
    expect((await status(rig)).schedules).toEqual([]);
  });

  it("holds the machine for the window and releases it when the window ends, without asking again", async () => {
    const rig = await ready();
    expect(await rig.core.api("POST", "/api/capabilities/awake/status", {})).toBeDefined();
    expect((await status(rig)).state).toBe("idle");

    await rig.system.clock.advance(1 * HOUR + 1_000);
    await until(() => rig.system.alive.length === 1);
    expect(await status(rig)).toMatchObject({ state: "holding", awakeAvailable: true });
    expect(rig.core.runtime.permissions.pendingConfirmations()).toEqual([]);

    await rig.system.clock.advance(2 * HOUR);
    await until(() => rig.system.alive.length === 0);
    expect(await status(rig)).toMatchObject({ state: "idle", holdEndsAt: null });
  });

  it("waits, and says why, while the keep-awake capability is off", async () => {
    const rig = await boot();
    expect((await save(rig)).response.status).toBe(200);
    expect((await turnOn(rig)).response.status).toBe(200);
    await rig.system.clock.advance(1 * HOUR + 1_000);
    await settle();
    expect(await status(rig)).toMatchObject({
      state: "waiting",
      waitingReason: "start_failed",
      awakeAvailable: false,
    });
    expect(rig.system.children).toEqual([]);
  });

  it("does not hold on battery when the schedule requires a charger", async () => {
    const rig = await boot();
    await rig.core.api("POST", "/api/capabilities/awake/enable", {});
    await save(rig, { ...NIGHT, requireCharger: true });
    await turnOn(rig);
    rig.power.current = {
      battery: { kind: "battery", percent: 90, onBattery: true },
      lowPowerMode: false,
    };
    await rig.system.clock.advance(1 * HOUR + 1_000);
    await settle();
    expect(await status(rig)).toMatchObject({ state: "waiting", waitingReason: "needs_charger" });
    expect(rig.system.children).toEqual([]);
  });

  it("cancelling the current window releases the hold at once and does not ask", async () => {
    const rig = await ready();
    await rig.system.clock.advance(1 * HOUR + 1_000);
    await until(() => rig.system.alive.length === 1);
    const cancelled = await rig.core.api("POST", "/api/scheduled-awake/cancel-current");
    expect(cancelled.status).toBe(200);
    expect(cancelled.json.skipped).toEqual(["nightly@2026-10-20"]);
    await until(() => rig.system.alive.length === 0);
    await rig.system.clock.advance(30 * 60_000);
    expect(rig.system.alive).toEqual([]);
  });

  it("the emergency stop releases the hold, turns scheduling off, and turning it back on is refused while engaged", async () => {
    const rig = await ready();
    await rig.system.clock.advance(1 * HOUR + 1_000);
    await until(() => rig.system.alive.length === 1);
    rig.core.runtime.permissions.engageKillSwitch("test");
    await rig.core.runtime.bus.drain();
    await until(() => rig.system.alive.length === 0);
    await until(() => !rig.core.runtime.scheduledAwake.status().enabled);
    const again = await rig.core.api("PUT", "/api/scheduled-awake", { enabled: true });
    expect(again.status).toBe(403);
    await rig.system.clock.advance(HOUR);
    expect(rig.system.alive).toEqual([]);
  });

  it("keeps its schedules across a restart, still off until the user turns it on", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "phoenix-awake-")), "core.db");
    const first = await boot(databasePath);
    expect((await save(first)).response.status).toBe(200);
    await first.core.runtime.stop();

    const second = await boot(databasePath);
    const restored = await status(second);
    expect(restored.enabled).toBe(false);
    expect(restored.schedules.map((s: { id: string }) => s.id)).toEqual(["nightly"]);
  });

  it("refuses a malformed schedule before asking, and an unsafe stored one is dropped on load", async () => {
    const rig = await boot();
    const bad = await rig.core.api("POST", "/api/scheduled-awake/schedules", {
      ...NIGHT,
      start: "25:00",
    });
    expect(bad.status).toBe(400);
    expect(rig.core.runtime.permissions.pendingConfirmations()).toEqual([]);
    const extra = await rig.core.api("POST", "/api/scheduled-awake/schedules", {
      ...NIGHT,
      command: "rm -rf /",
    });
    expect(extra.status).toBe(400);
    expect((await rig.core.api("PUT", "/api/scheduled-awake", { enabled: "yes" })).status).toBe(
      400,
    );
    expect((await rig.core.api("DELETE", "/api/scheduled-awake/schedules/..%2Fx")).status).toBe(
      400,
    );
    expect(
      (await rig.core.api("POST", "/api/scheduled-awake/skips", { key: "nightly" })).status,
    ).toBe(400);
  });

  it("drops a stored schedule that no longer validates and keeps the opt-in the user confirmed", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "phoenix-awake-")), "core.db");
    const first = await boot(databasePath);
    first.core.runtime.settings.set(SCHEDULED_AWAKE_KEY, {
      version: 1,
      enabled: true,
      schedules: [
        { ...NIGHT, start: "99:99" },
        { ...NIGHT, id: "ok" },
      ],
      skips: [],
    });
    await first.core.runtime.stop();
    const second = await boot(databasePath);
    const restored = await status(second);
    expect(restored.schedules.map((s: { id: string }) => s.id)).toEqual(["ok"]);
    expect(restored.enabled).toBe(true);
    const dropped = second.core.runtime.permissions.audit
      .list({ limit: 50 })
      .filter((e) => e.action === "scheduled_awake.store.dropped");
    expect(dropped).toHaveLength(1);
  });

  it("deleting, skipping and turning off are audited and need no prompt", async () => {
    const rig = await ready();
    const skipped = await rig.core.api("POST", "/api/scheduled-awake/skips", {
      key: "nightly@2026-10-20",
    });
    expect(skipped.status).toBe(200);
    expect(skipped.json.skips).toEqual(["nightly@2026-10-20"]);
    expect(
      (await rig.core.api("DELETE", "/api/scheduled-awake/skips/nightly@2026-10-20")).status,
    ).toBe(200);
    expect((await rig.core.api("PUT", "/api/scheduled-awake", { enabled: false })).status).toBe(
      200,
    );
    expect((await rig.core.api("DELETE", "/api/scheduled-awake/schedules/nightly")).status).toBe(
      200,
    );
    expect(rig.core.runtime.permissions.pendingConfirmations()).toEqual([]);
    const actions = rig.core.runtime.permissions.audit.list({ limit: 200 }).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "scheduled_awake.skip",
        "scheduled_awake.unskip",
        "scheduled_awake.disable",
        "scheduled_awake.remove_schedule",
      ]),
    );
  });
});

describe("reading Low Power Mode", () => {
  it("reads the lowpowermode line of pmset -g and nothing else", () => {
    expect(parseLowPowerMode(" sleep 1\n lowpowermode 1\n womp 0\n")).toBe(true);
    expect(parseLowPowerMode(" sleep 1\n lowpowermode 0\n")).toBe(false);
    expect(parseLowPowerMode(" sleep 1\n womp 0\n")).toBeNull();
    expect(parseLowPowerMode("xlowpowermode 1")).toBeNull();
    expect(parseLowPowerMode("lowpowermode 2")).toBeNull();
  });
});

describe("the start guard, without the emergency-stop hook", () => {
  it("never starts a hold while the emergency stop is engaged, even if scheduling is still on", async () => {
    const system = new FakeSystem();
    let engaged = false;
    const service = new ScheduledAwakeService({
      settings: {
        get: (_key: string, fallback: unknown) => fallback,
        set: () => undefined,
      } as never,
      permissions: {
        authorize: () => Promise.resolve({ request: {} }) as never,
        recordOutcome: () => undefined,
        isKillSwitchEngaged: () => engaged,
      },
      audit: { record: () => ({}) as never },
      clock: system.clock,
      power: { read: () => Promise.resolve({ battery: { kind: "none" }, lowPowerMode: false }) },
    });
    let started = 0;
    service.bindSession({
      active: () => null,
      start: () => {
        started++;
        return Promise.reject(new Error("must not be reached"));
      },
    } as never);
    await service.start();
    await service.upsertSchedule(NIGHT);
    await service.setEnabled(true);
    engaged = true;
    await system.clock.advance(1 * HOUR + 1_000);
    expect(started).toBe(0);
    expect(service.status()).toMatchObject({ state: "waiting", waitingReason: "start_failed" });
    await service.close();
  });
});
