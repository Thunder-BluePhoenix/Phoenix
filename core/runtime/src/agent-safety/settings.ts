// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { DetectorSettings } from "./detectors";

export const SAFETY_SETTINGS_KEY = "agents.safety.settings";
/**
 * The `subject` of the safety net's warnings, which is the "source" Notifications lists. Adding it
 * to the muted sources (the `notify` setting does this) stops the notifications and nothing else.
 */
export const SAFETY_SOURCE = "agent-safety";

export interface SafetySettings {
  /** Take a checkpoint when an agent's first edit in a session is reported. */
  enabled: boolean;
  retention_days: number;
  max_files: number;
  max_bytes: number;
  loop_threshold: number;
  waiting_min: number;
  idle_min: number;
}

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  enabled: true,
  retention_days: 7,
  max_files: 20_000,
  max_bytes: 512 * 1024 * 1024,
  loop_threshold: 3,
  waiting_min: 10,
  idle_min: 30,
};

interface Range {
  min: number;
  max: number;
}
const RANGES: Record<Exclude<keyof SafetySettings, "enabled">, Range> = {
  retention_days: { min: 1, max: 365 },
  max_files: { min: 100, max: 200_000 },
  max_bytes: { min: 1024 * 1024, max: 4 * 1024 * 1024 * 1024 },
  loop_threshold: { min: 2, max: 20 },
  waiting_min: { min: 1, max: 1_440 },
  idle_min: { min: 1, max: 1_440 },
};
type NumericKey = keyof typeof RANGES;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

/** Stored settings, with any missing or out-of-range value replaced by its default. */
export function readSettings(raw: unknown): SafetySettings {
  const out: SafetySettings = { ...DEFAULT_SAFETY_SETTINGS };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const stored = new Map(Object.entries(raw));
  const enabled = stored.get("enabled");
  if (typeof enabled === "boolean") out.enabled = enabled;
  for (const key of Object.keys(RANGES) as NumericKey[]) {
    const value = stored.get(key);
    const { min, max } = RANGES[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max)
      out[key] = value;
  }
  return out;
}

/**
 * Applies a partial update from the API; every field is checked and unknown fields are refused.
 * `notify` is returned separately: it lives in the notification preferences, not here.
 */
export function applySettings(
  current: SafetySettings,
  body: unknown,
): { settings: SafetySettings; notify: boolean | undefined } {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw invalid("Body must be a JSON object");
  const settings: SafetySettings = { ...current };
  let notify: boolean | undefined;
  for (const [key, value] of Object.entries(body)) {
    if (key === "enabled" || key === "notify") {
      if (typeof value !== "boolean") throw invalid(`"${key}" must be true or false`);
      if (key === "enabled") settings.enabled = value;
      else notify = value;
    } else if (Object.hasOwn(RANGES, key)) {
      const range = RANGES[key as NumericKey];
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < range.min ||
        value > range.max
      )
        throw invalid(`"${key}" must be a whole number from ${range.min} to ${range.max}`);
      settings[key as NumericKey] = value;
    } else {
      throw invalid(`Unknown setting "${key.slice(0, 40)}"`);
    }
  }
  return { settings, notify };
}

export function detectorSettings(s: SafetySettings): DetectorSettings {
  return {
    loopThreshold: s.loop_threshold,
    waitingMs: s.waiting_min * 60_000,
    idleMs: s.idle_min * 60_000,
    forgetMs: Math.max(6 * 3_600_000, s.idle_min * 60_000 * 4),
  };
}
