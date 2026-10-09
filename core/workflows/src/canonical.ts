// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import type { WorkflowDefinition } from "./types";

/** JSON with object keys sorted, so equal data always serialises to equal text. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 40) throw new Error("value is nested too deeply");
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v, depth + 1)).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, depth + 1)}`);
  return `{${body.join(",")}}`;
}

/**
 * Hash that an authorisation is bound to. It covers everything that decides what a run does and
 * nothing else: `enabled` (switching a workflow on or off is not a change of behaviour) and
 * `version` (a counter; the content decides) are left out.
 */
export function definitionHash(definition: WorkflowDefinition): string {
  const { enabled: _enabled, version: _version, ...behaviour } = definition;
  return createHash("sha256")
    .update("phoenix-workflow-v1\n")
    .update(canonicalJson(behaviour))
    .digest("hex");
}
