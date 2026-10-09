// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What a UI may see of a run: statuses, per-step state, and inputs/outputs that are redacted and
// cut short. Nothing here is a handle to change anything.
import { displayJson } from "./bound";
import type { RunRecord, StepRecord } from "./store";
import { TERMINAL_STATUSES, type RunStatus, type StepStatus } from "./types";

export const VIEW_TEXT_LIMIT = 600;

export interface StepView {
  seq: number;
  stepId: string;
  phase: "step" | "compensation";
  type: string;
  status: StepStatus;
  attempts: number;
  /** Decided from the tool contract when the step ran. */
  destructive: boolean;
  tool: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  terminal: boolean;
  correlationId: string;
  triggerEventId: string;
  chainDepth: number;
  currentStep: string | null;
  reason: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RunView extends RunSummary {
  trigger: string;
  steps: StepView[];
}

export function summarise(run: RunRecord): RunSummary {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.definition.name,
    status: run.status,
    terminal: TERMINAL_STATUSES[run.status],
    correlationId: run.correlationId,
    triggerEventId: run.triggerEventId,
    chainDepth: run.chainDepth,
    currentStep: run.currentStep,
    reason: run.reason,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

export function stepView(step: StepRecord): StepView {
  return {
    seq: step.seq,
    stepId: step.stepId,
    phase: step.phase,
    type: step.stepType,
    status: step.status,
    attempts: step.attempts,
    destructive: step.destructive,
    tool: step.tool,
    input: step.input === null ? null : displayJson(step.input, VIEW_TEXT_LIMIT),
    output: step.output === null ? null : displayJson(step.output, VIEW_TEXT_LIMIT),
    error: step.error,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
  };
}

export function runView(run: RunRecord, steps: StepRecord[]): RunView {
  return {
    ...summarise(run),
    trigger: displayJson(run.triggerEvent, VIEW_TEXT_LIMIT),
    steps: steps.map(stepView),
  };
}

export interface WorkflowMetrics {
  runsStarted: number;
  runsSucceeded: number;
  runsFailed: number;
  runsCancelled: number;
  runsRejected: number;
  runsInterrupted: number;
  runsRefused: number;
  runsCompensated: number;
  runsNeedingAttention: number;
  stepsSucceeded: number;
  stepsFailed: number;
  /** Failed / (failed + succeeded); 0 when no step has finished. */
  stepFailureRate: number;
  /** Over the latest finished runs that started. null when there are none. */
  duration: { p50: number; p90: number; p99: number; samples: number } | null;
  approvalsWaiting: number;
  approvalsApproved: number;
  approvalsRejected: number;
  approvalsExpired: number;
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

export function buildMetrics(
  counters: Readonly<Record<string, number>> | undefined,
  durations: readonly number[],
  approvalsWaiting: number,
): WorkflowMetrics {
  const c = (name: string): number => counters?.[name] ?? 0;
  const done = c("steps_succeeded") + c("steps_failed");
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    runsStarted: c("runs_started"),
    runsSucceeded: c("runs_succeeded"),
    runsFailed: c("runs_failed"),
    runsCancelled: c("runs_cancelled"),
    runsRejected: c("runs_rejected"),
    runsInterrupted: c("runs_interrupted"),
    runsRefused: c("runs_refused"),
    runsCompensated: c("runs_compensated"),
    runsNeedingAttention: c("runs_needs_attention"),
    stepsSucceeded: c("steps_succeeded"),
    stepsFailed: c("steps_failed"),
    stepFailureRate: done === 0 ? 0 : c("steps_failed") / done,
    duration:
      sorted.length === 0
        ? null
        : {
            p50: percentile(sorted, 50),
            p90: percentile(sorted, 90),
            p99: percentile(sorted, 99),
            samples: sorted.length,
          },
    approvalsWaiting,
    approvalsApproved: c("approvals_approved"),
    approvalsRejected: c("approvals_rejected"),
    approvalsExpired: c("approvals_expired"),
  };
}
