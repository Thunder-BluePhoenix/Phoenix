// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schema from "../schemas/capability-manifest-v1.schema.json" with { type: "json" };
import { ErrorCode, PhoenixError } from "./errors";
import type { Permission, SideEffect } from "./permissions";

const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export const CAPABILITY_MANIFEST_SCHEMA_V1 = schema;

/** Sources Phoenix reserves for itself; capabilities may not use them as ids. */
export const RESERVED_SOURCES: ReadonlySet<string> = new Set([
  "core",
  "pet",
  "system",
  "security",
  "phoenix",
  "fawkes",
  "capability",
  "notification",
]);

export interface CommandSpec {
  name: string;
  description: string;
  side_effect: SideEffect;
  permissions?: Permission[];
  input_schema?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface CapabilityManifest {
  manifest_version?: "1";
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  author?: string;
  homepage?: string;
  compatibility?: { protocol?: "1" };
  events: string[];
  commands: CommandSpec[];
  permissions: Permission[];
  data_categories?: string[];
  healthcheck?: { interval_ms?: number; timeout_ms?: number };
  config_schema?: Record<string, unknown>;
  state_rules?: { match: string; group?: string; effect: Record<string, unknown> }[];
  ui_extensions?: Record<string, unknown>[];
}

/** True when `eventType` is covered by one of the declared patterns. */
export function eventDeclared(patterns: readonly string[], eventType: string): boolean {
  return patterns.some((p) =>
    p.endsWith(".*") ? eventType.startsWith(p.slice(0, -1)) : p === eventType,
  );
}

export type ManifestResult =
  { ok: true; manifest: CapabilityManifest } | { ok: false; error: PhoenixError };

/** Validates schema plus cross-field rules. Never throws. */
export function validateManifest(value: unknown): ManifestResult {
  const fail = (details: string[]) => ({
    ok: false as const,
    error: new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid capability manifest", details),
  });
  if (!validateSchema(value)) {
    return fail(
      (validateSchema.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
      ),
    );
  }
  const m = value as unknown as CapabilityManifest;
  const problems: string[] = [];
  if (RESERVED_SOURCES.has(m.id)) problems.push(`/id "${m.id}" is reserved`);

  const declared = new Set(m.permissions);
  const names = new Set<string>();
  for (const c of m.commands) {
    if (names.has(c.name)) problems.push(`/commands duplicate command "${c.name}"`);
    names.add(c.name);
    for (const p of c.permissions ?? []) {
      if (!declared.has(p)) problems.push(`/commands/${c.name} uses undeclared permission "${p}"`);
    }
    if (c.input_schema) {
      try {
        ajv.compile(c.input_schema);
      } catch (err) {
        problems.push(
          `/commands/${c.name}/input_schema is not a valid JSON Schema: ${(err as Error).message}`,
        );
      }
    }
  }
  if (m.config_schema) {
    try {
      ajv.compile(m.config_schema);
    } catch (err) {
      problems.push(`/config_schema is not a valid JSON Schema: ${(err as Error).message}`);
    }
  }
  for (const r of m.state_rules ?? []) {
    const probe = r.match.endsWith(".*") ? r.match.slice(0, -2) + ".x" : r.match;
    if (!eventDeclared(m.events, probe)) {
      problems.push(`/state_rules "${r.match}" does not match any declared event`);
    }
  }
  return problems.length ? fail(problems) : { ok: true, manifest: m };
}

/** Compiles a JSON Schema for validating command input or capability config. */
export function compileSchema(schemaObject: Record<string, unknown>): (value: unknown) => string[] {
  const validate = ajv.compile(schemaObject);
  return (value) =>
    validate(value)
      ? []
      : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}
