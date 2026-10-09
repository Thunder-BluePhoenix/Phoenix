// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ToolCall, ToolCallResult, ToolContract } from "@phoenix/ai-tool-gateway";
import type { DataClass, Environment, PolicyDecision, RiskTier } from "@phoenix/policy";
import type {
  AgentDescriptor,
  AgentRunState,
  AgentTask,
  Diagnosis,
  Evidence,
  NewEvent,
  PlanStep,
  ToolRequest,
  Verification,
} from "@phoenix/protocol";
import type { EvidenceBook } from "./evidence";

/** The request lifecycle, in order. Every stage writes one audit record. */
export const STAGES = [
  "classify",
  "retrieve",
  "plan",
  "policy_check",
  "execute",
  "verify",
  "respond",
  "audit",
] as const;
export type StageName = (typeof STAGES)[number];

export type StageStatus = "ok" | "failed" | "rejected" | "cancelled" | "skipped";

/**
 * Where a task's tool calls are aimed. Comes from the agent's trusted code and configuration
 * (the task kind), never from model output.
 */
export interface TrustedTarget {
  environment: Environment;
  /** What the calls act on, for example `repo:owner/name`. Matched by policy rules. */
  resource: string;
  dataClass: DataClass;
}

export type ClassifyResult =
  { ok: true; target: TrustedTarget; title: string } | { ok: false; reason: string };

/** What the agent concluded. Advisory: nothing in it is ever executed. */
export interface Proposal {
  text: string;
  rationale: string;
  evidenceIds: string[];
  /** Always true in this phase: a proposal is advice, not an action. */
  advisory: true;
  /** True only when every cited evidence id exists and is non-empty. */
  grounded: boolean;
}

export interface Conclusion {
  summary: string;
  diagnosis?: Diagnosis;
  proposals: Proposal[];
  /** True when model output made it into `summary`, `diagnosis` or `proposals`. */
  aiUsed: boolean;
  /** "Ollama · llama3.2 · on this device" when a model answered. */
  processedBy?: string;
  /** Model requests made during the run, accepted or not. */
  modelCalls: number;
}

export interface VerifyResult {
  verification: Verification;
  /** The conclusion after the verifier flagged or removed what it could not confirm. */
  conclusion: Conclusion;
}

export interface ToolFailure {
  code: string;
  message: string;
}

/** What `RunContext.callTool` returns on success. */
export interface ToolCallOutput {
  output: unknown;
  auditId: number;
  decision: ToolCallResult["decision"]["effect"];
  risk: RiskTier;
  operationId: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  sideEffect: ToolContract["sideEffect"];
}

/** Everything an agent may use while a run is in progress. */
export interface RunContext {
  readonly task: AgentTask;
  readonly runId: string;
  readonly target: TrustedTarget;
  readonly evidence: EvidenceBook;
  /** Aborted when the run is cancelled or the kill switch is engaged. */
  readonly signal: AbortSignal;
  /** Tools of the capabilities this agent kind may use, as currently registered. */
  availableTools(): ToolInfo[];
  /**
   * The only way an agent acts. Goes through the orchestrator (budget, allow-list, cancellation,
   * trace) and then `ToolGateway.call`. Throws `ToolCallFailure`.
   */
  callTool(request: ToolRequest): Promise<ToolCallOutput>;
  /** Counts a model request (the orchestrator reports the total in the trace). */
  countModelCall(): void;
}

/** A kind of task and the code that handles it. Registered with the orchestrator by the runtime. */
export interface AgentDefinition {
  descriptor: AgentDescriptor;
  /** Capability ids this kind of task may call. A plan naming any other capability is rejected. */
  allowedCapabilities: readonly string[];
  /** Exact tool names this kind of task may call. */
  allowedTools: readonly string[];
  /** Rule-based. Validates the input and fixes the trusted target. Never calls a model. */
  classify(task: AgentTask): ClassifyResult;
  retrieve?(rc: RunContext): Promise<void> | void;
  /** May be produced from model output: it is untrusted and validated before anything runs. */
  plan(rc: RunContext): Promise<unknown> | unknown;
  /**
   * Supplies the input of a step at the moment it runs, from what earlier steps observed (for
   * example the head commit of the run being investigated). It is agent CODE, never model output,
   * and the gateway validates the result against the tool's input schema like any other call. The
   * plan's own input for the step is what plan validation saw; without this hook it is used as is.
   */
  prepareInput?(rc: RunContext, step: PlanStep): Record<string, unknown>;
  /** Called with each successful tool output so the agent can record evidence. */
  afterTool?(rc: RunContext, step: PlanStep, output: unknown): Promise<void> | void;
  /** "continue" keeps going without that tool's result; the default is to fail the run. */
  toolFailure?(rc: RunContext, step: PlanStep, failure: ToolFailure): "continue" | "fail";
  /** After all steps ran: understand and propose. */
  conclude(rc: RunContext): Promise<Conclusion>;
  /** Called once when the run reaches a final state, so the agent can drop per-run state. */
  finished?(runId: string): void;
  /** Check the conclusion (and, for acting agents, re-read the world). */
  verify(rc: RunContext, conclusion: Conclusion): Promise<VerifyResult>;
}

export interface ApprovalSignal {
  kind: "requested" | "resolved";
  confirmationId: string;
  capabilityId: string;
  command: string;
  outcome?: "approved" | "rejected" | "expired";
}

/** The user-approval flow, as the orchestrator sees it. Implemented by the runtime. */
export interface ApprovalFeed {
  subscribe(listener: (signal: ApprovalSignal) => void): () => void;
  /** Confirmations waiting for an answer right now. */
  pending(): { id: string; capabilityId: string; command: string }[];
  /** Declines a pending confirmation (used when a run is cancelled while waiting). */
  reject(confirmationId: string): void;
}

/** The slice of AuditLog the orchestrator uses. */
export interface AuditTrail {
  record(entry: {
    actor: string;
    action: string;
    capabilityId?: string;
    decision: "allowed" | "denied" | "blocked" | "pending" | "info";
    details: Record<string, unknown>;
  }): { id: number };
}

/** The slice of ToolGateway the orchestrator uses. It is the only way to a capability. */
export interface ToolCaller {
  tools(): ToolContract[];
  /** What policy would decide now, recorded nowhere. Optional: used for the policy_check stage. */
  preview?(call: ToolCall): PolicyDecision;
  call(call: ToolCall): Promise<ToolCallResult>;
}

export interface Limits {
  /** Most plan steps. */
  maxSteps: number;
  /** Most tool calls in a run, including the verifier's. */
  maxToolCalls: number;
  /** Wall time from submit to the last stage, by the injected clock. */
  maxWallMs: number;
  /** Runs executing at once. */
  maxActiveRuns: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxSteps: 8,
  maxToolCalls: 12,
  maxWallMs: 10 * 60_000,
  maxActiveRuns: 4,
};

export type FawkesPublisher = (event: NewEvent) => void;

/** What the API shows for the confirmation an agent run is waiting on. */
export interface ConfirmationContext {
  task_id: string;
  run_id: string;
  risk: RiskTier;
  target: string;
  preview: string;
  evidence_ids: string[];
}

export type { AgentRunState, Evidence };
