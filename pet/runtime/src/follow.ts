// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Desktop follow-the-cursor / fly-home state machine (Phase 59). Pure: events in, new state plus
 * commands out. The desktop shell (apps/desktop) owns the real window, cursor polling and animation
 * frames; it feeds events here and executes the commands. Nothing in this file touches a window.
 *
 *   docked ──follow-on──▶ following ──alert-raised──▶ flying-home ──arrived──▶ home-alert
 *      ▲                      ▲                                                    │
 *      │                      └────────── arrived ◀── returning ◀── alert-cleared ─┘
 *   follow-off (from anywhere)
 *
 * The alert is a real, urgent display state (error, needs you, recording): Fawkes flies home so
 * the user finds it where they expect it, and only returns to following once it is cleared.
 */

export type FollowPhase = "docked" | "following" | "flying-home" | "home-alert" | "returning";

export interface FollowState {
  phase: FollowPhase;
  /** The user switched following on (setting). Independent of the current phase. */
  followEnabled: boolean;
  /** An alert is active (follows the real display state). */
  alert: boolean;
  /** The user is holding Fawkes; the shell must not move the window. */
  dragging: boolean;
  /** Reduced motion: moves are instant (no flight), per the Phase 10 rule. */
  reducedMotion: boolean;
}

export type FollowEvent =
  | { type: "follow-enabled"; enabled: boolean }
  | { type: "alert-raised" }
  | { type: "alert-cleared" }
  | { type: "arrived" }
  | { type: "cursor-moved" }
  | { type: "drag-started" }
  | { type: "drag-ended" }
  | { type: "reduced-motion"; reduced: boolean };

export type FollowCommand =
  | { kind: "track-cursor"; on: boolean }
  | { kind: "move"; to: "cursor" | "home"; animate: boolean }
  | { kind: "stop-move" };

export interface FollowStep {
  state: FollowState;
  commands: FollowCommand[];
}

export const INITIAL_FOLLOW_STATE: Readonly<FollowState> = {
  phase: "docked",
  followEnabled: false,
  alert: false,
  dragging: false,
  reducedMotion: false,
};

/** Where Fawkes should be heading in a phase. */
const DESTINATION: Readonly<Record<FollowPhase, "cursor" | "home" | null>> = {
  docked: null,
  following: "cursor",
  "flying-home": "home",
  "home-alert": null,
  returning: "cursor",
};

/** Phases that resolve on their own when the shell reports `arrived`. */
const TRAVELLING: Readonly<Record<FollowPhase, boolean>> = {
  docked: false,
  following: false,
  "flying-home": true,
  "home-alert": false,
  returning: true,
};

/** Phases in which the shell polls the cursor. */
const POLLS_CURSOR: Readonly<Record<FollowPhase, boolean>> = {
  docked: false,
  following: true,
  "flying-home": false,
  "home-alert": false,
  returning: false,
};

function enter(prev: FollowState, phase: FollowState["phase"], next: FollowState): FollowStep {
  const commands: FollowCommand[] = [];
  if (POLLS_CURSOR[prev.phase] !== POLLS_CURSOR[phase]) {
    commands.push({ kind: "track-cursor", on: POLLS_CURSOR[phase] });
  }
  const to = DESTINATION[phase];
  if (to && (TRAVELLING[phase] || phase !== prev.phase) && !next.dragging) {
    // Flights animate unless reduced motion asks for an instant move.
    commands.push({ kind: "move", to, animate: !next.reducedMotion && TRAVELLING[phase] });
  }
  if (!to && TRAVELLING[prev.phase]) commands.push({ kind: "stop-move" });
  return { state: { ...next, phase }, commands };
}

/** The phase the machine settles in, from the user's setting and the real alert. */
function settle(state: FollowState): FollowPhase {
  if (!state.followEnabled) return state.alert ? "home-alert" : "docked";
  return state.alert ? "flying-home" : "following";
}

export function followStep(prev: FollowState, event: FollowEvent): FollowStep {
  switch (event.type) {
    case "follow-enabled": {
      const next = { ...prev, followEnabled: event.enabled };
      if (!event.enabled) {
        // Turning following off stops everything; an active alert keeps Fawkes where it is.
        return enter(prev, next.alert ? "home-alert" : "docked", next);
      }
      return enter(prev, settle(next), next);
    }
    case "alert-raised": {
      if (prev.alert) return { state: prev, commands: [] };
      const next = { ...prev, alert: true };
      // Without following there is nothing to fly home from: just hold.
      return enter(prev, prev.followEnabled ? "flying-home" : "home-alert", next);
    }
    case "alert-cleared": {
      if (!prev.alert) return { state: prev, commands: [] };
      const next = { ...prev, alert: false };
      if (!prev.followEnabled) return enter(prev, "docked", next);
      return enter(prev, prev.phase === "flying-home" ? "following" : "returning", next);
    }
    case "arrived": {
      if (prev.phase === "flying-home") return enter(prev, "home-alert", prev);
      if (prev.phase === "returning") return enter(prev, "following", prev);
      return { state: prev, commands: [] };
    }
    case "cursor-moved": {
      // Only meaningful while following and not being held.
      if (prev.phase !== "following" || prev.dragging) return { state: prev, commands: [] };
      return {
        state: prev,
        commands: [{ kind: "move", to: "cursor", animate: !prev.reducedMotion }],
      };
    }
    case "drag-started":
      if (prev.dragging) return { state: prev, commands: [] };
      return { state: { ...prev, dragging: true }, commands: [{ kind: "stop-move" }] };
    case "drag-ended": {
      if (!prev.dragging) return { state: prev, commands: [] };
      const next = { ...prev, dragging: false };
      // A held-and-dropped Fawkes resumes its job: a flight is re-issued.
      return enter(next, next.phase, next);
    }
    case "reduced-motion":
      return { state: { ...prev, reducedMotion: event.reduced }, commands: [] };
  }
}
