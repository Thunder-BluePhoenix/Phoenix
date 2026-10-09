// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Environment } from "@phoenix/policy";

/** Hard limits. A definition or run that exceeds one is refused, never clipped silently. */
export const LIMITS = {
  maxSteps: 32,
  /** Longest chain of steps from the first step to a terminal one. */
  maxPathLength: 24,
  maxDefinitionBytes: 32 * 1024,
  maxInputDepth: 6,
  maxInputNodes: 400,
  maxTools: 20,
  maxIdLength: 48,
  maxNameLength: 120,
  maxExpressionLength: 500,
  maxTemplateLength: 2000,
  maxPlaceholders: 20,
  maxLookupLimit: 20,
  maxAiFields: 12,
  maxAiDataEntries: 8,
  maxRetries: 5,
  maxBackoffMs: 60_000,
  maxStepTimeoutMs: 10 * 60_000,
  maxChainDepth: 3,
} as const;

export const STEP_TYPES = [
  "condition",
  "lookup",
  "ai",
  "action",
  "approval",
  "notify",
  "result",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** A step id, or `end` to finish the run successfully. */
export type StepTarget = string;
export const END = "end";

export interface RetrySpec {
  /** Extra attempts after the first (1..5). Only allowed for tools that are idempotent. */
  max: number;
  /** Delay before retry n is `backoff_ms * n`. */
  backoff_ms: number;
}

interface StepBase {
  id: string;
  /** Where to go after this step. Defaults to the next step in the list, or `end` after the last. */
  next?: StepTarget;
  /** Bounds this step (default per type). Expiry cancels the in-flight call and fails the step. */
  timeout_ms?: number;
  retry?: RetrySpec;
}

export interface ConditionStep extends StepBase {
  type: "condition";
  /** Expression over `event`, `steps` and `run`. */
  if: string;
  then?: StepTarget;
  else?: StepTarget;
}

export interface LookupStep extends StepBase {
  type: "lookup";
  /** Template. The result is untrusted data. */
  query: string;
  limit: number;
}

/** One field of an AI step's structured output. Nothing outside the declared fields is kept. */
export type AiField =
  | { type: "string"; max_length?: number; enum?: string[] }
  | { type: "number"; min?: number; max?: number }
  | { type: "boolean" }
  | { type: "string_list"; max_items?: number; max_length?: number };

export type PrivacyLabel = "public" | "internal" | "sensitive";

export interface AiStepSpec extends StepBase {
  type: "ai";
  /** Fixed text written by the workflow's author. Never templated, so data cannot change it. */
  instruction: string;
  /** Named, templated data handed to the model as quoted, untrusted records. */
  data: Record<string, string>;
  output: Record<string, AiField>;
  /** Data class of the prompt; defaults to `sensitive` (on-device models only). */
  privacy?: PrivacyLabel;
  max_tokens?: number;
}

export interface ActionStep extends StepBase {
  type: "action";
  /** `<capability>.<command>`; must be listed in `declares.tools`. Static: never templated. */
  tool: string;
  input?: Record<string, unknown>;
  /** A declared undo for this step, called in reverse order when a later step fails. */
  compensate?: { tool: string; input?: Record<string, unknown> };
}

export interface ApprovalStep extends StepBase {
  type: "approval";
  summary: string;
}

export interface NotifyStep extends StepBase {
  type: "notify";
  title: string;
  message: string;
  severity?: "info" | "success" | "warning" | "error";
  requires_action?: boolean;
}

export interface ResultStep extends StepBase {
  type: "result";
  outcome: "success" | "failure";
  summary: string;
}

export type Step =
  ConditionStep | LookupStep | AiStepSpec | ActionStep | ApprovalStep | NotifyStep | ResultStep;

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  environment: Environment;
  trigger: { event: string; where?: string };
  /** Everything the workflow may touch. Anything not listed here cannot be called. */
  declares: { tools: string[]; ai: boolean; context?: boolean };
  steps: Step[];
}

/** What validation needs to know about a tool, taken from the tool registry (never from the workflow). */
export interface ToolFacts {
  name: string;
  sideEffect: "none" | "read" | "write" | "execute" | "external" | "production";
  permissions: readonly string[];
  idempotent: boolean;
  timeoutMs: number;
}

/** Looks a tool up in the live registry; undefined when it is unknown or its capability is disabled. */
export type ToolCatalog = (name: string) => ToolFacts | undefined;

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "compensating"
  | "succeeded"
  | "rejected"
  | "failed"
  | "failed_needs_attention"
  | "cancelled"
  | "interrupted"
  | "refused";

export const TERMINAL_STATUSES: Readonly<Record<RunStatus, boolean>> = {
  queued: false,
  running: false,
  waiting_approval: false,
  compensating: false,
  succeeded: true,
  rejected: true,
  failed: true,
  failed_needs_attention: true,
  cancelled: true,
  interrupted: true,
  refused: true,
};

export type StepStatus =
  "running" | "waiting" | "succeeded" | "failed" | "timed_out" | "rejected" | "expired" | "unknown";

/** Side effects that change state; decided from the tool contract, never from the workflow. */
export const DESTRUCTIVE_SIDE_EFFECTS: Readonly<Record<ToolFacts["sideEffect"], boolean>> = {
  none: false,
  read: false,
  write: true,
  execute: true,
  external: true,
  production: true,
};

export class WorkflowError extends Error {
  override name = "WorkflowError";
  constructor(
    readonly code:
      | "NOT_USER_ACTOR"
      | "INVALID_DEFINITION"
      | "NOT_FOUND"
      | "VERSION_CONFLICT"
      | "LIMIT_REACHED"
      | "AUDIT_FAILED"
      | "INVALID_REQUEST",
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}
