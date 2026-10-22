// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The scheduler's PowerSource for this machine. Read-only: the battery comes from the Phase 72
// reader (`pmset -g batt`, /sys/class/power_supply, a CIM query) and Low Power Mode from
// `pmset -g` on macOS. Nothing is written. Only the parsing is covered by tests; no real
// `pmset` has been run for this phase, so the macOS `lowpowermode` line is an unverified reading.
import { createBatteryReader, type AwakeEnv, type BatteryReading } from "@phoenix/capability-awake";
import type { PowerSnapshot, PowerSource } from "./power";

const READ_TIMEOUT_MS = 5_000;

/** `true` / `false` for a `lowpowermode 1|0` line in `pmset -g` output, `null` when it is absent. */
export function parseLowPowerMode(text: string): boolean | null {
  const match = /^\s*lowpowermode\s+([01])\s*$/m.exec(text);
  return match ? match[1] === "1" : null;
}

export class SystemPowerSource implements PowerSource {
  private readonly battery: () => Promise<BatteryReading>;

  constructor(private readonly env: Pick<AwakeEnv, "platform" | "run">) {
    this.battery = createBatteryReader(env);
  }

  async read(): Promise<PowerSnapshot> {
    return { battery: await this.battery(), lowPowerMode: await this.lowPowerMode() };
  }

  /** Only macOS exposes the setting; elsewhere, and on any failure, the answer is "cannot tell". */
  private async lowPowerMode(): Promise<boolean | null> {
    if (this.env.platform !== "darwin") return null;
    try {
      const result = await this.env.run("pmset", ["-g"], { timeoutMs: READ_TIMEOUT_MS });
      return result.code === 0 ? parseLowPowerMode(result.stdout) : null;
    } catch {
      return null;
    }
  }
}
