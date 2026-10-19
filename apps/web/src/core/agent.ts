// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { translated } from "./format";
import type { AgentRisk, AgentRunState, AgentStep } from "./types";

/** Plain-language run states (Phase 31 state machine). Only states Core actually reports. */
export const RUN_STATE_TEXT = translated({
  CREATED: "agents.runState.CREATED",
  READY: "agents.runState.READY",
  RUNNING: "agents.runState.RUNNING",
  WAITING_APPROVAL: "agents.runState.WAITING_APPROVAL",
  VERIFYING: "agents.runState.VERIFYING",
  COMPLETED: "agents.runState.COMPLETED",
  FAILED: "agents.runState.FAILED",
  CANCELLED: "agents.runState.CANCELLED",
});

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

export const RISK_LABEL = translated({
  low: "agents.risk.low",
  medium: "agents.risk.medium",
  high: "agents.risk.high",
  critical: "agents.risk.critical",
});

/** High and Critical changes need a second, explicit step before they can be approved. */
export const needsSecondStep = (risk: AgentRisk | undefined): boolean =>
  risk === "high" || risk === "critical";

export const STEP_STATUS_TEXT = translated({
  ok: "agents.stepStatus.ok",
  failed: "agents.stepStatus.failed",
  rejected: "agents.stepStatus.rejected",
  cancelled: "agents.stepStatus.cancelled",
  skipped: "agents.stepStatus.skipped",
  denied: "agents.stepStatus.denied",
  abandoned: "agents.stepStatus.abandoned",
});

export const DECISION_TEXT = translated({
  allow: "agents.decision.allow",
  require_approval: "agents.decision.require_approval",
  deny: "agents.decision.deny",
});

/** What a side effect means as a verb phrase, for "I understand this will …". */
export const SIDE_EFFECT_ACTION = translated({
  none: "agents.sideEffectAction.none",
  read: "agents.sideEffectAction.read",
  write: "agents.sideEffectAction.write",
  execute: "agents.sideEffectAction.execute",
  external: "agents.sideEffectAction.external",
  production: "agents.sideEffectAction.production",
});
