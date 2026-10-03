// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { FawkesState, PhoenixEvent } from "@phoenix/protocol";

export type RuleEffect =
  /** Set (or replace) the condition for this event's key. */
  | {
      state: FawkesState;
      /** Template; placeholders: {source} {subject} {event_type} {payload.<field>} */
      explain?: string;
      /** Transient: the condition disappears after this many ms. */
      ttlMs?: number;
      /** Long-running: without an update for this long, it becomes a timeout WARNING. */
      timeoutMs?: number;
    }
  /** Refresh a long-running condition (progress / keep-alive). */
  | { heartbeat: true }
  /** Remove the condition for this key. */
  | { clear: true };

export interface MappingRule {
  /** Exact event type, or prefix pattern ending in ".*". First matching rule wins. */
  match: string;
  /**
   * Groups events that describe the same activity when no correlation_id is set.
   * Defaults to the first segment of the event type (build.started → "build").
   */
  group?: string;
  effect: RuleEffect;
}

export function ruleMatches(rule: MappingRule, eventType: string): boolean {
  return rule.match.endsWith(".*")
    ? eventType.startsWith(rule.match.slice(0, -1))
    : rule.match === eventType;
}

/** Key identifying one activity; later events with the same key replace earlier ones. */
export function conditionKey(event: PhoenixEvent, rule?: MappingRule): string {
  if (event.correlation_id) return `corr:${event.correlation_id}`;
  const group = rule?.group ?? event.event_type.split(".")[0];
  return `${event.source}:${group}:${event.subject ?? ""}`;
}

const MAX_FIELD = 80;

function lookup(event: PhoenixEvent, path: string): string | undefined {
  let cur: unknown = event;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (typeof cur === "string")
    return cur.length > MAX_FIELD ? cur.slice(0, MAX_FIELD - 1) + "…" : cur;
  if (typeof cur === "number" || typeof cur === "boolean") return String(cur);
  return undefined;
}

/**
 * Renders an explanation template. Payload text is untrusted: values are
 * truncated, and missing placeholders are dropped along with empty brackets.
 */
export function renderExplanation(template: string, event: PhoenixEvent): string {
  return template
    .replace(/\{([a-z_]+(?:\.[a-z_]+)*)\}/gi, (_m, path: string) => lookup(event, path) ?? "")
    .replace(/\(\s*\)|:\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
