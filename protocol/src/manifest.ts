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

/** Capability manifest schema major supported by this release. Omission means v1. */
export const CAPABILITY_MANIFEST_VERSION = "1" as const;

/** Event protocol major supported by capability manifests (event wire version is 1.x). */
export const CAPABILITY_PROTOCOL_MAJOR = "1" as const;

/** Sources Phoenix reserves for itself; capabilities may not use them as ids. */
export const RESERVED_SOURCES: ReadonlySet<string> = new Set([
  "core",
  "pet",
  "system",
  "security",
  "phoenix",
  "fawkes",
  "capability",
  "notetaker",
  "dictation",
  "notification",
]);

/**
 * Event namespace only Core publishes (Phase 77): `agent.safety.loop`, `.stall`, `.checkpoint`.
 * It sits inside `agent.*`, which the first-party `agents` capability legitimately declares, so
 * it cannot be a reserved SOURCE-style first segment. It is reserved as a whole instead: no
 * capability publishes into it (see `isReservedEventType`) and only first-party manifests may
 * declare a pattern that could cover it (see `patternCoversReservedEvents`).
 */
export const RESERVED_EVENT_NAMESPACE = "agent.safety" as const;

/** True when `eventType` is in the namespace Core keeps for itself (`agent.safety` and below). */
export function isReservedEventType(eventType: string): boolean {
  return (
    eventType === RESERVED_EVENT_NAMESPACE || eventType.startsWith(`${RESERVED_EVENT_NAMESPACE}.`)
  );
}

/**
 * True when a declared event pattern (an exact type or a prefix ending in `.*`) could match a
 * reserved event type: `agent.*`, `agent.safety.*` and `agent.safety.checkpoint` all do,
 * `agent.working` and `agent.sa.*` do not. A bare `*` is not a valid pattern (the manifest
 * schema refuses it), so it never reaches this check.
 */
export function patternCoversReservedEvents(pattern: string): boolean {
  if (!pattern.endsWith(".*")) return isReservedEventType(pattern);
  const base = pattern.slice(0, -2);
  return (
    RESERVED_EVENT_NAMESPACE === base ||
    RESERVED_EVENT_NAMESPACE.startsWith(`${base}.`) ||
    base.startsWith(`${RESERVED_EVENT_NAMESPACE}.`)
  );
}

export interface CommandSpec {
  name: string;
  description: string;
  side_effect: SideEffect;
  permissions?: Permission[];
  input_schema?: Record<string, unknown>;
  timeout_ms?: number;
}

/** AI data access is an explicit subset of the manifest's privacy disclosure. */
export interface AIDataAccess {
  category: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
}

export interface AIProviderConstraint {
  /** Local means on-device processing; cloud is permitted for public data only. */
  locality: "local" | "cloud";
  provider: string;
}

export interface AIContextSource {
  name: string;
  description: string;
  data_access: AIDataAccess[];
  permissions: Permission[];
  provider: AIProviderConstraint;
}

export interface AITool extends AIContextSource {
  /** Must name a declared command; invocation uses the normal permission gateway. */
  command: string;
  kind: "tool" | "model_provider" | "embedding_provider";
}

export interface CapabilityManifest {
  manifest_version?: typeof CAPABILITY_MANIFEST_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  author?: string;
  homepage?: string;
  compatibility?: { protocol?: typeof CAPABILITY_PROTOCOL_MAJOR };
  events: string[];
  commands: CommandSpec[];
  permissions: Permission[];
  data_categories?: string[];
  /** Optional v1 additions: existing v1 manifests need no migration. Adding either declaration
   * requires a version bump and fresh user disclosure before enable; never implies a grant.
   * Breaking authorization/schema changes require manifest major 2 and an explicit migration.
   */
  context_sources?: AIContextSource[];
  ai_tools?: AITool[];
  healthcheck?: { interval_ms?: number; timeout_ms?: number };
  config_schema?: Record<string, unknown>;
  /** Credentials the user provides; stored in OS secret storage (ctx.secret(name)). */
  secrets?: { name: string; description: string }[];
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

export interface ValidateManifestOptions {
  /**
   * First-party (built-in, in-process) manifests only: allow event patterns that could cover the
   * reserved `agent.safety` namespace (the `agents` capability declares `agent.*`). Never set for a
   * manifest that came from outside Core; the publish check in the capability manager blocks the
   * reserved subset for built-ins anyway.
   */
  allowReservedEventOverlap?: boolean;
}

/** Validates schema plus cross-field rules. Never throws. */
export function validateManifest(
  value: unknown,
  options: ValidateManifestOptions = {},
): ManifestResult {
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
  // The same names are the namespaces of Phoenix's own events (security.confirmation.requested,
  // pet.state.changed, capability.failed, ...). A capability may not claim them: an event under
  // one would be indistinguishable from Phoenix speaking, and Fawkes and the notification centre
  // would believe it (a forged "Approval needed" prompt put Fawkes in WAITING).
  for (const pattern of m.events) {
    const namespace = pattern.split(".")[0]!;
    if (RESERVED_SOURCES.has(namespace)) {
      problems.push(`/events "${pattern}" is in the reserved "${namespace}" namespace`);
    }
  }
  // `agent.safety.*` (loop, stall, checkpoint warnings of the Phase 77 safety net) is Core's. It
  // lies inside `agent.*`, so a plain "first segment" rule cannot reserve it. Only first-party
  // manifests may declare a pattern that could cover it; an external or marketplace manifest
  // declaring `agent.*`, `agent.safety.*` or `agent.safety.checkpoint` is refused.
  if (!options.allowReservedEventOverlap) {
    for (const pattern of m.events) {
      if (patternCoversReservedEvents(pattern)) {
        problems.push(
          `/events "${pattern}" could match the reserved "${RESERVED_EVENT_NAMESPACE}" event namespace`,
        );
      }
    }
  }

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
  for (const [field, items] of [
    ["context_sources", m.context_sources],
    ["ai_tools", m.ai_tools],
  ] as const) {
    const seen = new Set<string>();
    for (const item of items ?? []) {
      if (seen.has(item.name)) problems.push(`/${field} duplicate name "${item.name}"`);
      seen.add(item.name);
      for (const access of item.data_access) {
        if (!m.data_categories?.includes(access.category)) {
          problems.push(
            `/${field}/${item.name} uses undeclared data category "${access.category}"`,
          );
        }
        if (item.provider.locality === "cloud" && access.sensitivity !== "public") {
          problems.push(`/${field}/${item.name} cannot send sensitive data to cloud`);
        }
      }
      for (const permission of item.permissions) {
        if (!declared.has(permission)) {
          problems.push(`/${field}/${item.name} uses undeclared permission "${permission}"`);
        }
      }
      const required: Permission[] =
        item.provider.locality === "cloud"
          ? ["network", "external_api", "AI_external_processing"]
          : ["network"];
      for (const permission of required) {
        if (!item.permissions.includes(permission)) {
          problems.push(`/${field}/${item.name} requires "${permission}"`);
        }
      }
      if (field === "ai_tools") {
        const tool = item as AITool;
        const command = m.commands.find((c) => c.name === tool.command);
        if (!command) {
          problems.push(`/ai_tools/${tool.name} has no declared command "${tool.command}"`);
        } else
          for (const permission of item.permissions) {
            if (!command.permissions?.includes(permission)) {
              problems.push(
                `/ai_tools/${tool.name} command lacks required permission "${permission}"`,
              );
            }
          }
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
