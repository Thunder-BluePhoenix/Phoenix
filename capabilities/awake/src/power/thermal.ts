// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Heat reading for the floors (Phase 73). macOS only, read-only: `pmset -g therm`.
// What that prints (observed on macOS 15/26 with nothing recorded):
//   Note: No thermal warning level has been recorded
//   Note: No performance warning level has been recorded
//   Note: No CPU power status has been recorded
// and, once the system has throttled:
//   CPU_Scheduler_Limit  = 100
//   CPU_Available_CPUs   = 8
//   CPU_Speed_Limit      = 70
// The parser never guesses. "Nothing recorded" is nominal; a speed limit maps to a level by the
// table below; anything else (empty output, unfamiliar text, a limit outside 0..100) is "unknown".
// UNVERIFIED on a hot machine: the speed-limit thresholds are a documented choice, not Apple's.
import type { AwakeEnv } from "../system";

export type ThermalLevel = "nominal" | "fair" | "serious" | "critical";

export type ThermalReading =
  { kind: "level"; level: ThermalLevel } | { kind: "unsupported" } | { kind: "unknown" };

const LEVEL_ORDER: Record<ThermalLevel, number> = { nominal: 0, fair: 1, serious: 2, critical: 3 };

export function isThermalLevel(value: unknown): value is ThermalLevel {
  return typeof value === "string" && Object.hasOwn(LEVEL_ORDER, value);
}

/** True when `level` is at or beyond `limit`. */
export function thermalAtLeast(level: ThermalLevel, limit: ThermalLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[limit];
}

/**
 * CPU_Speed_Limit (percent of full speed) to a level: 100 nominal, 80-99 fair, 50-79 serious,
 * below 50 critical. A throttled CPU is the system's own statement that it is too hot.
 */
export function levelForSpeedLimit(limit: number): ThermalLevel {
  if (limit >= 100) return "nominal";
  if (limit >= 80) return "fair";
  if (limit >= 50) return "serious";
  return "critical";
}

/** `pmset -g therm` output. */
export function parseTherm(output: string): ThermalReading {
  const unknown: ThermalReading = { kind: "unknown" };
  const text = output.trim();
  if (text === "") return unknown;
  const limits = [...text.matchAll(/^\s*CPU_Speed_Limit\s*=\s*(-?\d+)\s*$/gim)];
  if (limits.length > 1) return unknown;
  const found = limits[0]?.[1];
  if (found !== undefined) {
    const limit = Number(found);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) return unknown;
    return { kind: "level", level: levelForSpeedLimit(limit) };
  }
  // Every line must be one of the three "nothing recorded" notes; anything else is not understood.
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const notes =
    /^Note: No (thermal warning|performance warning|CPU power status) (level )?has been recorded$/;
  return lines.every((l) => notes.test(l)) ? { kind: "level", level: "nominal" } : unknown;
}

const THERM_TIMEOUT_MS = 8_000;

/** Reads the heat level through the injected runner. Never throws. */
export async function readThermal(
  env: Pick<AwakeEnv, "platform" | "run">,
): Promise<ThermalReading> {
  if (env.platform !== "darwin") return { kind: "unsupported" };
  try {
    const result = await env.run("/usr/bin/pmset", ["-g", "therm"], {
      timeoutMs: THERM_TIMEOUT_MS,
    });
    return result.code === 0 ? parseTherm(result.stdout) : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
