// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Everything a tracker sends is hostile until it passes through here: wrong types, huge or
// control-character-laden strings, dates that do not parse, URLs with exotic schemes.
import { redact } from "@phoenix/logging";
import { TrackerError } from "./types";

export const MAX_TITLE = 200;
export const MAX_STATUS = 100;
export const MAX_URL = 500;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Free text from a tracker made safe to emit: credentials redacted, control characters and
 * runs of whitespace collapsed, cut to `max` characters. Anything that is not a non-empty
 * string yields undefined.
 */
export function sanitiseText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Cut first so a megabyte-long title is never run through the redaction regexes.
  const redacted = redact(value.slice(0, max * 4));
  const text = (typeof redacted === "string" ? redacted : "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** An http(s) URL no longer than the event schema allows, or undefined. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_URL) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * A tracker timestamp as ISO 8601 UTC with milliseconds, or undefined. Accepts Jira's
 * `+0000` offsets. ISO strings of this one shape compare correctly as plain strings.
 */
export function toIso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 10 || value.length > 40) return undefined;
  const ms = Date.parse(value.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (!Number.isFinite(ms)) return undefined;
  const year = new Date(ms).getUTCFullYear();
  return year >= 2000 && year <= 2100 ? new Date(ms).toISOString() : undefined;
}

/** Later of two ISO timestamps (either may be missing). */
export function maxIso(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a >= b ? a : b;
}

export function parseJson(text: string, tracker: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TrackerError("invalid_response", `${tracker} returned a reply that is not JSON`);
  }
}
