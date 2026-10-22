// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Power-aware gating. The scheduler asks an injected PowerSource for a snapshot and decides, per
// schedule policy, whether a window may hold the machine awake right now. Pure: no OS reads here.
import type { BatteryReading } from "@phoenix/capability-awake";
import type { PowerPolicy } from "./schedule";

/** What the host knows about power. `lowPowerMode: null` means the host cannot tell. */
export interface PowerSnapshot {
  battery: BatteryReading;
  lowPowerMode: boolean | null;
}

/** Read-only. A real adapter reads `pmset -g batt` / sysfs / WMI; tests supply a fake. */
export interface PowerSource {
  read(): Promise<PowerSnapshot>;
}

export type PowerBlock = "needs_charger" | "battery_low" | "low_power_mode" | "power_unknown";

export type PowerVerdict = { allowed: true } | { allowed: false; reason: PowerBlock };

/** After a battery_low pause the level must recover this far above the minimum (no flapping). */
export const RESUME_MARGIN_PERCENT = 5;
/** Unreadable power on a running hold is tolerated this many reads in a row, then it is released. */
export const UNKNOWN_READS_TOLERATED = 2;

/**
 * Whether a window with `policy` may hold the machine now.
 * - Mains power (or no battery at all) always satisfies the charger and level rules.
 * - On battery: `requireCharger` blocks; otherwise the level must be at least `minBatteryPercent`
 *   (plus the resume margin when `wasLow`, i.e. the hold was just released for a low battery).
 * - Low Power Mode blocks unless the policy allows it; an unknown mode never blocks.
 * - A battery that cannot be read blocks (fail closed). The caller decides how long a running
 *   hold survives unreadable power.
 */
export function judgePower(
  policy: PowerPolicy,
  power: PowerSnapshot,
  wasLow: boolean,
): PowerVerdict {
  const { battery } = power;
  if (battery.kind === "unknown") return { allowed: false, reason: "power_unknown" };
  if (power.lowPowerMode === true && !policy.allowLowPowerMode) {
    return { allowed: false, reason: "low_power_mode" };
  }
  if (battery.kind === "none" || !battery.onBattery) return { allowed: true };
  if (policy.requireCharger) return { allowed: false, reason: "needs_charger" };
  const needed = policy.minBatteryPercent + (wasLow ? RESUME_MARGIN_PERCENT : 0);
  if (battery.percent < needed) return { allowed: false, reason: "battery_low" };
  return { allowed: true };
}
