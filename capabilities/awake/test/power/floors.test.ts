// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLOORS,
  FloorWatcher,
  UNKNOWN_READS_BEFORE_END,
  floorsFromConfig,
  judgeFloors,
  type EndReason,
  type FloorPorts,
  type LowPowerResult,
} from "../../src/power/floors";
import {
  levelForSpeedLimit,
  parseTherm,
  thermalAtLeast,
  type ThermalReading,
} from "../../src/power/thermal";
import type { BatteryReading } from "../../src/system";

const bat = (percent: number, onBattery = true): BatteryReading => ({
  kind: "battery",
  percent,
  onBattery,
});
const heat = (level: "nominal" | "fair" | "serious" | "critical"): ThermalReading => ({
  kind: "level",
  level,
});
const NOMINAL = heat("nominal");

describe("judgeFloors: battery boundaries (40 / 10, strictly below)", () => {
  it.each([
    [41, false, null],
    [40, false, null],
    [39, true, null],
    [11, true, null],
    [10, true, null],
    [9, true, "battery"],
    [0, true, "battery"],
  ] as const)("%i %% on battery -> lowPower %s, end %s", (percent, lowPower, end) => {
    const v = judgeFloors(DEFAULT_FLOORS, bat(percent), NOMINAL);
    expect(v.lowPower).toBe(lowPower);
    expect(v.end).toBe(end);
  });

  it("battery rules do not apply on AC power or without a battery", () => {
    expect(judgeFloors(DEFAULT_FLOORS, bat(5, false), NOMINAL)).toMatchObject({
      lowPower: false,
      end: null,
    });
    expect(judgeFloors(DEFAULT_FLOORS, { kind: "none" }, NOMINAL)).toMatchObject({
      lowPower: false,
      end: null,
      batteryUnknown: false,
    });
  });

  it("an unknown battery is flagged unknown, never read as fine", () => {
    expect(judgeFloors(DEFAULT_FLOORS, { kind: "unknown" }, NOMINAL).batteryUnknown).toBe(true);
  });

  it("releases Low Power Mode only 5 points above the floor (no flapping at 40)", () => {
    expect(judgeFloors(DEFAULT_FLOORS, bat(41), NOMINAL).clear).toBe(false);
    expect(judgeFloors(DEFAULT_FLOORS, bat(44), NOMINAL).clear).toBe(false);
    expect(judgeFloors(DEFAULT_FLOORS, bat(45), NOMINAL).clear).toBe(true);
  });
});

describe("judgeFloors: heat", () => {
  it("serious -> Low Power Mode, critical -> end", () => {
    expect(judgeFloors(DEFAULT_FLOORS, { kind: "none" }, heat("fair"))).toMatchObject({
      lowPower: false,
      end: null,
    });
    expect(judgeFloors(DEFAULT_FLOORS, { kind: "none" }, heat("serious"))).toMatchObject({
      lowPower: true,
      end: null,
      clear: false,
    });
    expect(judgeFloors(DEFAULT_FLOORS, { kind: "none" }, heat("critical"))).toMatchObject({
      lowPower: true,
      end: "thermal",
    });
  });

  it("battery wins as the reason when both floors trip", () => {
    expect(judgeFloors(DEFAULT_FLOORS, bat(5), heat("critical")).end).toBe("battery");
  });

  it("an unsupported heat source is not unknown (other platforms), an unreadable one is", () => {
    expect(judgeFloors(DEFAULT_FLOORS, bat(80), { kind: "unsupported" }).thermalUnknown).toBe(
      false,
    );
    expect(judgeFloors(DEFAULT_FLOORS, bat(80), { kind: "unknown" }).thermalUnknown).toBe(true);
  });
});

describe("floorsFromConfig", () => {
  it("defaults are on, 40 / 10, serious / critical", () => {
    expect(floorsFromConfig({})).toEqual({
      enabled: true,
      lowPowerPercent: 40,
      endPercent: 10,
      thermalLowPower: "serious",
      thermalEnd: "critical",
    });
  });

  it("only an explicit false turns the floors off", () => {
    expect(floorsFromConfig({ floors_enabled: false }).enabled).toBe(false);
    for (const v of [0, "false", null, undefined, "off"])
      expect(floorsFromConfig({ floors_enabled: v }).enabled).toBe(true);
  });

  it("accepts valid values", () => {
    expect(
      floorsFromConfig({
        floor_low_power_percent: 50,
        floor_end_percent: 20,
        floor_thermal_low_power: "fair",
        floor_thermal_end: "serious",
      }),
    ).toMatchObject({
      lowPowerPercent: 50,
      endPercent: 20,
      thermalLowPower: "fair",
      thermalEnd: "serious",
    });
  });

  it.each([
    [{ floor_low_power_percent: 0 }],
    [{ floor_low_power_percent: 101 }],
    [{ floor_low_power_percent: 40.5 }],
    [{ floor_low_power_percent: "40" }],
    [{ floor_end_percent: 0 }],
    [{ floor_thermal_low_power: "nominal" }],
    [{ floor_thermal_low_power: "SERIOUS" }],
    [{ floor_thermal_end: "boiling" }],
  ])("falls back to the defaults for %j", (config) => {
    expect(floorsFromConfig(config)).toEqual(DEFAULT_FLOORS);
  });

  it("an inconsistent pair (end not below Low Power, heat end below heat Low Power) falls back to defaults", () => {
    expect(floorsFromConfig({ floor_low_power_percent: 20, floor_end_percent: 30 })).toEqual(
      DEFAULT_FLOORS,
    );
    expect(
      floorsFromConfig({ floor_thermal_low_power: "critical", floor_thermal_end: "serious" }),
    ).toEqual(DEFAULT_FLOORS);
  });
});

interface Rig {
  watcher: FloorWatcher;
  battery: { reading: BatteryReading };
  thermal: { reading: ThermalReading };
  ended: EndReason[];
  events: string[];
  lowPower: { on: number; off: number; result: LowPowerResult };
}

function rig(config = DEFAULT_FLOORS): Rig {
  const r: Rig = {
    watcher: undefined as never,
    battery: { reading: bat(80) },
    thermal: { reading: NOMINAL },
    ended: [],
    events: [],
    lowPower: { on: 0, off: 0, result: "on" },
  };
  const ports: FloorPorts = {
    readBattery: () => Promise.resolve(r.battery.reading),
    readThermal: () => Promise.resolve(r.thermal.reading),
    lowPowerOn: () => (r.lowPower.on++, Promise.resolve(r.lowPower.result)),
    lowPowerOff: () => (r.lowPower.off++, Promise.resolve()),
    endSession: (reason) => void r.ended.push(reason),
    emit: (type) => void r.events.push(type),
  };
  r.watcher = new FloorWatcher(config, ports);
  r.watcher.begin();
  return r;
}

describe("FloorWatcher", () => {
  it("turns Low Power Mode on once below 40 %, not again, and off once recovered", async () => {
    const r = rig();
    r.battery.reading = bat(39);
    await r.watcher.tick();
    await r.watcher.tick();
    expect(r.lowPower.on).toBe(1);
    expect(r.watcher.lowPower).toBe(true);
    r.battery.reading = bat(42);
    await r.watcher.tick();
    expect(r.lowPower.off).toBe(0);
    r.battery.reading = bat(46, false);
    await r.watcher.tick();
    expect(r.lowPower.off).toBe(1);
    expect(r.watcher.lowPower).toBe(false);
    expect(r.events).toEqual(["awake.floor.low_power_on", "awake.floor.low_power_off"]);
  });

  it("ends the session below 10 % and below the heat end level, with the reason", async () => {
    const a = rig();
    a.battery.reading = bat(9);
    await a.watcher.tick();
    expect(a.ended).toEqual(["battery"]);
    const b = rig();
    b.thermal.reading = heat("critical");
    await b.watcher.tick();
    expect(b.ended).toEqual(["thermal"]);
    const c = rig();
    c.battery.reading = bat(10);
    await c.watcher.tick();
    expect(c.ended).toEqual([]);
  });

  it("when Low Power Mode is unavailable (no helper) it says so once and never claims it is on", async () => {
    const r = rig();
    r.lowPower.result = "unavailable";
    r.battery.reading = bat(30);
    await r.watcher.tick();
    await r.watcher.tick();
    expect(r.events).toEqual(["awake.floor.low_power_unavailable"]);
    expect(r.watcher.lowPower).toBe(false);
  });

  it("serious heat turns Low Power Mode on even on AC power", async () => {
    const r = rig();
    r.battery.reading = bat(90, false);
    r.thermal.reading = heat("serious");
    await r.watcher.tick();
    expect(r.lowPower.on).toBe(1);
    expect(r.ended).toEqual([]);
  });

  it("does nothing at all when the floors are off", async () => {
    const r = rig({ ...DEFAULT_FLOORS, enabled: false });
    r.battery.reading = bat(3);
    r.thermal.reading = heat("critical");
    await r.watcher.tick();
    expect(r.ended).toEqual([]);
    expect(r.lowPower.on).toBe(0);
  });

  it(`ends a session after ${UNKNOWN_READS_BEFORE_END} unreadable battery reads in a row (fail closed), not before`, async () => {
    const r = rig();
    r.battery.reading = { kind: "unknown" };
    for (let i = 0; i < UNKNOWN_READS_BEFORE_END - 1; i++) await r.watcher.tick();
    expect(r.ended).toEqual([]);
    await r.watcher.tick();
    expect(r.ended).toEqual(["battery"]);
    expect(r.events).toContain("awake.floor.ended");
  });

  it("one good read resets the unknown count", async () => {
    const r = rig();
    r.battery.reading = { kind: "unknown" };
    await r.watcher.tick();
    await r.watcher.tick();
    r.battery.reading = bat(80);
    await r.watcher.tick();
    r.battery.reading = { kind: "unknown" };
    await r.watcher.tick();
    await r.watcher.tick();
    expect(r.ended).toEqual([]);
  });

  it("an unreadable heat sensor ends the session the same way, with reason thermal", async () => {
    const r = rig();
    r.thermal.reading = { kind: "unknown" };
    for (let i = 0; i < UNKNOWN_READS_BEFORE_END; i++) await r.watcher.tick();
    expect(r.ended).toEqual(["thermal"]);
  });

  it("a machine with no battery and no heat source (Linux desktop) is never ended by unknowns", async () => {
    const r = rig();
    r.battery.reading = { kind: "none" };
    r.thermal.reading = { kind: "unsupported" };
    for (let i = 0; i < 10; i++) await r.watcher.tick();
    expect(r.ended).toEqual([]);
  });

  it("a throwing reader does not break later ticks", async () => {
    const r = rig();
    const ports = { readBattery: () => Promise.reject(new Error("boom")) };
    const w = new FloorWatcher(DEFAULT_FLOORS, {
      readBattery: ports.readBattery,
      readThermal: () => Promise.resolve(NOMINAL),
      lowPowerOn: () => Promise.resolve("on"),
      lowPowerOff: () => Promise.resolve(),
      endSession: (reason) => void r.ended.push(reason),
      emit: () => undefined,
    });
    await w.tick();
    expect(r.ended).toEqual([]);
  });

  it("release() turns Low Power Mode off only if this watcher turned it on", async () => {
    const r = rig();
    await r.watcher.release();
    expect(r.lowPower.off).toBe(0);
    r.battery.reading = bat(30);
    await r.watcher.tick();
    await r.watcher.release();
    expect(r.lowPower.off).toBe(1);
  });
});

describe("parseTherm", () => {
  it("reads the three 'nothing recorded' notes as nominal (observed output)", () => {
    const text = [
      "Note: No thermal warning level has been recorded",
      "Note: No performance warning level has been recorded",
      "Note: No CPU power status has been recorded",
      "",
    ].join("\n");
    expect(parseTherm(text)).toEqual({ kind: "level", level: "nominal" });
  });

  it("maps CPU_Speed_Limit to a level", () => {
    const out = (n: number) =>
      `CPU_Scheduler_Limit  = 100\nCPU_Available_CPUs   = 8\nCPU_Speed_Limit      = ${n}\n`;
    expect(parseTherm(out(100))).toEqual(heat("nominal"));
    expect(parseTherm(out(90))).toEqual(heat("fair"));
    expect(parseTherm(out(79))).toEqual(heat("serious"));
    expect(parseTherm(out(50))).toEqual(heat("serious"));
    expect(parseTherm(out(49))).toEqual(heat("critical"));
    expect(parseTherm(out(0))).toEqual(heat("critical"));
    expect([100, 99, 80, 79, 50, 49].map(levelForSpeedLimit)).toEqual([
      "nominal",
      "fair",
      "fair",
      "serious",
      "serious",
      "critical",
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "  \n "],
    ["unfamiliar text", "Thermal pressure: Heavy"],
    ["a limit above 100", "CPU_Speed_Limit = 150"],
    ["a negative limit", "CPU_Speed_Limit = -5"],
    ["a non-numeric limit", "CPU_Speed_Limit = hot"],
    ["two limits", "CPU_Speed_Limit = 100\nCPU_Speed_Limit = 20"],
    [
      "a note plus something unfamiliar",
      "Note: No thermal warning level has been recorded\nGPU is on fire",
    ],
  ])("never guesses: %s is unknown", (_name, text) => {
    expect(parseTherm(text)).toEqual({ kind: "unknown" });
  });

  it("orders levels", () => {
    expect(thermalAtLeast("critical", "serious")).toBe(true);
    expect(thermalAtLeast("fair", "serious")).toBe(false);
    expect(thermalAtLeast("serious", "serious")).toBe(true);
  });
});
