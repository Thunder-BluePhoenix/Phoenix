// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Everything that enters a run's context (trigger event, tool output, AI output, lookup results)
// or its stored history passes through `boundValue`: plain JSON only, depth/size capped, secrets
// redacted, and keys that could reach a prototype dropped.
import { redact } from "@phoenix/logging";
import { isSecretKey } from "@phoenix/protocol";
import { isForbiddenKey, type Value } from "./expr";

export const BOUNDS = {
  depth: 6,
  string: 2000,
  array: 50,
  keys: 50,
} as const;

function bound(value: unknown, depth: number): Value {
  if (value === null || value === undefined) return null;
  if (typeof value === "string")
    return value.length > BOUNDS.string ? `${value.slice(0, BOUNDS.string)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= BOUNDS.depth) return null;
  if (Array.isArray(value)) return value.slice(0, BOUNDS.array).map((v) => bound(v, depth + 1));
  if (typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const out: { [key: string]: Value } = {};
    let kept = 0;
    for (const [k, v] of Object.entries(value)) {
      // Secret-named keys are dropped (not just masked): the event bus refuses such keys outright.
      if (isForbiddenKey(k) || isSecretKey(k)) continue;
      if (++kept > BOUNDS.keys) break;
      out[k.length > 100 ? k.slice(0, 100) : k] = bound(v, depth + 1);
    }
    return out;
  }
  return null;
}

/** A bounded, redacted, JSON-safe copy of `value`. Never throws. */
export function boundValue(value: unknown): Value {
  try {
    return redact(bound(value, 0)) as Value;
  } catch {
    return null;
  }
}

/** JSON text of a value, cut to `max` characters (for history views). */
export function displayJson(value: unknown, max = 1000): string {
  let text: string;
  try {
    text = JSON.stringify(redact(value)) ?? "null";
  } catch {
    text = "null";
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Like `boundValue`, for payloads: anything that is not an object becomes `{}`. */
export function boundRecord(value: unknown): { [key: string]: Value } {
  const out = boundValue(value);
  return out !== null && typeof out === "object" && !Array.isArray(out) ? out : {};
}
