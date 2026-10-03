// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { FAWKES_MODES, FAWKES_STATES, type DisplayState } from "@phoenix/protocol/states";

/**
 * Animation names the renderer understands. Character assets provide the
 * actual motion for each; the runtime never knows which integration caused it.
 */
export const ANIMATIONS = [
  "breathe",
  "focus",
  "think",
  "listen",
  "attention",
  "celebrate",
  "caution",
  "alarm",
  "record",
  "fly",
  "sleep",
  "offline",
] as const;
export type AnimationName = (typeof ANIMATIONS)[number];

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "recording" | "muted";

export interface StateVisual {
  animation: AnimationName;
  /** Short human label; always rendered as text (animation is never the only signal). */
  label: string;
  tone: Tone;
  /** Screen readers announce changes into this state immediately. */
  urgent: boolean;
  /** Animation should loop (false = play once, then hold the last frame). */
  loop: boolean;
}

/** Declarative state → visual mapping (PRD v2.0 §6, ADR-0019). */
export const STATE_VISUALS: Readonly<Record<DisplayState, StateVisual>> = {
  IDLE: { animation: "breathe", label: "Idle", tone: "neutral", urgent: false, loop: true },
  WORKING: { animation: "focus", label: "Working", tone: "info", urgent: false, loop: true },
  THINKING: { animation: "think", label: "Thinking", tone: "info", urgent: false, loop: true },
  LISTENING: { animation: "listen", label: "Listening", tone: "info", urgent: false, loop: true },
  WAITING: {
    animation: "attention",
    label: "Needs you",
    tone: "warning",
    urgent: true,
    loop: true,
  },
  SUCCESS: { animation: "celebrate", label: "Done", tone: "success", urgent: false, loop: false },
  WARNING: { animation: "caution", label: "Warning", tone: "warning", urgent: false, loop: true },
  ERROR: { animation: "alarm", label: "Error", tone: "danger", urgent: true, loop: true },
  RECORDING: {
    animation: "record",
    label: "Recording",
    tone: "recording",
    urgent: true,
    loop: true,
  },
  DEPLOYING: { animation: "fly", label: "Deploying", tone: "info", urgent: false, loop: true },
  SLEEPING: { animation: "sleep", label: "Sleeping", tone: "muted", urgent: false, loop: true },
  OFFLINE: { animation: "offline", label: "Offline", tone: "muted", urgent: false, loop: false },
};

export const ALL_DISPLAY_STATES: readonly DisplayState[] = [...FAWKES_STATES, ...FAWKES_MODES];

export function visualFor(state: string): StateVisual {
  return (STATE_VISUALS as Record<string, StateVisual>)[state] ?? STATE_VISUALS.IDLE;
}
