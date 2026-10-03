// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export const PROTOCOL_VERSION = "1.0";

export const SEVERITIES = ["info", "success", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DATA_CLASSIFICATIONS = ["public", "internal", "sensitive", "secret"] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/** Known fields of the v1 envelope. Mirrors `schemas/event-v1.schema.json`. */
export interface EventFields<P extends Record<string, unknown> = Record<string, unknown>> {
  event_id: string;
  event_type: string;
  version: string;
  source: string;
  timestamp: string;
  severity: Severity;
  payload: P;
  correlation_id?: string;
  causation_id?: string;
  subject?: string;
  scope?: string;
  requires_action?: boolean;
  ttl_ms?: number;
  data_classification?: DataClassification;
  metadata?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

/** Phoenix event envelope v1. Unknown future fields are tolerated. */
export type PhoenixEvent<P extends Record<string, unknown> = Record<string, unknown>> =
  EventFields<P> & { [extra: string]: unknown };

export type NewEvent<P extends Record<string, unknown> = Record<string, unknown>> = Omit<
  EventFields<P>,
  "event_id" | "version" | "timestamp" | "payload"
> & {
  event_id?: string;
  timestamp?: string;
  payload?: P;
};

export function newEventId(): string {
  return `evt_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Builds a complete envelope, filling id, version and timestamp. */
export function createEvent<P extends Record<string, unknown>>(
  input: NewEvent<P>,
  now: () => Date = () => new Date(),
): PhoenixEvent<P> {
  return {
    ...input,
    event_id: input.event_id ?? newEventId(),
    version: PROTOCOL_VERSION,
    timestamp: input.timestamp ?? now().toISOString(),
    payload: input.payload ?? ({} as P),
  };
}

/** Event type namespace: everything before the last segment (`build.failed` → `build`). */
export function eventNamespace(eventType: string): string {
  const i = eventType.lastIndexOf(".");
  return i === -1 ? eventType : eventType.slice(0, i);
}

/** True when the event has a ttl_ms and it has elapsed. */
export function isExpired(
  event: Pick<PhoenixEvent, "timestamp" | "ttl_ms">,
  nowMs: number,
): boolean {
  if (event.ttl_ms === undefined) return false;
  return Date.parse(event.timestamp) + event.ttl_ms <= nowMs;
}
