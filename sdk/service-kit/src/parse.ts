// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Everything a remote service sends is untrusted text. These helpers clip it, check its type and
// drop what does not fit, so a hostile or malformed response can only ever produce less data.

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as an object, or throws (the client reports it as an unexpected response format). */
export function expectObject(value: unknown): Json {
  if (!isObject(value)) throw new TypeError("expected an object");
  return value;
}

export function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("expected an array");
  return value;
}

/** A string clipped to `max` characters with control characters removed; undefined if not a string. */
export function str(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .trim();
  return clean === "" ? undefined : clean.slice(0, max);
}

/** A finite number, or undefined. Numeric strings are not accepted. */
export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A safe integer, or undefined. */
export function int(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** An https URL without credentials, or undefined. Anything else (javascript:, data:, http:) is dropped. */
export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
}

/** Epoch ms from an ISO string or epoch number (seconds or milliseconds), or undefined. */
export function epochMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  const n = num(value);
  if (n === undefined || n < 0) return undefined;
  return n < 1e11 ? n * 1000 : n;
}

/** Parses each entry with `one`; entries it rejects (returns undefined or throws) are skipped. */
export function parseList<T>(value: unknown, one: (item: Json) => T | undefined, max = 100): T[] {
  const out: T[] = [];
  for (const raw of expectArray(value)) {
    if (out.length >= max) break;
    if (!isObject(raw)) continue;
    try {
      const parsed = one(raw);
      if (parsed !== undefined) out.push(parsed);
    } catch {
      // A malformed entry is skipped, never fatal.
    }
  }
  return out;
}
