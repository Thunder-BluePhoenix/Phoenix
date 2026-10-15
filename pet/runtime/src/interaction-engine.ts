// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  EMOTE_VISUALS,
  emotesAllowedIn,
  type EmoteSource,
  type InteractionEmote,
} from "@phoenix/pet-states";

/**
 * The interaction rules of Fawkes (Phase 59) as pure logic: no DOM, no timers, no randomness of
 * its own. Time comes from an injected clock, randomness from an injected RNG, and the engine only
 * moves when `step()` is called. The renderer (`mountFawkes`) is a thin shell around it.
 *
 * Honesty rules, all enforced here and tested:
 *  - an emote starts only from a real source (a launch, a pointer event, a completion event id);
 *  - an emote is transient: it ends by itself after its duration and never changes the real state;
 *  - nothing here knows how to produce an agent/display state;
 *  - cosmetic motion (emotes, gaze) is off while the real state is urgent, sleeping or offline.
 */

export interface InteractionConfig {
  /** Clicks must all fall within this window to count as a burst. */
  clickWindowMs: number;
  /** Clicks inside the window that make Fawkes dizzy. */
  clicksForDizzy: number;
  /** After a hover emote, another is ignored for this long. */
  hoverCooldownMs: number;
  /** Cursor distance (px) at which the eyes are fully turned. */
  gazeRadiusPx: number;
  /** Inside this distance (px) of the eye, the gaze stays centred. */
  gazeDeadzonePx: number;
  /** Exponential smoothing time constant of the gaze. */
  gazeSmoothingMs: number;
}

export const DEFAULT_INTERACTION_CONFIG: Readonly<InteractionConfig> = {
  clickWindowMs: 1200,
  clicksForDizzy: 3,
  hoverCooldownMs: 2500,
  gazeRadiusPx: 160,
  gazeDeadzonePx: 4,
  gazeSmoothingMs: 90,
};

export type GreetVariant = "wave" | "hop";
const GREET_VARIANTS: readonly GreetVariant[] = ["wave", "hop"];

export interface ActiveEmote {
  emote: InteractionEmote;
  /** The real event this emote answers. */
  source: EmoteSource;
  variant?: GreetVariant;
  priority: number;
  startedAt: number;
  endsAt: number;
}

export interface Gaze {
  /** -1..1 inside the unit disc: +x looks right, +y looks down. */
  x: number;
  y: number;
}

export type InteractionChange =
  | { kind: "emote-start"; active: ActiveEmote }
  | { kind: "emote-end"; ended: ActiveEmote }
  | { kind: "gaze"; gaze: Gaze };

export interface InteractionEngineOptions {
  /** Milliseconds, monotonic enough for short intervals (Date.now or a test clock). */
  now: () => number;
  /** [0, 1), like Math.random. */
  random: () => number;
  config?: Partial<InteractionConfig>;
}

export interface InteractionEngine {
  /** App launch. Returns whether the greeting played. */
  launch(): boolean;
  /** Pointer entered Fawkes. */
  hover(): boolean;
  /** Pointer press on Fawkes. Returns the emote started (poke or dizzy), if any. */
  click(): InteractionEmote | null;
  /**
   * A real completion event (agent finished). Each event id jumps at most once; unknown or
   * repeated ids are ignored.
   */
  completion(eventId: string): boolean;
  /** The real state being shown; cosmetic motion yields to it. */
  setRealState(state: string): void;
  setReducedMotion(reduced: boolean): void;
  /** Cursor offset from the eye, in CSS px (positive = right/below). */
  setCursorOffset(dx: number, dy: number): void;
  /** The cursor left the window (or is unknown): look straight ahead. */
  clearCursor(): void;
  /** Advances time: ends emotes, starts the recovery after dizzy, smooths the gaze. */
  step(): void;
  /** Ms until `step()` has something to do, or null when idle. */
  nextWakeMs(): number | null;
  active(): ActiveEmote | null;
  gaze(): Gaze;
  subscribe(listener: (change: InteractionChange) => void): () => void;
}

/** Pure: where the eyes should point for a cursor offset, clamped to the unit disc. */
export function gazeTarget(
  dx: number,
  dy: number,
  config: Pick<InteractionConfig, "gazeRadiusPx" | "gazeDeadzonePx"> = DEFAULT_INTERACTION_CONFIG,
): Gaze {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const distance = Math.hypot(dx, dy);
  if (distance <= config.gazeDeadzonePx) return { x: 0, y: 0 };
  const strength = Math.min(1, distance / config.gazeRadiusPx);
  return { x: (dx / distance) * strength, y: (dy / distance) * strength };
}

/** Pure: one exponential smoothing step toward `target` over `dtMs`. */
export function smoothGaze(current: Gaze, target: Gaze, dtMs: number, tauMs: number): Gaze {
  const alpha = tauMs <= 0 || dtMs >= tauMs * 20 ? 1 : 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  const x = current.x + (target.x - current.x) * alpha;
  const y = current.y + (target.y - current.y) * alpha;
  const settled = Math.hypot(target.x - x, target.y - y) < 0.002;
  return settled ? { ...target } : { x, y };
}

const FRAME_MS = 16;

export function createInteractionEngine(options: InteractionEngineOptions): InteractionEngine {
  const config: InteractionConfig = { ...DEFAULT_INTERACTION_CONFIG, ...options.config };
  const listeners = new Set<(change: InteractionChange) => void>();
  const notify = (change: InteractionChange) => {
    for (const listener of listeners) listener(change);
  };

  let realState = "IDLE";
  let reduced = false;
  let current: ActiveEmote | null = null;
  let clicks: number[] = [];
  let lastHoverAt = Number.NEGATIVE_INFINITY;
  let lastCompletionId: string | null = null;
  let target: Gaze = { x: 0, y: 0 };
  let gaze: Gaze = { x: 0, y: 0 };
  let lastStepAt = options.now();

  const calm = () => emotesAllowedIn(realState);

  const setGaze = (next: Gaze) => {
    if (next.x === gaze.x && next.y === gaze.y) return;
    gaze = next;
    notify({ kind: "gaze", gaze });
  };

  const settleTarget = () => {
    if (reduced || !calm()) {
      target = { x: 0, y: 0 };
      setGaze({ x: 0, y: 0 });
    }
  };

  const end = () => {
    if (!current) return null;
    const ended = current;
    current = null;
    notify({ kind: "emote-end", ended });
    return ended;
  };

  const start = (emote: InteractionEmote, at = options.now()): boolean => {
    if (!calm()) return false;
    const visual = EMOTE_VISUALS[emote];
    const now = at;
    if (current && current.endsAt > now && current.priority > visual.priority) return false;
    if (current) end();
    const active: ActiveEmote = {
      emote,
      source: visual.source,
      startedAt: now,
      endsAt: now + visual.durationMs,
      priority: visual.priority,
    };
    if (emote === "greet") {
      active.variant =
        GREET_VARIANTS[Math.floor(options.random() * GREET_VARIANTS.length)] ?? "wave";
    }
    current = active;
    notify({ kind: "emote-start", active });
    return true;
  };

  return {
    launch: () => start("greet"),

    hover() {
      const now = options.now();
      if (now - lastHoverAt < config.hoverCooldownMs) return false;
      const started = start("hover");
      if (started) lastHoverAt = now;
      return started;
    },

    click() {
      if (!calm()) return null;
      const now = options.now();
      clicks = clicks.filter((at) => now - at < config.clickWindowMs);
      clicks.push(now);
      if (clicks.length >= config.clicksForDizzy) {
        clicks = [];
        return start("dizzy") ? "dizzy" : null;
      }
      return start("poke") ? "poke" : null;
    },

    completion(eventId) {
      if (typeof eventId !== "string" || eventId === "" || eventId === lastCompletionId)
        return false;
      lastCompletionId = eventId;
      return start("jump");
    },

    setRealState(state) {
      realState = state;
      if (!calm()) {
        end();
        clicks = [];
      }
      settleTarget();
    },

    setReducedMotion(value) {
      reduced = value;
      settleTarget();
    },

    setCursorOffset(dx, dy) {
      if (reduced || !calm()) return;
      target = gazeTarget(dx, dy, config);
    },

    clearCursor() {
      target = { x: 0, y: 0 };
    },

    step() {
      const now = options.now();
      const dt = now - lastStepAt;
      lastStepAt = now;
      // Chains (dizzy -> recover) run on the emote's own timeline, however late step() is called.
      while (current && now >= current.endsAt) {
        const ended = end();
        if (ended?.emote === "dizzy") start("recover", ended.endsAt);
      }
      if (reduced || !calm()) return;
      setGaze(smoothGaze(gaze, target, dt, config.gazeSmoothingMs));
    },

    nextWakeMs() {
      if (gaze.x !== target.x || gaze.y !== target.y) return FRAME_MS;
      if (current) return Math.max(0, current.endsAt - options.now());
      return null;
    },

    active: () => current,
    gaze: () => gaze,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
