// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Canonical Fawkes states ordered by priority, highest first (ADR-0019).
 * SLEEPING and OFFLINE are modes, not event-driven states.
 */
export const FAWKES_STATES = [
  "ERROR",
  "WAITING",
  "RECORDING",
  "WARNING",
  "DEPLOYING",
  "THINKING",
  "LISTENING",
  "WORKING",
  "SUCCESS",
  "IDLE",
] as const;
export type FawkesState = (typeof FAWKES_STATES)[number];

export const FAWKES_MODES = ["SLEEPING", "OFFLINE"] as const;
export type FawkesMode = (typeof FAWKES_MODES)[number];

export type DisplayState = FawkesState | FawkesMode;

/** Lower number = higher priority. */
export const STATE_PRIORITY: Readonly<Record<FawkesState, number>> = Object.fromEntries(
  FAWKES_STATES.map((s, i) => [s, i + 1]),
) as Record<FawkesState, number>;

/** States that may break through SLEEPING mode. */
export const SLEEP_BREAKTHROUGH_STATES: ReadonlySet<FawkesState> = new Set(["ERROR", "RECORDING"]);

export const DEFAULT_EXPLANATIONS: Readonly<Record<DisplayState, string>> = {
  ERROR: "Something failed",
  WAITING: "Your input is needed",
  RECORDING: "Recording is active",
  WARNING: "Something may need attention",
  DEPLOYING: "A deployment is running",
  THINKING: "Thinking",
  LISTENING: "Listening",
  WORKING: "Working",
  SUCCESS: "Done",
  IDLE: "All quiet",
  SLEEPING: "Paused",
  OFFLINE: "Phoenix Core is unreachable",
};

export function isFawkesState(value: string): value is FawkesState {
  return (FAWKES_STATES as readonly string[]).includes(value);
}
