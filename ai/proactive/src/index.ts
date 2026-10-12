// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pure, read-only insight generation. Callers must supply authenticated, current structured
// snapshots from enabled capabilities; missing snapshots never imply a fact.
export type InsightKind =
  "deploy_window_risk" | "related_incident" | "unassigned_action" | "dependency_update";
export interface Insight {
  id: string;
  kind: InsightKind;
  capabilityId: string;
  title: string;
  body: string;
  evidenceIds: string[];
  subjectId: string;
}
export interface DeployWindow {
  id: string;
  capabilityId: string;
  evidenceId: string;
  /** Explicitly scheduled by the trusted deployment provider. */
  startsAt: string;
  endsAt: string;
  serviceId: string;
  status: "scheduled" | "cancelled" | "completed";
}
export interface Incident {
  id: string;
  capabilityId: string;
  evidenceId: string;
  serviceId: string;
  status: "active" | "mitigated" | "resolved";
  observedAt: string;
}
export interface ReviewedAction {
  id: string;
  capabilityId: string;
  evidenceId: string;
  status: "accepted" | "proposed" | "edited" | "rejected";
  kind: "action_item" | "other";
  owner: string | null;
  /** The reviewed item remains present in the latest source snapshot. */
  current: boolean;
}
export interface DependencyUpdate {
  id: string;
  capabilityId: string;
  evidenceId: string;
  packageId: string;
  currentVersion: string;
  availableVersion: string;
  status: "available" | "applied" | "revoked";
}
export interface InsightSources {
  deployments?: readonly DeployWindow[];
  incidents?: readonly Incident[];
  items?: readonly ReviewedAction[];
  dependencyUpdates?: readonly DependencyUpdate[];
  now?: number;
}
const MAX_INSIGHTS = 20;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const valid = (s: string): boolean =>
  typeof s === "string" && s.length > 0 && s.length <= 160 && !/[\x00-\x1f]/.test(s);
const timestamp = (s: string): number => (typeof s === "string" ? Date.parse(s) : NaN);
const identity = (r: { id: string; capabilityId: string; evidenceId: string }): boolean =>
  valid(r.id) && valid(r.capabilityId) && valid(r.evidenceId);

/** Deterministic, bounded output; no model calls, network requests or write effects. */
export function generateInsights(sources: InsightSources): Insight[] {
  const now = sources.now ?? Date.now();
  if (!Number.isFinite(now)) return [];
  const results: Insight[] = [];
  const seen = new Set<string>();
  const add = (
    kind: InsightKind,
    capabilityId: string,
    subjectId: string,
    title: string,
    body: string,
    evidenceIds: string[],
  ) => {
    const id = `${kind}:${capabilityId}:${subjectId}`;
    if (evidenceIds.every(valid) && !seen.has(id)) {
      seen.add(id);
      results.push({ id, kind, capabilityId, subjectId, title, body, evidenceIds });
    }
  };
  const incidents = (sources.incidents ?? []).filter(
    (i) =>
      identity(i) &&
      valid(i.serviceId) &&
      i.status === "active" &&
      Number.isFinite(timestamp(i.observedAt)) &&
      timestamp(i.observedAt) <= now &&
      now - timestamp(i.observedAt) <= WINDOW_MS,
  );
  for (const deployment of [...(sources.deployments ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (!identity(deployment) || !valid(deployment.serviceId) || deployment.status !== "scheduled")
      continue;
    const start = timestamp(deployment.startsAt);
    const end = timestamp(deployment.endsAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > end ||
      end < now ||
      start > now + WINDOW_MS
    )
      continue;
    const related = incidents
      .filter(
        (i) => i.serviceId === deployment.serviceId && i.capabilityId === deployment.capabilityId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (related.length === 0) continue;
    const incident = related[0]!;
    add(
      "deploy_window_risk",
      deployment.capabilityId,
      deployment.id,
      "Scheduled deployment overlaps an active incident",
      `Service ${deployment.serviceId} has an active incident during its deployment window.`,
      [deployment.evidenceId, incident.evidenceId],
    );
    add(
      "related_incident",
      incident.capabilityId,
      incident.id,
      "Active incident affects a scheduled deployment",
      `Incident ${incident.id} affects service ${incident.serviceId}.`,
      [incident.evidenceId, deployment.evidenceId],
    );
  }
  for (const item of [...(sources.items ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (
      identity(item) &&
      item.current === true &&
      item.kind === "action_item" &&
      item.status === "accepted" &&
      item.owner === null
    )
      add(
        "unassigned_action",
        item.capabilityId,
        item.id,
        "Accepted action item has no owner",
        `Action item ${item.id} is unassigned.`,
        [item.evidenceId],
      );
  }
  for (const update of [...(sources.dependencyUpdates ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (
      identity(update) &&
      valid(update.packageId) &&
      valid(update.currentVersion) &&
      valid(update.availableVersion) &&
      update.currentVersion !== update.availableVersion &&
      update.status === "available"
    )
      add(
        "dependency_update",
        update.capabilityId,
        update.id,
        "Dependency update available",
        `${update.packageId}: ${update.currentVersion} → ${update.availableVersion}`,
        [update.evidenceId],
      );
  }
  return results.sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_INSIGHTS);
}
