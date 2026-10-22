// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

export type Platform = "darwin" | "linux" | "win32";
export interface MachineReading {
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  memoryFreeBytes: number | null;
  memoryTotalBytes: number | null;
  cpuPercent: number | null;
  batteryPercent: number | null;
  charging: boolean | null;
  temperatureCelsius: number | null;
}
export interface MachineProbe {
  platform: Platform;
  sample(): Promise<MachineReading>;
}
export type Runner = (file: string, argv: readonly string[]) => Promise<string | null>;
export interface ProbeEffects {
  platform: Platform;
  run: Runner;
  read(path: string): Promise<string | null>;
  disk(path: string): Promise<{ free: number; total: number } | null>;
  memory(): { free: number; total: number };
  cpu(): number | null;
  diskPath: string;
}
const exec = promisify(execFile);
export const realRunner: Runner = async (file, argv) => {
  try {
    const result = await exec(file, [...argv], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch {
    return null;
  }
};
export function realProbeEffects(): ProbeEffects {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    throw new Error("Machine probes are unsupported on this platform");
  }
  return {
    platform,
    run: realRunner,
    read: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    disk: async (path) => {
      try {
        const s = await statfs(path, { bigint: true });
        return { free: Number(s.bavail * s.bsize), total: Number(s.blocks * s.bsize) };
      } catch {
        return null;
      }
    },
    memory: () => ({ free: os.freemem(), total: os.totalmem() }),
    cpu: () =>
      process.platform === "win32"
        ? null
        : Math.min(100, ((os.loadavg()[0] ?? 0) / Math.max(1, os.availableParallelism())) * 100),
    diskPath: os.homedir(),
  };
}
function percent(input: string | null): number | null {
  const value = input === null ? NaN : Number(input.trim());
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
function temperature(input: string | null, scale = 1): number | null {
  const value = input === null ? NaN : Number(input.trim()) / scale;
  return Number.isFinite(value) && value >= -30 && value <= 150 ? value : null;
}
export function createMachineProbe(effects: ProbeEffects = realProbeEffects()): MachineProbe {
  return {
    platform: effects.platform,
    async sample() {
      const [disk, initialMemory] = await Promise.all([
        effects.disk(effects.diskPath),
        Promise.resolve(effects.memory()),
      ]);
      let memoryFree = initialMemory.free;
      let batteryPercent: number | null = null;
      let charging: boolean | null = null;
      let temperatureCelsius: number | null = null;
      let cpuPercent = effects.cpu();
      if (effects.platform === "linux") {
        const [mem, capacity, status, temp] = await Promise.all([
          effects.read("/proc/meminfo"),
          effects.read("/sys/class/power_supply/BAT0/capacity"),
          effects.read("/sys/class/power_supply/BAT0/status"),
          effects.read("/sys/class/thermal/thermal_zone0/temp"),
        ]);
        const available = mem?.match(/^MemAvailable:\s*(\d+) kB/m);
        if (available) memoryFree = Number(available[1]) * 1024;
        batteryPercent = percent(capacity);
        charging = status === null ? null : /^(Charging|Full)\s*$/i.test(status);
        temperatureCelsius = temperature(temp, 1000);
      } else if (effects.platform === "darwin") {
        const [battery, vm] = await Promise.all([
          effects.run("pmset", ["-g", "batt"]),
          effects.run("vm_stat", []),
        ]);
        const match = battery?.match(/(\d{1,3})%;/);
        batteryPercent = match ? percent(match[1] ?? null) : null;
        charging =
          battery === null || !match
            ? null
            : /\b(?:charging|charged)\b/i.test(battery) || /\bAC Power\b/i.test(battery);
        const page = Number(vm?.match(/page size of (\d+) bytes/)?.[1]);
        const free = Number(vm?.match(/^Pages free:\s*(\d+)\./m)?.[1]);
        const inactive = Number(vm?.match(/^Pages inactive:\s*(\d+)\./m)?.[1]);
        const speculative = Number(vm?.match(/^Pages speculative:\s*(\d+)\./m)?.[1]);
        if (
          page > 0 &&
          Number.isFinite(free) &&
          Number.isFinite(inactive) &&
          Number.isFinite(speculative)
        ) {
          memoryFree = (free + inactive + speculative) * page;
        }
        // macOS does not expose a stable unprivileged CPU temperature API.
      } else {
        const result = await effects.run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty LoadPercentage; Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining",
        ]);
        const numbers = result?.trim().split(/\r?\n/);
        cpuPercent = percent(numbers?.[0] ?? null);
        batteryPercent = percent(numbers?.[1] ?? null);
        // Standard Windows thermal-zone readings are often firmware dummy values; report unavailable.
      }
      return {
        diskFreeBytes: disk?.free ?? null,
        diskTotalBytes: disk?.total ?? null,
        memoryFreeBytes: Number.isFinite(memoryFree) && memoryFree >= 0 ? memoryFree : null,
        memoryTotalBytes: initialMemory.total > 0 ? initialMemory.total : null,
        cpuPercent,
        batteryPercent,
        charging,
        temperatureCelsius,
      };
    },
  };
}
