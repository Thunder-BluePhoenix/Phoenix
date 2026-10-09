// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AgentRisk, AgentRunState, AgentStep, AgentTaskDetail } from "./types";

/** Plain-language run states (Phase 31 state machine). Only states Core actually reports. */
export const RUN_STATE_TEXT: Record<AgentRunState, string> = {
  CREATED: "Created, not started yet",
  READY: "Ready to start",
  RUNNING: "Running",
  WAITING_APPROVAL: "Waiting for your approval",
  VERIFYING: "Checking the result",
  COMPLETED: "Finished",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const TERMINAL: Record<AgentRunState, boolean> = {
  CREATED: false,
  READY: false,
  RUNNING: false,
  WAITING_APPROVAL: false,
  VERIFYING: false,
  COMPLETED: true,
  FAILED: true,
  CANCELLED: true,
};

/** A finished run cannot be cancelled or change again. */
export const isTerminalRun = (state: AgentRunState): boolean => TERMINAL[state];

export const RISK_LABEL: Record<AgentRisk, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

/** High and Critical changes need a second, explicit step before they can be approved. */
export const needsSecondStep = (risk: AgentRisk | undefined): boolean =>
  risk === "high" || risk === "critical";

export const STEP_STATUS_TEXT: Record<string, string> = {
  ok: "done",
  failed: "failed",
  rejected: "rejected before it ran",
  cancelled: "cancelled",
  skipped: "skipped",
  denied: "denied by policy",
  abandoned: "abandoned",
};

export const DECISION_TEXT: Record<NonNullable<AgentStep["decision"]>, string> = {
  allow: "allowed by policy",
  require_approval: "needed your approval",
  deny: "denied by policy",
};

/** What a side effect means as a verb phrase, for "I understand this will …". */
export const SIDE_EFFECT_ACTION: Record<string, string> = {
  none: "have no side effects",
  read: "read data",
  write: "change data",
  execute: "run commands",
  external: "act on an external service",
  production: "change production",
};

const KIND_TITLE: Record<string, (input: Record<string, unknown>) => string> = {
  ci_failure: (input) =>
    typeof input.repository === "string" ? `CI failure in ${input.repository}` : "CI failure",
};

/** The task's title; Core's detail route does not carry one, so it is derived from kind and input. */
export function taskTitle(detail: AgentTaskDetail): string {
  const titleOf = KIND_TITLE[detail.task.kind];
  return titleOf ? titleOf(detail.task.input) : "Agent task";
}
