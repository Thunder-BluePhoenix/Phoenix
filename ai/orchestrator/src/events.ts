// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { NewEvent } from "@phoenix/protocol";
import { safeText } from "./plan";

/**
 * Event types of an agent run, as Fawkes sees them. The namespace `agent_run` is not one of the
 * reserved Phoenix namespaces and does not collide with `agent.*` (the coding-agents capability).
 * `core/state-engine/src/default-mapping.ts` maps them: started/thinking → THINKING,
 * waiting → WAITING, completed → SUCCESS (short ttl), failed → ERROR, cancelled → clear.
 */
export const RUN_EVENT_TYPES = {
  started: "agent_run.started",
  thinking: "agent_run.thinking",
  waiting: "agent_run.waiting",
  completed: "agent_run.completed",
  failed: "agent_run.failed",
  cancelled: "agent_run.cancelled",
} as const;
export type RunEventKind = keyof typeof RUN_EVENT_TYPES;

export interface RunEventFacts {
  taskId: string;
  runId: string;
  /** One per run: the state engine keys the Fawkes condition on it. */
  correlationId: string;
  agentKind: string;
  /** Rule-built from validated input, for example "CI failure in owner/name". */
  title: string;
}

export function runEvent(
  kind: RunEventKind,
  facts: RunEventFacts,
  extra: { stage?: string; reason?: string } = {},
): NewEvent {
  return {
    event_type: RUN_EVENT_TYPES[kind],
    source: "core",
    severity: kind === "failed" ? "error" : kind === "completed" ? "success" : "info",
    correlation_id: facts.correlationId,
    subject: facts.title.slice(0, 200),
    ...(kind === "waiting" ? { requires_action: true } : {}),
    payload: {
      task_id: facts.taskId,
      run_id: facts.runId,
      kind: facts.agentKind,
      title: facts.title.slice(0, 200),
      ...(extra.stage ? { stage: extra.stage } : {}),
      ...(extra.reason ? { reason: safeText(extra.reason, 200) } : {}),
    },
  };
}
