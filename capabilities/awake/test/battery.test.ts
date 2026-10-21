// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  createBatteryReader,
  floorFromConfig,
  parsePmset,
  parseWin32Battery,
  readLinuxBattery,
  type PowerFs,
} from "../src";
import { FakeSystem } from "../testing/fakes";

const PMSET_BATTERY = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=4653155)	42%; discharging; 3:10 remaining present: true
`;
const PMSET_AC = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)	97%; charging; 0:30 remaining present: true
`;
const PMSET_DESKTOP = `Now drawing from 'AC Power'
`;

describe("parsePmset", () => {
  it("reads level and source", () => {
    expect(parsePmset(PMSET_BATTERY)).toEqual({ kind: "battery", percent: 42, onBattery: true });
    expect(parsePmset(PMSET_AC)).toEqual({ kind: "battery", percent: 97, onBattery: false });
  });
  it("a desktop with no InternalBattery line has no battery", () => {
    expect(parsePmset(PMSET_DESKTOP)).toEqual({ kind: "none" });
  });
  it("garbage and out-of-range values are unknown, never a guess", () => {
    expect(parsePmset("")).toEqual({ kind: "unknown" });
    expect(parsePmset("command not found")).toEqual({ kind: "unknown" });
    expect(
      parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0\t340%; discharging"),
    ).toEqual({ kind: "unknown" });
    expect(
      parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0\t(no estimate)"),
    ).toEqual({ kind: "unknown" });
  });
});

describe("parseWin32Battery", () => {
  it("reads one or several batteries and keeps the lowest", () => {
    expect(parseWin32Battery('{"EstimatedChargeRemaining":55,"BatteryStatus":1}')).toEqual({
      kind: "battery",
      percent: 55,
      onBattery: true,
    });
    expect(
      parseWin32Battery(
        '[{"EstimatedChargeRemaining":55,"BatteryStatus":2},{"EstimatedChargeRemaining":30,"BatteryStatus":2}]',
      ),
    ).toEqual({ kind: "battery", percent: 30, onBattery: false });
  });
  it("empty output is no battery; broken output is unknown", () => {
    expect(parseWin32Battery("")).toEqual({ kind: "none" });
    expect(parseWin32Battery("[]")).toEqual({ kind: "none" });
    expect(parseWin32Battery("{not json")).toEqual({ kind: "unknown" });
    expect(parseWin32Battery('{"EstimatedChargeRemaining":null}')).toEqual({ kind: "unknown" });
    expect(parseWin32Battery('{"EstimatedChargeRemaining":"55"}')).toEqual({ kind: "unknown" });
  });
});

function fsOf(files: Record<string, string>, dirs: Record<string, string[]>): PowerFs {
  return {
    list: (dir) => Promise.resolve(dirs[dir]),
    read: (path) => {
      const text = files[path];
      return text === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(text);
    },
  };
}

describe("readLinuxBattery", () => {
  const dir = "/sys/class/power_supply";
  it("reads BAT0 and ignores AC adapters", async () => {
    const fs = fsOf(
      { [`${dir}/BAT0/capacity`]: "23\n", [`${dir}/BAT0/status`]: "Discharging\n" },
      { [dir]: ["AC", "BAT0"] },
    );
    expect(await readLinuxBattery(fs)).toEqual({ kind: "battery", percent: 23, onBattery: true });
  });
  it("no directory or no BAT entry is no battery", async () => {
    expect(await readLinuxBattery(fsOf({}, {}))).toEqual({ kind: "none" });
    expect(await readLinuxBattery(fsOf({}, { [dir]: ["AC"] }))).toEqual({ kind: "none" });
  });
  it("an unreadable or nonsense capacity is unknown", async () => {
    expect(await readLinuxBattery(fsOf({}, { [dir]: ["BAT0"] }))).toEqual({ kind: "unknown" });
    const fs = fsOf(
      { [`${dir}/BAT0/capacity`]: "lots", [`${dir}/BAT0/status`]: "Full" },
      { [dir]: ["BAT0"] },
    );
    expect(await readLinuxBattery(fs)).toEqual({ kind: "unknown" });
  });
});

describe("createBatteryReader", () => {
  it("macOS runs pmset -g batt through the runner (read-only argv)", async () => {
    const sys = new FakeSystem();
    sys.script = () => ({ code: 0, stdout: PMSET_BATTERY, stderr: "" });
    expect(await createBatteryReader(sys.env)()).toMatchObject({ kind: "battery", percent: 42 });
    expect(sys.runs).toHaveLength(1);
    expect(sys.runs[0]?.file).toBe("pmset");
    expect(sys.runs[0]?.args).toEqual(["-g", "batt"]);
  });
  it("a failing or throwing command is unknown", async () => {
    const sys = new FakeSystem();
    sys.script = () => ({ code: 1, stdout: PMSET_BATTERY, stderr: "" });
    expect(await createBatteryReader(sys.env)()).toEqual({ kind: "unknown" });
    const throwing = { platform: "darwin" as const, run: () => Promise.reject(new Error("boom")) };
    expect(await createBatteryReader(throwing)()).toEqual({ kind: "unknown" });
  });
});

describe("floorFromConfig", () => {
  it("defaults to 10 and rejects non-integers and out-of-range", () => {
    expect(floorFromConfig(undefined)).toBe(10);
    expect(floorFromConfig("20")).toBe(10);
    expect(floorFromConfig(0)).toBe(10);
    expect(floorFromConfig(91)).toBe(10);
    expect(floorFromConfig(12.5)).toBe(10);
    expect(floorFromConfig(25)).toBe(25);
  });
});
