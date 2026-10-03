// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schema from "../schemas/event-v1.schema.json" with { type: "json" };
import { ErrorCode, PhoenixError } from "./errors";
import type { PhoenixEvent } from "./event";
import { findSecrets } from "./secrets";

// ajv-formats is CommonJS; normalise the default export across loaders.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export const EVENT_SCHEMA_V1 = schema;

export type ValidationResult =
  { ok: true; event: PhoenixEvent } | { ok: false; error: PhoenixError };

/**
 * Validates an unknown value against the v1 envelope and the no-secrets rule.
 * Never throws.
 */
export function validateEvent(value: unknown): ValidationResult {
  if (!validateSchema(value)) {
    const details = (validateSchema.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
    );
    return { ok: false, error: new PhoenixError(ErrorCode.INVALID_EVENT, undefined, details) };
  }
  const event = value as PhoenixEvent;
  const secrets = [
    ...findSecrets(event.payload, "$.payload"),
    ...findSecrets(event.metadata ?? {}, "$.metadata"),
    ...findSecrets(event.provenance ?? {}, "$.provenance"),
  ];
  if (secrets.length > 0) {
    return {
      ok: false,
      error: new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Event contains secret-like data",
        secrets,
      ),
    };
  }
  return { ok: true, event };
}

/** Like validateEvent but throws PhoenixError on failure. */
export function assertValidEvent(value: unknown): PhoenixEvent {
  const result = validateEvent(value);
  if (!result.ok) throw result.error;
  return result.event;
}
