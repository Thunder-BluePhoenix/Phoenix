// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError, SEVERITIES, type Severity } from "@phoenix/protocol";
import { isSafeText } from "./kinds";

export const WEBHOOK_SOURCE_ID = /^[a-z][a-z0-9_-]{2,31}$/;
export const WEBHOOK_EVENT_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const DATA_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Event namespaces a webhook may use. The list is closed so a webhook can never speak as a Core
 * signal (`dictation.idle` would hide a live microphone), as a built-in service (`stripe.*`), as
 * an agent session, or as a provider identity. Anything not named here is refused at the door.
 */
export const WEBHOOK_NAMESPACES: readonly string[] = [
  "build",
  "test",
  "deploy",
  "ci",
  "alert",
  "monitor",
  "release",
  "task",
  "webhook",
];
export const MAX_ALLOWED_TYPES = 16;
export const MAX_DATA_KEYS = 16;

export type WebhookDataValue = string | number | boolean;

/** The one shape a webhook body can have. Everything else about the event is decided by Core. */
export interface WebhookPayload {
  /** The sender's own id for this delivery; the dedupe key. */
  event_id: string;
  event_type: string;
  severity?: Severity;
  subject?: string;
  message?: string;
  data?: Record<string, WebhookDataValue>;
}

const invalid = (detail: string): PhoenixError =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid webhook payload", [detail]);

export function isAllowedWebhookType(type: unknown): type is string {
  return (
    typeof type === "string" &&
    type.length <= 200 &&
    EVENT_TYPE.test(type) &&
    WEBHOOK_NAMESPACES.includes(type.slice(0, type.indexOf(".")))
  );
}

/** Validates the event types a source is configured with (user input, not webhook input). */
export function parseAllowedTypes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ALLOWED_TYPES)
    throw new PhoenixError(
      ErrorCode.INVALID_REQUEST,
      `eventTypes must list 1 to ${MAX_ALLOWED_TYPES} event types`,
    );
  const types = new Set<string>();
  for (const type of value as unknown[]) {
    if (!isAllowedWebhookType(type))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `Event type not allowed for webhooks: namespace must be one of ${WEBHOOK_NAMESPACES.join(", ")}`,
      );
    types.add(type);
  }
  return [...types].sort();
}

/**
 * Strict parser for an untrusted webhook body. Exact key set, bounded lengths, printable text only,
 * flat scalar `data`. Unknown fields are rejected rather than ignored so a typo or a probing sender
 * is told immediately and nothing unvalidated is ever carried into an event.
 */
export function parseWebhookPayload(raw: unknown): WebhookPayload {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw invalid("body must be a JSON object");
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!["event_id", "event_type", "severity", "subject", "message", "data"].includes(key))
      throw invalid("unknown field");
  }
  const { event_id, event_type, severity, subject, message, data } = body;
  if (typeof event_id !== "string" || !WEBHOOK_EVENT_ID.test(event_id))
    throw invalid("event_id must be 8-128 characters of A-Z a-z 0-9 _ . : -");
  if (typeof event_type !== "string" || !EVENT_TYPE.test(event_type) || event_type.length > 200)
    throw invalid("event_type must be a dot-separated lower-case type");
  const payload: WebhookPayload = { event_id, event_type };
  if (severity !== undefined) {
    if (typeof severity !== "string" || !(SEVERITIES as readonly string[]).includes(severity))
      throw invalid("severity must be info, success, warning or error");
    payload.severity = severity as Severity;
  }
  if (subject !== undefined) {
    if (!isSafeText(subject, 200)) throw invalid("subject must be 1-200 printable characters");
    payload.subject = subject;
  }
  if (message !== undefined) {
    if (!isSafeText(message, 280)) throw invalid("message must be 1-280 printable characters");
    payload.message = message;
  }
  if (data !== undefined) {
    if (data === null || typeof data !== "object" || Array.isArray(data))
      throw invalid("data must be an object");
    const entries = Object.entries(data);
    if (entries.length > MAX_DATA_KEYS) throw invalid(`data allows at most ${MAX_DATA_KEYS} keys`);
    const clean: Record<string, WebhookDataValue> = {};
    for (const [key, value] of entries) {
      if (!DATA_KEY.test(key))
        throw invalid("data keys must be lower_snake_case, up to 40 characters");
      if (typeof value === "string" ? !isSafeText(value, 200, 0) : false)
        throw invalid("data strings must be at most 200 printable characters");
      if (typeof value === "number" ? !Number.isFinite(value) : false)
        throw invalid("data numbers must be finite");
      if (!["string", "number", "boolean"].includes(typeof value))
        throw invalid("data values must be strings, numbers or booleans");
      clean[key] = value as WebhookDataValue;
    }
    payload.data = clean;
  }
  return payload;
}
