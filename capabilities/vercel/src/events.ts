// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Vercel deployments → Phoenix events. Pure: the poller hands over what Vercel says now, the
// tracker remembers what it said last time.
//
// History rule: a deployment first seen older than `liveSince` (the moment the capability was
// enabled) is recorded silently, so enabling it does not replay last week's deployments. One that
// was already building at that moment still reports how it ended (it is "changed", not "new").
import { ChangeTracker } from "@phoenix/service-kit";
import type { Deployment } from "./parse";

export type DeployPhase = "started" | "succeeded" | "failed" | "cancelled";

export interface VercelEvent {
  event_type: string;
  severity: "info" | "success" | "warning" | "error";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
}

const STATE_PHASE: Readonly<Record<string, DeployPhase>> = {
  QUEUED: "started",
  INITIALIZING: "started",
  BUILDING: "started",
  READY: "succeeded",
  ERROR: "failed",
  CANCELED: "cancelled",
};

const SEVERITY: Readonly<Record<DeployPhase, VercelEvent["severity"]>> = {
  started: "info",
  succeeded: "success",
  failed: "error",
  cancelled: "warning",
};

/** What a Vercel state word means for Phoenix; undefined for words Phoenix has no event for. */
export function deployPhase(state: string): DeployPhase | undefined {
  return Object.hasOwn(STATE_PHASE, state) ? STATE_PHASE[state] : undefined;
}

export function deploymentTracker(liveSince: number): ChangeTracker<Deployment> {
  return new ChangeTracker<Deployment>({
    key: (d) => d.id,
    state: (d) => deployPhase(d.state) ?? "other",
    at: (d) => d.createdAt,
    liveSince,
  });
}

export function deploymentEvent(d: Deployment, phase: DeployPhase): VercelEvent {
  return {
    event_type: `vercel.deploy.${phase}`,
    severity: SEVERITY[phase],
    correlation_id: `vercel-deploy-${d.id}`,
    subject: `${d.project} (${d.target})`,
    payload: {
      deployment_id: d.id,
      project: d.project,
      environment: d.target,
      target: d.target,
      state: phase,
      ...(d.url ? { url: d.url } : {}),
      ...(d.branch ? { branch: d.branch } : {}),
      ...(d.sha ? { sha: d.sha } : {}),
      ...(d.repository ? { repository: d.repository } : {}),
      ...(d.actor ? { actor: d.actor } : {}),
    },
  };
}

/** Events for what changed since the previous poll, oldest deployment first. */
export function diffDeployments(
  tracker: ChangeTracker<Deployment>,
  deployments: readonly Deployment[],
): VercelEvent[] {
  const events: VercelEvent[] = [];
  const oldestFirst = [...deployments].sort((a, b) => a.createdAt - b.createdAt);
  for (const { item } of tracker.update(oldestFirst)) {
    const phase = deployPhase(item.state);
    if (phase !== undefined) events.push(deploymentEvent(item, phase));
  }
  return events;
}
