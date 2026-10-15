// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Interaction emotes (Phase 59). An emote is a short, transient flourish for something that really
 * happened (a launch, a pointer event, a finished agent run). It is NEVER an agent/display state:
 * the names below are disjoint from every display state and animation (tested), the runtime never
 * emits one as a state, and a real state always wins (Tech Spec §10: Fawkes never fakes a state).
 */
export const INTERACTION_EMOTES = ["greet", "hover", "poke", "dizzy", "recover", "jump"] as const;
export type InteractionEmote = (typeof INTERACTION_EMOTES)[number];

/** The real source event each emote is bound to; an emote with no source cannot exist. */
export type EmoteSource =
  | "app.launch"
  | "pointer.hover"
  | "pointer.click"
  | "pointer.click.burst"
  | "emote.dizzy.end"
  | "event.completion";

export interface EmoteVisual {
  source: EmoteSource;
  /** Hard upper bound; the emote ends by itself and never outlasts this. */
  durationMs: number;
  /** A lower priority emote never interrupts a higher one. */
  priority: number;
}

export const EMOTE_VISUALS: Readonly<Record<InteractionEmote, EmoteVisual>> = {
  greet: { source: "app.launch", durationMs: 1800, priority: 2 },
  hover: { source: "pointer.hover", durationMs: 1200, priority: 1 },
  poke: { source: "pointer.click", durationMs: 700, priority: 3 },
  dizzy: { source: "pointer.click.burst", durationMs: 2400, priority: 4 },
  recover: { source: "emote.dizzy.end", durationMs: 800, priority: 4 },
  jump: { source: "event.completion", durationMs: 1100, priority: 3 },
};

export function isInteractionEmote(value: string): value is InteractionEmote {
  return (INTERACTION_EMOTES as readonly string[]).includes(value);
}

/** Event types that mean "an agent really finished". Nothing else triggers the happy jump. */
export const COMPLETION_EVENT_TYPES: Readonly<Record<string, true>> = {
  "agent.completed": true,
  "agent_run.completed": true,
};

export interface CompletionEvent {
  eventId: string;
  eventType: string;
}

/** A completion is only celebrated while it is fresh, so reconnecting never replays old news. */
export const COMPLETION_FRESH_MS = 15_000;

interface ConditionLike {
  key?: unknown;
  eventId?: unknown;
  eventType?: unknown;
  updatedAt?: unknown;
}

/**
 * Reads the real completion event out of a state snapshot. Returns null unless the displayed state
 * is SUCCESS, caused by a completion event type, and recent: the jump is driven by the event the
 * state engine actually processed, not by guessing from the state alone.
 */
export function completionEvent(
  view: { state: string; key?: string; conditions?: unknown[] },
  nowMs: number,
): CompletionEvent | null {
  if (view.state !== "SUCCESS" || !Array.isArray(view.conditions)) return null;
  const conditions = view.conditions as ConditionLike[];
  const top =
    (view.key !== undefined ? conditions.find((c) => c?.key === view.key) : undefined) ??
    conditions[0];
  if (!top || typeof top.eventId !== "string" || typeof top.eventType !== "string") return null;
  if (!COMPLETION_EVENT_TYPES[top.eventType]) return null;
  if (typeof top.updatedAt !== "number" || !Number.isFinite(top.updatedAt)) return null;
  if (nowMs - top.updatedAt > COMPLETION_FRESH_MS) return null;
  return { eventId: top.eventId, eventType: top.eventType };
}
