// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Battery and heat floors (Phase 73), on by default:
//   battery below 40 % (on battery power)  -> Low Power Mode on   (journalled, through the helper)
//   battery below 10 % (on battery power)  -> the session ends
//   heat "serious"                         -> Low Power Mode on
//   heat "critical"                        -> the session ends
// Boundaries are strict: 40 % and 10 % themselves are fine. On AC power the battery rules do not
// apply (a session that ends because of a full charger would help nobody).
// An unreadable battery or heat sensor is "unknown", never "fine": after UNKNOWN_READS_BEFORE_END
// unknown reads in a row the (always bounded) session ends. A machine without a battery, and a
// platform without a heat source (anything but macOS), are not unknown: those rules do not apply.
import type { BatteryReading } from "../system";
import { isThermalLevel, thermalAtLeast, type ThermalLevel, type ThermalReading } from "./thermal";

export const DEFAULT_LOW_POWER_PERCENT = 40;
export const DEFAULT_END_PERCENT = 10;
export const MIN_FLOOR_PERCENT = 1;
export const MAX_FLOOR_PERCENT = 90;
/** Low Power Mode is released only once the battery is this far above its floor (no flapping). */
export const LOW_POWER_RELEASE_MARGIN = 5;
export const UNKNOWN_READS_BEFORE_END = 3;
export const DEFAULT_THERMAL_LOW_POWER: ThermalLevel = "serious";
export const DEFAULT_THERMAL_END: ThermalLevel = "critical";

export interface FloorsConfig {
  enabled: boolean;
  lowPowerPercent: number;
  endPercent: number;
  thermalLowPower: ThermalLevel;
  thermalEnd: ThermalLevel;
}

export const DEFAULT_FLOORS: FloorsConfig = {
  enabled: true,
  lowPowerPercent: DEFAULT_LOW_POWER_PERCENT,
  endPercent: DEFAULT_END_PERCENT,
  thermalLowPower: DEFAULT_THERMAL_LOW_POWER,
  thermalEnd: DEFAULT_THERMAL_END,
};

/** JSON Schema `properties` this module adds to the capability's config. */
export const FLOORS_CONFIG_SCHEMA: Record<string, unknown> = {
  floors_enabled: {
    type: "boolean",
    default: true,
    description:
      "Battery and heat floors (on by default). Turn off only if you accept the risk of a hot or flat machine.",
  },
  floor_low_power_percent: {
    type: "integer",
    minimum: MIN_FLOOR_PERCENT + 1,
    maximum: MAX_FLOOR_PERCENT,
    default: DEFAULT_LOW_POWER_PERCENT,
    description:
      "Low Power Mode turns on when the battery falls below this percentage (on battery power).",
  },
  floor_end_percent: {
    type: "integer",
    minimum: MIN_FLOOR_PERCENT,
    maximum: MAX_FLOOR_PERCENT - 1,
    default: DEFAULT_END_PERCENT,
    description:
      "The session ends when the battery falls below this percentage (on battery power). Must be lower than the Low Power Mode percentage.",
  },
  floor_thermal_low_power: {
    type: "string",
    enum: ["fair", "serious", "critical"],
    default: DEFAULT_THERMAL_LOW_POWER,
    description: "Low Power Mode turns on at this heat level.",
  },
  floor_thermal_end: {
    type: "string",
    enum: ["serious", "critical"],
    default: DEFAULT_THERMAL_END,
    description: "The session ends at this heat level.",
  },
};

function percent(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function level(value: unknown, fallback: ThermalLevel): ThermalLevel {
  return isThermalLevel(value) && value !== "nominal" ? value : fallback;
}

/**
 * The floors from capability config. Each value is checked; a bad one falls back to its default,
 * and an inconsistent pair (end not below Low Power Mode, or a heat end below the Low Power level)
 * falls back to both defaults. Floors can only be switched off with an explicit `false`.
 */
export function floorsFromConfig(config: Readonly<Record<string, unknown>>): FloorsConfig {
  const lowPowerPercent = percent(
    config.floor_low_power_percent,
    DEFAULT_LOW_POWER_PERCENT,
    2,
    MAX_FLOOR_PERCENT,
  );
  const endPercent = percent(
    config.floor_end_percent,
    DEFAULT_END_PERCENT,
    MIN_FLOOR_PERCENT,
    MAX_FLOOR_PERCENT - 1,
  );
  const thermalLowPower = level(config.floor_thermal_low_power, DEFAULT_THERMAL_LOW_POWER);
  const thermalEnd = level(config.floor_thermal_end, DEFAULT_THERMAL_END);
  const consistent = endPercent < lowPowerPercent && thermalAtLeast(thermalEnd, thermalLowPower);
  return {
    enabled: config.floors_enabled !== false,
    lowPowerPercent: consistent ? lowPowerPercent : DEFAULT_LOW_POWER_PERCENT,
    endPercent: consistent ? endPercent : DEFAULT_END_PERCENT,
    thermalLowPower: consistent ? thermalLowPower : DEFAULT_THERMAL_LOW_POWER,
    thermalEnd: consistent ? thermalEnd : DEFAULT_THERMAL_END,
  };
}

export type EndReason = "battery" | "thermal";

export interface FloorVerdict {
  /** A floor says Low Power Mode should be on. */
  lowPower: boolean;
  /** Every floor is comfortably clear: Low Power Mode may be released. */
  clear: boolean;
  /** A floor says the session must end now. */
  end: EndReason | null;
  /** The reading could not be read (counts toward UNKNOWN_READS_BEFORE_END). */
  batteryUnknown: boolean;
  thermalUnknown: boolean;
}

/** One pair of readings against the floors. Pure. */
export function judgeFloors(
  cfg: FloorsConfig,
  battery: BatteryReading,
  heat: ThermalReading,
): FloorVerdict {
  let lowPower = false;
  let clear = true;
  let end: EndReason | null = null;
  if (battery.kind === "battery" && battery.onBattery) {
    if (battery.percent < cfg.endPercent) end = "battery";
    if (battery.percent < cfg.lowPowerPercent) lowPower = true;
    if (battery.percent < cfg.lowPowerPercent + LOW_POWER_RELEASE_MARGIN) clear = false;
  }
  if (heat.kind === "level") {
    if (thermalAtLeast(heat.level, cfg.thermalEnd)) end = end ?? "thermal";
    if (thermalAtLeast(heat.level, cfg.thermalLowPower)) lowPower = true;
    // Released only once heat has dropped below the Low Power level (not merely below the end level).
    if (thermalAtLeast(heat.level, cfg.thermalLowPower)) clear = false;
  }
  return {
    lowPower,
    clear,
    end,
    batteryUnknown: battery.kind === "unknown",
    thermalUnknown: heat.kind === "unknown",
  };
}

export interface FloorReadings {
  battery: BatteryReading;
  thermal: ThermalReading;
}

/** What a floor's action did. `unavailable`: no way to do it (no helper, not macOS). */
export type LowPowerResult = "on" | "already" | "unavailable";

export interface FloorPorts {
  readBattery(): Promise<BatteryReading>;
  readThermal(): Promise<ThermalReading>;
  /** Turns Low Power Mode on (journalled). Never throws. */
  lowPowerOn(): Promise<LowPowerResult>;
  /** Turns Low Power Mode back off if this watcher turned it on. Never throws. */
  lowPowerOff(): Promise<void>;
  endSession(reason: EndReason): void;
  emit(type: string, severity: "info" | "warning", payload: Record<string, unknown>): void;
}

/** Why a session was ended by a floor; appears in `awake.floor.ended`. */
export type EndWhy = "below_floor" | "too_hot" | "unreadable";

/**
 * Applies the floors to a running session, one `tick()` at a time (the caller owns the timer).
 * A tick never throws and never overlaps another.
 */
export class FloorWatcher {
  private lowPowerActive = false;
  private unavailableAnnounced = false;
  private batteryUnknown = 0;
  private thermalUnknown = 0;
  private busy = false;
  private lastReadings: FloorReadings | null = null;

  constructor(
    private readonly cfg: FloorsConfig,
    private readonly ports: FloorPorts,
  ) {}

  get lowPower(): boolean {
    return this.lowPowerActive;
  }

  get last(): FloorReadings | null {
    return this.lastReadings;
  }

  /** A new session: counters and the unavailable notice start over. */
  begin(): void {
    this.batteryUnknown = 0;
    this.thermalUnknown = 0;
    this.unavailableAnnounced = false;
    this.lastReadings = null;
  }

  async tick(): Promise<void> {
    if (!this.cfg.enabled || this.busy) return;
    this.busy = true;
    try {
      const [battery, thermal] = await Promise.all([
        this.ports.readBattery(),
        this.ports.readThermal(),
      ]);
      this.lastReadings = { battery, thermal };
      const verdict = judgeFloors(this.cfg, battery, thermal);
      this.batteryUnknown = verdict.batteryUnknown ? this.batteryUnknown + 1 : 0;
      this.thermalUnknown = verdict.thermalUnknown ? this.thermalUnknown + 1 : 0;
      if (verdict.end)
        return this.finish(verdict.end, verdict.end === "battery" ? "below_floor" : "too_hot");
      if (this.batteryUnknown >= UNKNOWN_READS_BEFORE_END)
        return this.finish("battery", "unreadable");
      if (this.thermalUnknown >= UNKNOWN_READS_BEFORE_END)
        return this.finish("thermal", "unreadable");
      if (verdict.lowPower && !this.lowPowerActive) await this.turnOn(battery, thermal);
      else if (verdict.clear && this.lowPowerActive) await this.turnOff();
    } catch {
      // A port misbehaving never stops the next tick.
    } finally {
      this.busy = false;
    }
  }

  private finish(reason: EndReason, why: EndWhy): void {
    this.ports.emit("awake.floor.ended", "warning", { reason, why });
    this.ports.endSession(reason);
  }

  private async turnOn(battery: BatteryReading, thermal: ThermalReading): Promise<void> {
    const result = await this.ports.lowPowerOn();
    if (result === "unavailable") {
      if (!this.unavailableAnnounced) {
        this.unavailableAnnounced = true;
        this.ports.emit("awake.floor.low_power_unavailable", "warning", {
          battery_percent: battery.kind === "battery" ? battery.percent : null,
          thermal: thermal.kind === "level" ? thermal.level : null,
        });
      }
      return;
    }
    this.lowPowerActive = true;
    this.ports.emit("awake.floor.low_power_on", "info", { already: result === "already" });
  }

  private async turnOff(): Promise<void> {
    this.lowPowerActive = false;
    await this.ports.lowPowerOff();
    this.ports.emit("awake.floor.low_power_off", "info", {});
  }

  /** The session ended: release Low Power Mode if this watcher set it. Never throws. */
  async release(): Promise<void> {
    if (!this.lowPowerActive) return;
    await this.turnOff();
  }
}
