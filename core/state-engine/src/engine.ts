// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  DEFAULT_EXPLANATIONS,
  SLEEP_BREAKTHROUGH_STATES,
  STATE_PRIORITY,
  type DisplayState,
  type FawkesState,
  type PhoenixEvent,
} from "@phoenix/protocol";
import { DEFAULT_MAPPING, EVENT_DESCRIPTIONS } from "./default-mapping";
import { conditionKey, renderExplanation, ruleMatches, type MappingRule } from "./rules";

/** One active reason for Fawkes to be in a state. */
export interface Condition {
  key: string;
  state: FawkesState;
  explanation: string;
  source: string;
  eventId: string;
  eventType: string;
  /** When this key entered its current state (ms). */
  since: number;
  /** Last event for this key (ms). */
  updatedAt: number;
  expiresAt?: number;
  timeoutMs?: number;
  progress?: number;
}

export interface StateSnapshot {
  state: DisplayState;
  explanation: string;
  /** When the displayed state last changed (ISO). */
  since: string;
  /** Condition that drives the displayed state, if any. */
  key?: string;
  source?: string;
  /** True whenever any recording is active — independent of the displayed state. */
  recording: boolean;
  sleeping: boolean;
  /** All active conditions, highest priority first. */
  conditions: Condition[];
}

export type StateListener = (snapshot: StateSnapshot, previous: StateSnapshot) => void;

/** A long-running activity, as shown in the Pet Panel's active-task list. */
export interface ActiveTask {
  key: string;
  state: FawkesState;
  title: string;
  source: string;
  since: string;
  updatedAt: string;
  progress?: number;
}

export type TaskListener = (tasks: ActiveTask[]) => void;

export interface StateEngineOptions {
  mapping?: readonly MappingRule[];
  now?: () => number;
  /** How long a timed-out task stays as a WARNING. */
  timeoutWarningTtlMs?: number;
  /** Most activities tracked at once; beyond it the least important are dropped. */
  maxConditions?: number;
}

/** Far more than anyone has running at once; small enough to keep every event cheap. */
export const DEFAULT_MAX_CONDITIONS = 500;

/** "kage.summary.ready" → "Kage summary ready" */
export function humanizeEventType(eventType: string): string {
  const text = eventType.replace(/[._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const LONG_RUNNING: ReadonlySet<FawkesState> = new Set([
  "WORKING",
  "THINKING",
  "DEPLOYING",
  "LISTENING",
]);

/**
 * Computes the single Fawkes state from events (ADR-0019).
 *
 * Deterministic: given the same events and clock, it always produces the same
 * snapshot. Unknown events are ignored and never throw.
 */
export class StateEngine {
  private readonly rules: MappingRule[];
  private readonly now: () => number;
  private readonly timeoutWarningTtlMs: number;
  private readonly maxConditions: number;
  private readonly conditions = new Map<string, Condition>();
  private readonly listeners = new Set<StateListener>();
  private readonly taskListeners = new Set<TaskListener>();
  private taskSignature = "[]";
  private sleeping = false;
  private current: StateSnapshot;

  constructor(options: StateEngineOptions = {}) {
    this.rules = [...(options.mapping ?? DEFAULT_MAPPING)];
    this.now = options.now ?? Date.now;
    this.timeoutWarningTtlMs = options.timeoutWarningTtlMs ?? 60_000;
    this.maxConditions = options.maxConditions ?? DEFAULT_MAX_CONDITIONS;
    this.current = this.compute(this.now());
  }

  /** Adds rules ahead of existing ones (capability-specific overrides). */
  addRules(rules: readonly MappingRule[]): void {
    this.rules.unshift(...rules);
  }

  /** Removes rules previously added with addRules (matched by identity). */
  removeRules(rules: readonly MappingRule[]): void {
    const remove = new Set(rules);
    for (let i = this.rules.length - 1; i >= 0; i--) {
      if (remove.has(this.rules[i]!)) this.rules.splice(i, 1);
    }
  }

  /** Processes an event. Returns true if it affected any condition. */
  handle(event: PhoenixEvent): boolean {
    try {
      return this.apply(event);
    } catch {
      // Malformed or unexpected input must never break the engine.
      return false;
    }
  }

  /**
   * Human-readable sentence for an event, using the same wording Fawkes shows
   * (e.g. "Build failed (terminal)"). Falls back to a readable event type.
   */
  describe(event: PhoenixEvent): string {
    try {
      const rule = this.rules.find((r) => ruleMatches(r, event.event_type));
      if (rule && "state" in rule.effect) {
        const text = renderExplanation(rule.effect.explain ?? "", event);
        if (text) return text;
      }
      const template = EVENT_DESCRIPTIONS[event.event_type];
      if (template) {
        const text = renderExplanation(template, event);
        if (text) return text;
      }
    } catch {
      // fall through
    }
    return humanizeEventType(event.event_type);
  }

  /** Expires transient conditions and converts stalled tasks into timeout warnings. */
  tick(): void {
    this.recompute();
  }

  acknowledge(key: string): boolean {
    const removed = this.conditions.delete(key);
    if (removed) this.recompute();
    return removed;
  }

  /** Drops every condition raised by `source` (its capability was disabled). */
  clearSource(source: string): number {
    let n = 0;
    for (const [key, c] of this.conditions) {
      if (c.source === source) {
        this.conditions.delete(key);
        n++;
      }
    }
    if (n > 0) this.recompute();
    return n;
  }

  /** Clears every ERROR condition (user dismissed errors). */
  acknowledgeErrors(): number {
    let n = 0;
    for (const [key, c] of this.conditions) {
      if (c.state === "ERROR") {
        this.conditions.delete(key);
        n++;
      }
    }
    if (n > 0) this.recompute();
    return n;
  }

  setSleeping(sleeping: boolean): void {
    this.sleeping = sleeping;
    this.recompute();
  }

  snapshot(): StateSnapshot {
    return this.current;
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Long-running activities (working, thinking, deploying, recording…), newest first. */
  tasks(): ActiveTask[] {
    return [...this.conditions.values()]
      .filter((c) => LONG_RUNNING.has(c.state) || c.state === "RECORDING")
      .sort((a, b) => b.since - a.since || a.key.localeCompare(b.key))
      .map((c) => ({
        key: c.key,
        state: c.state,
        title: c.explanation,
        source: c.source,
        since: new Date(c.since).toISOString(),
        updatedAt: new Date(c.updatedAt).toISOString(),
        ...(c.progress !== undefined ? { progress: c.progress } : {}),
      }));
  }

  /** Fires whenever the active-task list changes, including progress updates. */
  onTasksChange(listener: TaskListener): () => void {
    this.taskListeners.add(listener);
    return () => this.taskListeners.delete(listener);
  }

  private apply(event: PhoenixEvent): boolean {
    if (event.event_type.startsWith("pet.")) return false; // never react to our own output
    const rule = this.rules.find((r) => ruleMatches(r, event.event_type));
    const now = this.now();

    if (!rule) {
      if (event.requires_action !== true) return false;
      this.set(
        conditionKey(event),
        "WAITING",
        this.explain(undefined, event, "WAITING"),
        event,
        now,
      );
      this.recompute();
      return true;
    }

    const key = conditionKey(event, rule);
    const effect = rule.effect;
    if ("clear" in effect) {
      this.conditions.delete(key);
    } else if ("heartbeat" in effect) {
      const c = this.conditions.get(key);
      if (!c) return false;
      c.updatedAt = now;
      const progress = event.payload.progress;
      if (typeof progress === "number" && progress >= 0 && progress <= 1) c.progress = progress;
    } else {
      const state =
        event.requires_action === true && effect.state !== "ERROR" ? "WAITING" : effect.state;
      this.set(
        key,
        state,
        this.explain(effect.explain, event, state),
        event,
        now,
        effect.ttlMs,
        effect.timeoutMs,
      );
    }
    this.recompute();
    return true;
  }

  private explain(template: string | undefined, event: PhoenixEvent, state: FawkesState): string {
    const text = template ? renderExplanation(template, event) : "";
    return text || DEFAULT_EXPLANATIONS[state];
  }

  private set(
    key: string,
    state: FawkesState,
    explanation: string,
    event: PhoenixEvent,
    now: number,
    ttlMs?: number,
    timeoutMs?: number,
  ): void {
    const prev = this.conditions.get(key);
    const c: Condition = {
      key,
      state,
      explanation,
      source: event.source,
      eventId: event.event_id,
      eventType: event.event_type,
      since: prev && prev.state === state ? prev.since : now,
      updatedAt: now,
    };
    if (ttlMs !== undefined) c.expiresAt = now + ttlMs;
    if (timeoutMs !== undefined) c.timeoutMs = timeoutMs;
    this.conditions.set(key, c);
    if (this.conditions.size > this.maxConditions) this.evictOne();
  }

  /**
   * Drops the condition that matters least: the lowest priority, then the oldest. An active
   * recording and a pending approval go last, because losing either hides something the user
   * must see. Without a bound, a source that gives every run its own correlation id grows this
   * map (and every state broadcast, and the work done per event) without limit, and ERROR
   * conditions never expire on their own. History and notifications still keep what was dropped.
   */
  private evictOne(): void {
    const rank = (c: Condition) =>
      c.state === "RECORDING" || c.state === "WAITING" ? 0 : STATE_PRIORITY[c.state];
    let victim: Condition | undefined;
    for (const c of this.conditions.values()) {
      if (
        !victim ||
        rank(c) > rank(victim) ||
        (rank(c) === rank(victim) && c.updatedAt < victim.updatedAt)
      ) {
        victim = c;
      }
    }
    if (victim) this.conditions.delete(victim.key);
  }

  private recompute(): void {
    const now = this.now();
    for (const [key, c] of this.conditions) {
      if (c.expiresAt !== undefined && c.expiresAt <= now) {
        this.conditions.delete(key);
      } else if (
        c.timeoutMs !== undefined &&
        LONG_RUNNING.has(c.state) &&
        now - c.updatedAt >= c.timeoutMs
      ) {
        this.conditions.set(key, {
          ...c,
          state: "WARNING",
          explanation: `No progress: ${c.explanation}`,
          since: now,
          updatedAt: now,
          expiresAt: now + this.timeoutWarningTtlMs,
          timeoutMs: undefined,
        });
      }
    }

    this.notifyTasks();

    const next = this.compute(now);
    const prev = this.current;
    if (
      prev.state === next.state &&
      prev.explanation === next.explanation &&
      prev.key === next.key
    ) {
      next.since = prev.since;
    }
    this.current = next;
    if (
      prev.state !== next.state ||
      prev.explanation !== next.explanation ||
      prev.recording !== next.recording ||
      prev.sleeping !== next.sleeping ||
      prev.key !== next.key
    ) {
      for (const l of this.listeners) {
        try {
          l(next, prev);
        } catch {
          // A faulty listener must not break state computation.
        }
      }
    }
  }

  private notifyTasks(): void {
    if (this.taskListeners.size === 0) return;
    const tasks = this.tasks();
    const signature = JSON.stringify(tasks.map(({ updatedAt: _u, ...rest }) => rest));
    if (signature === this.taskSignature) return;
    this.taskSignature = signature;
    for (const l of this.taskListeners) {
      try {
        l(tasks);
      } catch {
        // Listener faults are contained.
      }
    }
  }

  private compute(now: number): StateSnapshot {
    const conditions = [...this.conditions.values()].sort(
      (a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] || b.updatedAt - a.updatedAt,
    );
    const recording = conditions.some((c) => c.state === "RECORDING");
    const base = {
      since: new Date(now).toISOString(),
      recording,
      sleeping: this.sleeping,
      conditions,
    };
    const top = conditions[0];

    if (this.sleeping && !(top && SLEEP_BREAKTHROUGH_STATES.has(top.state))) {
      return { ...base, state: "SLEEPING", explanation: DEFAULT_EXPLANATIONS.SLEEPING };
    }
    if (!top) return { ...base, state: "IDLE", explanation: DEFAULT_EXPLANATIONS.IDLE };
    return {
      ...base,
      state: top.state,
      explanation: top.explanation,
      key: top.key,
      source: top.source,
    };
  }
}
