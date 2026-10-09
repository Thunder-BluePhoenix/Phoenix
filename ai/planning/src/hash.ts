// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import type { EngineeringPlan } from "./types";

/** JSON with object keys sorted at every level, so equal content always serialises equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The version of a plan the user approves: SHA-256 of its whole content (destination, tasks,
 * criteria, design, source snapshot). Any edit changes it, so an approval cannot cover text the
 * user did not see.
 */
export function planHash(plan: EngineeringPlan): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}
