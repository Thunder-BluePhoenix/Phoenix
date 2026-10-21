// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Battery level for the keep-awake floor rule. Read-only: `pmset -g batt` (macOS), the kernel's
// /sys/class/power_supply (Linux), `Get-CimInstance Win32_Battery` (Windows, UNVERIFIED).
// Parsers are defensive: anything they cannot read with certainty is "unknown", never a guess.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AwakeClock, AwakeEnv, BatteryReading, Platform, TimerHandle } from "./system";

export const DEFAULT_BATTERY_FLOOR_PERCENT = 10;
export const MIN_BATTERY_FLOOR_PERCENT = 1;
export const MAX_BATTERY_FLOOR_PERCENT = 90;
export const DEFAULT_BATTERY_POLL_MS = 60_000;
/** A battery-powered machine whose level cannot be read this many times in a row ends the session. */
export const UNKNOWN_READS_BEFORE_END = 3;

const UNKNOWN: BatteryReading = { kind: "unknown" };
const NONE: BatteryReading = { kind: "none" };

function percentOf(value: number): number | undefined {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined;
}

/** `pmset -g batt` output. A desktop (no InternalBattery line) is "none". */
export function parsePmset(text: string): BatteryReading {
  const header = /Now drawing from '([^']*)'/.exec(text);
  if (!header) return UNKNOWN;
  const lines = text.split("\n").filter((l) => l.includes("InternalBattery"));
  if (lines.length === 0) return NONE;
  let lowest: number | undefined;
  let discharging = false;
  for (const line of lines) {
    const m = /(\d{1,3})%;\s*([^;]*)/.exec(line);
    const percent = m?.[1] === undefined ? undefined : percentOf(Number(m[1]));
    if (percent === undefined) return UNKNOWN;
    lowest = lowest === undefined ? percent : Math.min(lowest, percent);
    if (/^\s*discharging/i.test(m?.[2] ?? "")) discharging = true;
  }
  if (lowest === undefined) return UNKNOWN;
  return {
    kind: "battery",
    percent: lowest,
    onBattery: header[1] === "Battery Power" || discharging,
  };
}

/** The JSON from `Get-CimInstance Win32_Battery | Select ... | ConvertTo-Json -Compress`. */
export function parseWin32Battery(text: string): BatteryReading {
  const trimmed = text.trim();
  if (trimmed === "") return NONE;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return UNKNOWN;
  }
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return NONE;
  let lowest: number | undefined;
  let onBattery = false;
  for (const row of rows) {
    if (row === null || typeof row !== "object") return UNKNOWN;
    const level: unknown = Reflect.get(row, "EstimatedChargeRemaining");
    const status: unknown = Reflect.get(row, "BatteryStatus");
    const percent = typeof level === "number" ? percentOf(level) : undefined;
    if (percent === undefined) return UNKNOWN;
    lowest = lowest === undefined ? percent : Math.min(lowest, percent);
    // Win32_Battery.BatteryStatus: 1 discharging, 4 low, 5 critical; the rest are on AC.
    if (status === 1 || status === 4 || status === 5) onBattery = true;
  }
  if (lowest === undefined) return UNKNOWN;
  return { kind: "battery", percent: lowest, onBattery };
}

/** What the Linux reader needs from the filesystem; tests give it a map. */
export interface PowerFs {
  /** Entries of a directory, or undefined when the directory does not exist. */
  list(dir: string): Promise<string[] | undefined>;
  read(path: string): Promise<string>;
}

export const realPowerFs: PowerFs = {
  async list(dir) {
    try {
      return await readdir(dir);
    } catch (err) {
      if (err instanceof Error && Reflect.get(err, "code") === "ENOENT") return undefined;
      throw err;
    }
  },
  read: (path) => readFile(path, "utf8"),
};

const POWER_SUPPLY_DIR = "/sys/class/power_supply";

/** Reads every BAT* entry; no entries (or no power-supply directory) means no battery. */
export async function readLinuxBattery(fs: PowerFs): Promise<BatteryReading> {
  try {
    const entries = await fs.list(POWER_SUPPLY_DIR);
    if (entries === undefined) return NONE;
    const names = entries.filter((n) => /^BAT[0-9A-Za-z]*$/.test(n));
    if (names.length === 0) return NONE;
    let lowest: number | undefined;
    let onBattery = false;
    for (const name of names) {
      const capacity = Number((await fs.read(join(POWER_SUPPLY_DIR, name, "capacity"))).trim());
      const percent = percentOf(capacity);
      if (percent === undefined) return UNKNOWN;
      lowest = lowest === undefined ? percent : Math.min(lowest, percent);
      const status = (await fs.read(join(POWER_SUPPLY_DIR, name, "status"))).trim();
      if (/^discharging$/i.test(status)) onBattery = true;
    }
    if (lowest === undefined) return UNKNOWN;
    return { kind: "battery", percent: lowest, onBattery };
  } catch {
    return UNKNOWN;
  }
}

const WIN32_QUERY =
  "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress";

const BATTERY_COMMAND_TIMEOUT_MS = 8_000;

/** The platform's battery source, through the injected runner. Never throws. */
export function createBatteryReader(
  env: Pick<AwakeEnv, "platform" | "run">,
  fs: PowerFs = realPowerFs,
): () => Promise<BatteryReading> {
  const { platform, run } = env;
  return async () => {
    const reading: Record<Platform, () => Promise<BatteryReading>> = {
      darwin: async () => {
        const r = await run("pmset", ["-g", "batt"], { timeoutMs: BATTERY_COMMAND_TIMEOUT_MS });
        return r.code === 0 ? parsePmset(r.stdout) : UNKNOWN;
      },
      linux: () => readLinuxBattery(fs),
      win32: async () => {
        const r = await run(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", WIN32_QUERY],
          { timeoutMs: BATTERY_COMMAND_TIMEOUT_MS },
        );
        return r.code === 0 ? parseWin32Battery(r.stdout) : UNKNOWN;
      },
    };
    try {
      return await reading[platform]();
    } catch {
      return UNKNOWN;
    }
  };
}

/** Floor from config; anything out of range falls back to the default. */
export function floorFromConfig(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_BATTERY_FLOOR_PERCENT &&
    value <= MAX_BATTERY_FLOOR_PERCENT
    ? value
    : DEFAULT_BATTERY_FLOOR_PERCENT;
}

/** True when the reading says the floor rule is violated right now. */
export function belowFloor(reading: BatteryReading, floor: number): boolean {
  return reading.kind === "battery" && reading.onBattery && reading.percent < floor;
}

export interface BatteryWatchOptions {
  read: () => Promise<BatteryReading>;
  clock: AwakeClock;
  floor: number;
  pollMs: number;
  /** Called at most once, with why. After it is called the watch is stopped. */
  onTrip: (why: "below_floor" | "unreadable") => void;
  /** Reads already seen as unknown before the watch started (the start-time read). */
  initialUnknown?: number;
}

export interface BatteryWatch {
  stop(): void;
}

/**
 * Polls the battery while a session runs. Trips when a battery-powered machine is below the floor,
 * or when the level could not be read `UNKNOWN_READS_BEFORE_END` times in a row. A machine with no
 * battery ("none") never trips it; a successful read resets the unreadable count.
 */
export function watchBattery(options: BatteryWatchOptions): BatteryWatch {
  const { read, clock, floor, pollMs, onTrip } = options;
  let stopped = false;
  let unknown = options.initialUnknown ?? 0;
  let timer: TimerHandle | undefined;

  const arm = () => {
    timer = clock.setTimer(() => void tick(), pollMs);
  };
  const trip = (why: "below_floor" | "unreadable") => {
    stopped = true;
    onTrip(why);
  };
  const tick = async () => {
    if (stopped) return;
    let reading: BatteryReading;
    try {
      reading = await read();
    } catch {
      reading = UNKNOWN;
    }
    if (stopped) return;
    if (reading.kind === "unknown") {
      unknown += 1;
      if (unknown >= UNKNOWN_READS_BEFORE_END) return trip("unreadable");
    } else {
      unknown = 0;
      if (belowFloor(reading, floor)) return trip("below_floor");
    }
    arm();
  };

  arm();
  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clock.clearTimer(timer);
    },
  };
}
