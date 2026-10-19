// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// n8n executions → Phoenix events (n8n.execution.succeeded / n8n.execution.failed). Pure.
//
// History rule: an execution first seen already finished and older than `liveSince` is recorded
// silently, so enabling the capability does not replay last week's failures. One that was running
// when it was first seen reports how it ended. Running executions make no event.
import { ChangeTracker, httpsUrl, seg } from "@phoenix/service-kit";
import type { Execution, Workflow } from "./parse";

export interface N8nEvent {
  event_type: "n8n.execution.succeeded" | "n8n.execution.failed";
  severity: "success" | "error";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
}

export function executionTracker(liveSince: number): ChangeTracker<Execution> {
  return new ChangeTracker<Execution>({
    key: (e) => e.id,
    state: (e) => e.phase,
    at: (e) => e.startedAt,
    liveSince,
  });
}

/** The page of the execution in the user's n8n, when its address is https. */
export function executionUrl(baseUrl: string, e: Execution): string | undefined {
  return httpsUrl(`${baseUrl}/workflow/${seg(e.workflowId)}/executions/${seg(e.id)}`);
}

export function executionEvent(
  e: Execution,
  workflows: Readonly<Record<string, Workflow>>,
  baseUrl: string,
): N8nEvent | undefined {
  if (e.phase !== "succeeded" && e.phase !== "failed") return undefined;
  const ok = e.phase === "succeeded";
  const name = Object.hasOwn(workflows, e.workflowId) ? workflows[e.workflowId]!.name : undefined;
  const url = executionUrl(baseUrl, e);
  return {
    event_type: ok ? "n8n.execution.succeeded" : "n8n.execution.failed",
    severity: ok ? "success" : "error",
    correlation_id: `n8n-execution-${e.id}`,
    subject: name ?? `workflow ${e.workflowId}`,
    payload: {
      execution_id: e.id,
      workflow_id: e.workflowId,
      ...(name ? { workflow: name } : {}),
      status: e.status,
      ...(e.mode ? { mode: e.mode } : {}),
      ...(url ? { url } : {}),
    },
  };
}

export function diffExecutions(
  tracker: ChangeTracker<Execution>,
  executions: readonly Execution[],
  workflows: readonly Workflow[],
  baseUrl: string,
): N8nEvent[] {
  const byId: Record<string, Workflow> = {};
  for (const w of workflows) byId[w.id] = w;
  const events: N8nEvent[] = [];
  const oldestFirst = [...executions].sort((a, b) => a.startedAt - b.startedAt);
  for (const { item } of tracker.update(oldestFirst)) {
    const event = executionEvent(item, byId, baseUrl);
    if (event) events.push(event);
  }
  return events;
}
