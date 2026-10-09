// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// AI observability. A RunObservation is built AFTER a run from what Phoenix already persisted
// (agent_runs/steps/evidence, the audit log) plus the model provenance the caller hands over. It
// says which model answered, which prompt version and context ran, which sources were used, which
// tools were called and what policy decided, how long each stage took, what it cost and how it
// ended. It never contains a prompt, memory text, tool output, evidence text or a secret: only
// ids, names, counts, hashes and numbers. `observationLeaks` is what the tests use to prove it.
import { createHash } from "node:crypto";
import type { TaskTrace } from "@phoenix/ai-orchestrator";
import type { AuditEntry } from "@phoenix/permissions";
import type { Locality } from "@phoenix/ai-models";
import { normalise } from "./text";

export interface ModelUse {
  provider: string;
  model: string;
  locality: Locality;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ToolObservation {
  tool: string;
  status: string;
  decision: string | null;
  risk: string | null;
  /** Audit row of the policy decision. */
  policyAuditId: number | null;
  /** True when the audit row exists and says what the step says. */
  auditConfirmed: boolean;
}

export interface StageObservation {
  name: string;
  status: string;
  durationMs: number;
  auditId: number | null;
}

export interface RunObservation {
  version: 1;
  taskId: string;
  runId: string;
  agentId: string;
  agentVersion: string;
  outcome: string;
  failureReason: string | null;
  model: ModelUse | null;
  /** SHA-256 of the agent's system prompt (supplied by the caller; null when not known). */
  promptVersion: string | null;
  /** SHA-256 over the sorted evidence ids and hashes: identifies the context the run reasoned over. */
  contextVersion: string;
  /** Evidence by kind: how many pieces came from tools, memory, commits, logs, model output. */
  sources: Record<string, number>;
  /** Memory ids the run used as evidence (ids only). */
  memoryIds: string[];
  toolCalls: ToolObservation[];
  /** Policy decisions made during the run, counted by effect. */
  permissionDecisions: Record<string, number>;
  stages: StageObservation[];
  totalDurationMs: number;
  tokens: { input: number; output: number };
  /** Cost estimate in micro-dollars: 0 for a local provider. */
  costMicroUsd: number;
  cloudCalls: number;
  aiUsed: boolean;
  evidenceCoverage: number | null;
  auditIds: number[];
}

export interface PriceTable {
  /** Micro-dollars per 1,000 tokens, by provider id. Absent provider = local = free. */
  inputPer1k: Record<string, number>;
  outputPer1k: Record<string, number>;
}

/** Estimates only: provider prices change. Local providers cost nothing. */
export const NO_PRICES: PriceTable = { inputPer1k: {}, outputPer1k: {} };

export interface ObservationInput {
  trace: TaskTrace;
  /** Audit rows of the run's window (at least the ones named in the trace). */
  audit: readonly AuditEntry[];
  model?: ModelUse | null;
  /** The agent's system prompt text, hashed here and discarded. */
  systemPrompt?: string;
  prices?: PriceTable;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const ms = (iso: string): number => Date.parse(iso);

export function buildObservation(input: ObservationInput): RunObservation {
  const { trace, audit } = input;
  const byId: Record<number, AuditEntry> = {};
  for (const row of audit) byId[row.id] = row;

  const stages: StageObservation[] = trace.steps
    .filter((s) => s.kind === "stage")
    .map((s) => ({
      name: s.name,
      status: s.status,
      durationMs: Math.max(0, ms(s.finishedAt) - ms(s.startedAt)),
      auditId: s.stageAuditId,
    }));
  const toolCalls: ToolObservation[] = trace.steps
    .filter((s) => s.kind === "tool_call")
    .map((s) => {
      const row = s.policyAuditId === null ? undefined : byId[s.policyAuditId];
      return {
        tool: s.name,
        status: s.status,
        decision: s.decision,
        risk: s.risk,
        policyAuditId: s.policyAuditId,
        auditConfirmed:
          row !== undefined &&
          row.action === "policy.decision" &&
          row.details.tool === s.name &&
          (s.decision === null || row.details.effect === s.decision),
      };
    });
  const permissionDecisions: Record<string, number> = {};
  for (const call of toolCalls) {
    if (call.decision)
      permissionDecisions[call.decision] = (permissionDecisions[call.decision] ?? 0) + 1;
  }
  const sources: Record<string, number> = {};
  for (const e of trace.evidence) sources[e.kind] = (sources[e.kind] ?? 0) + 1;

  const first = trace.steps[0];
  const last = trace.steps.at(-1);
  const model = input.model ?? null;
  const prices = input.prices ?? NO_PRICES;
  const cost = model
    ? ((prices.inputPer1k[model.provider] ?? 0) * model.inputTokens +
        (prices.outputPer1k[model.provider] ?? 0) * model.outputTokens) /
      1000
    : 0;
  return {
    version: 1,
    taskId: trace.task.id,
    runId: trace.run.id,
    agentId: trace.run.agentId,
    agentVersion: trace.run.agentVersion,
    outcome: trace.run.state,
    failureReason: trace.run.failureReason ?? null,
    model,
    promptVersion: input.systemPrompt === undefined ? null : sha256(input.systemPrompt),
    contextVersion: sha256(
      trace.evidence
        .map((e) => `${e.id}:${e.kind}:${e.excerptHash}`)
        .sort()
        .join("\n"),
    ),
    sources,
    memoryIds: trace.evidence.filter((e) => e.kind === "memory").map((e) => e.source),
    toolCalls,
    permissionDecisions,
    stages,
    totalDurationMs: first && last ? Math.max(0, ms(last.finishedAt) - ms(first.startedAt)) : 0,
    tokens: { input: model?.inputTokens ?? 0, output: model?.outputTokens ?? 0 },
    costMicroUsd: Math.round(cost),
    cloudCalls: model?.locality === "cloud" ? model.calls : 0,
    aiUsed: trace.conclusion?.aiUsed ?? false,
    evidenceCoverage: trace.conclusion?.diagnosis?.evidenceCoverage ?? null,
    auditIds: trace.auditIds,
  };
}

/**
 * Canary strings found in an observation's JSON. Used by tests and by the store as a last check
 * before anything is persisted.
 */
export function observationLeaks(observation: unknown, canaries: readonly string[]): string[] {
  const text = normalise(JSON.stringify(observation));
  return canaries.filter((c) => text.includes(normalise(c)));
}
