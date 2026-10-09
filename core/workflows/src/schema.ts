// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// JSON Schemas for workflow definitions. Every object is closed (`additionalProperties: false`),
// every string and list is capped, so an unknown field or an oversized value is a load error.
import { compileSchema } from "@phoenix/protocol";
import { ENVIRONMENTS } from "@phoenix/policy";
import { LIMITS, STEP_TYPES, type StepType } from "./types";

export const ID_PATTERN = `^[a-z][a-z0-9_]{0,${LIMITS.maxIdLength - 1}}$`;
export const WORKFLOW_ID_PATTERN = `^[a-z0-9][a-z0-9_-]{0,${LIMITS.maxIdLength - 1}}$`;
export const TOOL_NAME_PATTERN =
  "^[a-z][a-z0-9_-]{0,63}\\.[a-z0-9_]{1,64}(\\.[a-z0-9_]{1,64}){0,3}$";
export const FIELD_NAME_PATTERN = "^[a-z][a-z0-9_]{0,31}$";

const text = (max: number, min = 1) => ({ type: "string", minLength: min, maxLength: max });
const template = text(LIMITS.maxTemplateLength);
const expression = text(LIMITS.maxExpressionLength);
const target = { type: "string", pattern: `^(end|${ID_PATTERN.slice(1, -1)})$` };

const retry = {
  type: "object",
  additionalProperties: false,
  required: ["max", "backoff_ms"],
  properties: {
    max: { type: "integer", minimum: 1, maximum: LIMITS.maxRetries },
    backoff_ms: { type: "integer", minimum: 0, maximum: LIMITS.maxBackoffMs },
  },
};

const common = {
  id: { type: "string", pattern: ID_PATTERN },
  type: { enum: [...STEP_TYPES] },
  next: target,
  timeout_ms: { type: "integer", minimum: 100, maximum: LIMITS.maxStepTimeoutMs },
  retry,
};

/** Free-form JSON for action inputs. Depth, size and key names are checked in code (`checkInput`). */
const jsonObject = { type: "object", maxProperties: 40 };

const aiField = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "string" },
        max_length: { type: "integer", minimum: 1, maximum: 2000 },
        enum: { type: "array", minItems: 1, maxItems: 20, items: text(60) },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "number" },
        min: { type: "number" },
        max: { type: "number" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: { type: { const: "boolean" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "string_list" },
        max_items: { type: "integer", minimum: 1, maximum: 20 },
        max_length: { type: "integer", minimum: 1, maximum: 500 },
      },
    },
  ],
};

const tool = { type: "string", pattern: TOOL_NAME_PATTERN };

function stepSchema(
  required: string[],
  props: Record<string, unknown>,
  allow: readonly ("timeout_ms" | "retry" | "next")[] = ["next", "timeout_ms"],
): Record<string, unknown> {
  const properties: Record<string, unknown> = { id: common.id, type: common.type, ...props };
  for (const key of allow) properties[key] = common[key];
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "type", ...required],
    properties,
  };
}

const STEP_SCHEMAS: Record<StepType, Record<string, unknown>> = {
  condition: stepSchema(["if"], { if: expression, then: target, else: target }, []),
  lookup: stepSchema(
    ["query", "limit"],
    {
      query: text(500),
      limit: { type: "integer", minimum: 1, maximum: LIMITS.maxLookupLimit },
    },
    ["next", "timeout_ms", "retry"],
  ),
  ai: stepSchema(
    ["instruction", "output"],
    {
      instruction: text(1500),
      data: {
        type: "object",
        maxProperties: LIMITS.maxAiDataEntries,
        propertyNames: { pattern: FIELD_NAME_PATTERN },
        additionalProperties: template,
      },
      output: {
        type: "object",
        minProperties: 1,
        maxProperties: LIMITS.maxAiFields,
        propertyNames: { pattern: FIELD_NAME_PATTERN },
        additionalProperties: aiField,
      },
      privacy: { enum: ["public", "internal", "sensitive"] },
      max_tokens: { type: "integer", minimum: 16, maximum: 4096 },
    },
    ["next", "timeout_ms", "retry"],
  ),
  action: stepSchema(
    ["tool"],
    {
      tool,
      input: jsonObject,
      compensate: {
        type: "object",
        additionalProperties: false,
        required: ["tool"],
        properties: { tool, input: jsonObject },
      },
    },
    ["next", "timeout_ms", "retry"],
  ),
  approval: stepSchema(["summary"], { summary: text(500) }),
  notify: stepSchema(["title", "message"], {
    title: text(200),
    message: text(1000),
    severity: { enum: ["info", "success", "warning", "error"] },
    requires_action: { type: "boolean" },
  }),
  result: stepSchema(
    ["outcome", "summary"],
    {
      outcome: { enum: ["success", "failure"] },
      summary: text(500),
    },
    [],
  ),
};

const checkTop = compileSchema({
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "version", "enabled", "environment", "trigger", "declares", "steps"],
  properties: {
    id: { type: "string", pattern: WORKFLOW_ID_PATTERN },
    name: text(LIMITS.maxNameLength),
    version: { type: "integer", minimum: 1, maximum: 1_000_000 },
    enabled: { type: "boolean" },
    environment: { enum: [...ENVIRONMENTS] },
    trigger: {
      type: "object",
      additionalProperties: false,
      required: ["event"],
      properties: { event: text(200), where: expression },
    },
    declares: {
      type: "object",
      additionalProperties: false,
      required: ["tools", "ai"],
      properties: {
        tools: { type: "array", maxItems: LIMITS.maxTools, items: tool },
        ai: { type: "boolean" },
        context: { type: "boolean" },
      },
    },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: LIMITS.maxSteps,
      items: { type: "object", required: ["id", "type"] },
    },
  },
});

const stepChecks: Record<StepType, (value: unknown) => string[]> = {
  condition: compileSchema(STEP_SCHEMAS.condition),
  lookup: compileSchema(STEP_SCHEMAS.lookup),
  ai: compileSchema(STEP_SCHEMAS.ai),
  action: compileSchema(STEP_SCHEMAS.action),
  approval: compileSchema(STEP_SCHEMAS.approval),
  notify: compileSchema(STEP_SCHEMAS.notify),
  result: compileSchema(STEP_SCHEMAS.result),
};

/** Shape problems of the whole definition, step by step. Empty when the shape is valid. */
export function checkShape(value: unknown): string[] {
  const problems = checkTop(value);
  if (problems.length > 0) return problems;
  const steps: unknown =
    typeof value === "object" && value !== null && "steps" in value ? value.steps : undefined;
  if (!Array.isArray(steps)) return ["/steps must be a list"];
  steps.forEach((step: unknown, i) => {
    const type: unknown =
      typeof step === "object" && step !== null && "type" in step ? step.type : undefined;
    if (typeof type !== "string" || !isStepType(type)) {
      problems.push(`/steps/${i}/type must be one of ${STEP_TYPES.join(", ")}`);
      return;
    }
    for (const p of stepChecks[type](step)) problems.push(`/steps/${i}${p}`);
  });
  return problems;
}

function isStepType(type: string): type is StepType {
  return (STEP_TYPES as readonly string[]).includes(type);
}
