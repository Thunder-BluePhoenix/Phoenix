// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Strict reading of a tool call's `arguments`. Whatever the client sent is untrusted: unknown
// fields are refused, strings and numbers are bounded, nothing is coerced.

/** A failure the client may be told about; it becomes a `tools/call` result with `isError`. */
export class McpToolError extends Error {
  override name = "McpToolError";
}

export function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new McpToolError(`Unknown argument "${key.slice(0, 40)}"`);
  }
}

/** A string of 1..max characters (0..max when `required` is false); `undefined` when absent. */
export function textArg(
  input: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
): string | undefined {
  const value = input[key];
  if (value === undefined) {
    if (required) throw new McpToolError(`"${key}" is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max)
    throw new McpToolError(`"${key}" must be a non-empty string of at most ${max} characters`);
  return value;
}

export function intArg(
  input: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new McpToolError(`"${key}" must be an integer from ${min} to ${max}`);
  return value;
}
