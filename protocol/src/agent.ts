// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Typed agent objects (ADR-0008): Task, Agent, AgentRun, Plan, ToolRequest, ToolResult, Evidence,
// Verification, Diagnosis, and the run state machine. Anything a model produced is validated
// here before the orchestrator looks at it. A Plan has no risk field on purpose: the policy
// engine assigns risk when a tool is called, never the plan.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schema from "../schemas/agent-task-v1.schema.json" with { type: "json" };
interface AddFormatsModule {
  default?: (ajv: Ajv2020) => void;
}
// ajv-formats is CommonJS; normalise the default export across loaders.
const formatsModule: AddFormatsModule & ((ajv: Ajv2020) => void) = addFormatsModule as never;
const addFormats = formatsModule.default ?? formatsModule;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);

export const AGENT_TASK_SCHEMA_V1 = schema;

// ── Run states ───────────────────────────────────────────────────────────────

export const AGENT_RUN_STATES = [
  "CREATED",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

export function isAgentRunState(value: unknown): value is AgentRunState {
  return typeof value === "string" && (AGENT_RUN_STATES as readonly string[]).includes(value);
}

/**
 * The only legal moves. COMPLETED is reachable only through VERIFYING: a run that did not verify
 * its result cannot be reported as done. Terminal states have no exits.
 */
export const RUN_TRANSITIONS: Readonly<Record<AgentRunState, readonly AgentRunState[]>> = {
  CREATED: ["READY", "FAILED", "CANCELLED"],
  READY: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["WAITING_APPROVAL", "VERIFYING", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "FAILED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TERMINAL_RUN_STATES: readonly AgentRunState[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isTerminalRunState(state: AgentRunState): boolean {
  return RUN_TRANSITIONS[state].length === 0;
}

export function canTransition(from: AgentRunState, to: AgentRunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  override name = "InvalidTransitionError";
  constructor(
    readonly from: AgentRunState,
    readonly to: AgentRunState,
  ) {
    super(
      isTerminalRunState(from)
        ? `Run is ${from} and can no longer change (requested ${to})`
        : `A run cannot move from ${from} to ${to}`,
    );
  }
}

/** Throws InvalidTransitionError unless `from → to` is in the table. */
export function assertTransition(from: AgentRunState, to: AgentRunState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

// ── Objects ──────────────────────────────────────────────────────────────────

export interface AgentTask {
  id: string;
  kind: string;
  input: Record<string, unknown>;
  requestedBy: string;
  createdAt: string;
  correlationId: string;
}

export interface AgentDescriptor {
  id: string;
  kind: string;
  version: string;
}

export interface AgentRun {
  id: string;
  taskId: string;
  agentId: string;
  state: AgentRunState;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface PlanStep {
  index: number;
  /** `<capabilityId>.<command>`; must exist in the tool registry. */
  tool: string;
  input: Record<string, unknown>;
  purpose: string;
}

export interface Plan {
  steps: PlanStep[];
}

export interface ToolRequest {
  tool: string;
  input: Record<string, unknown>;
  stepIndex?: number;
}

export type ToolDecisionEffect = "allow" | "deny" | "require_approval";
export type ToolRisk = "low" | "medium" | "high" | "critical";

export interface ToolResult {
  tool: string;
  ok: boolean;
  operationId?: string;
  /** Audit record of the policy decision that preceded the call. */
  auditId?: number;
  decision?: ToolDecisionEffect;
  risk?: ToolRisk;
  errorCode?: string;
  errorMessage?: string;
}

export const EVIDENCE_KINDS = ["tool_output", "memory", "commit", "log", "model"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  /** Where it came from: tool name, memory id, commit sha. */
  source: string;
  /** SHA-256 (hex) of the full text the excerpt was cut from. */
  excerptHash: string;
  excerpt: string;
  truncated: boolean;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
  /**
   * Default true. An informational check (false) records something the verifier repaired or
   * noticed, for example a model citation it removed; it does not decide `Verification.passed`.
   */
  required?: boolean;
}

export interface Verification {
  /** True when every required check passed. A run whose verification did not pass is FAILED. */
  passed: boolean;
  checks: VerificationCheck[];
}

export interface DiagnosisClaim {
  text: string;
  evidenceIds: string[];
  /** Who wrote the claim: Phoenix's own rules, or a model (whose claims are checked). */
  origin?: "rule" | "model";
  /** True only when every cited id exists, is non-empty, and the claim cites at least one. */
  grounded: boolean;
  note?: string;
}

export interface Diagnosis {
  summary: string;
  claims: DiagnosisClaim[];
  /** Grounded claims / total claims. Computed by Phoenix, never taken from a model. */
  evidenceCoverage: number;
  /** The model's own words about its confidence, labelled as such. Not a measure. */
  modelReportedConfidence?: string;
  aiUsed: boolean;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type ObjectResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function validator<T>(name: string): (value: unknown) => ObjectResult<T> {
  const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
  return (value) => {
    if (validate(value)) return { ok: true, value: value as T };
    return {
      ok: false,
      problems: (validate.errors ?? [])
        .slice(0, 20)
        .map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`),
    };
  };
}

/** Each returns problems instead of throwing, whatever the input. */
export const validateAgentTask = validator<AgentTask>("task");
export const validateAgentDescriptor = validator<AgentDescriptor>("agent");
export const validateAgentRun = validator<AgentRun>("agentRun");
export const validatePlanStep = validator<PlanStep>("planStep");
export const validatePlan = validator<Plan>("plan");
export const validateToolRequest = validator<ToolRequest>("toolRequest");
export const validateToolResult = validator<ToolResult>("toolResult");
export const validateEvidence = validator<Evidence>("evidence");
export const validateVerification = validator<Verification>("verification");
export const validateDiagnosis = validator<Diagnosis>("diagnosis");
