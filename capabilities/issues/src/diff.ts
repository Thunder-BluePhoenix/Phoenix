// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pure event derivation, identical for every tracker: what the capability remembered about an
// issue assigned to the user, plus what the tracker says now, gives zero or more issues.* events.
import type { IssueCategory, IssueEvent, RawIssueChange } from "./types";

/** What is remembered about an issue that is (or was last seen) assigned to the user. */
export interface IssueSnapshot {
  key: string;
  ref: string;
  status: string;
  category: IssueCategory;
  updatedAt: string;
}

export function snapshotOf(change: RawIssueChange): IssueSnapshot {
  return {
    key: change.key,
    ref: change.ref,
    status: change.status,
    category: change.category,
    updatedAt: change.updatedAt,
  };
}

/** One stable correlation id per issue, so Fawkes keeps one activity per issue. */
export function correlationId(change: Pick<RawIssueChange, "tracker" | "key">): string {
  return `issues-${change.tracker}-${change.key}`.slice(0, 200);
}

function base(change: RawIssueChange): Pick<IssueEvent, "correlation_id" | "subject"> & {
  payload: Record<string, unknown>;
} {
  return {
    correlation_id: correlationId(change),
    subject: change.key.slice(0, 500),
    payload: {
      tracker: change.tracker,
      key: change.key,
      title: change.title,
      url: change.url,
      status: change.status,
      category: change.category,
    },
  };
}

const OPEN: Record<IssueCategory, boolean> = {
  open: true,
  in_progress: true,
  done: false,
  cancelled: false,
};

/**
 * Events for one issue.
 *
 * - Only issues assigned to the user are remembered, so an issue the user has never held
 *   produces nothing.
 * - An unknown issue now assigned to the user is `issues.assigned`, unless it is already
 *   closed (an old assignment that merely changed; nothing for the user to act on).
 * - A remembered issue now assigned to someone else is `issues.unassigned`.
 * - A remembered issue whose status name changed is `issues.status_changed`; moving to done
 *   also yields an ephemeral `issues.completed`, which drives Fawkes without a second entry
 *   in the activity feed.
 * - A report that is not newer than what is remembered (the same `updatedAt` again, or an
 *   older one) is ignored, which de-duplicates the overlap between consecutive polls.
 */
export function diffIssue(prev: IssueSnapshot | undefined, next: RawIssueChange): IssueEvent[] {
  if (prev === undefined) {
    if (!next.assignedToMe || !OPEN[next.category]) return [];
    return [{ event_type: "issues.assigned", severity: "info", ephemeral: false, ...base(next) }];
  }
  if (next.updatedAt <= prev.updatedAt) return [];
  if (!next.assignedToMe) {
    return [{ event_type: "issues.unassigned", severity: "info", ephemeral: false, ...base(next) }];
  }
  if (next.status === prev.status && next.category === prev.category) return [];
  const { payload, ...envelope } = base(next);
  const done = next.category === "done" && prev.category !== "done";
  const events: IssueEvent[] = [
    {
      event_type: "issues.status_changed",
      severity: done ? "success" : "info",
      ephemeral: false,
      ...envelope,
      payload: {
        ...payload,
        from: prev.category,
        to: next.category,
        from_status: prev.status,
        to_status: next.status,
      },
    },
  ];
  if (done) {
    events.push({
      event_type: "issues.completed",
      severity: "success",
      ephemeral: true,
      ...envelope,
      payload,
    });
  }
  return events;
}

/** The next snapshot for an issue, or undefined when it should no longer be remembered. */
export function nextSnapshot(
  prev: IssueSnapshot | undefined,
  next: RawIssueChange,
): IssueSnapshot | undefined {
  if (prev !== undefined && next.updatedAt <= prev.updatedAt) return prev;
  return next.assignedToMe ? snapshotOf(next) : undefined;
}

/** Snapshots kept per tracker; finished issues are dropped first when the limit is hit. */
export const MAX_SNAPSHOTS = 5000;

/**
 * Applies a batch of changes in `updatedAt` order, updating `snapshots` and returning the
 * events. This is what a normal poll does.
 */
export function reconcile(
  snapshots: Map<string, IssueSnapshot>,
  changes: readonly RawIssueChange[],
): IssueEvent[] {
  const events: IssueEvent[] = [];
  const ordered = [...changes].sort(
    (a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0),
  );
  for (const change of ordered) {
    const prev = snapshots.get(change.key);
    events.push(...diffIssue(prev, change));
    const next = nextSnapshot(prev, change);
    if (next === undefined) snapshots.delete(change.key);
    else snapshots.set(change.key, next);
  }
  if (snapshots.size > MAX_SNAPSHOTS) {
    for (const [key, snap] of snapshots) {
      if (!OPEN[snap.category]) snapshots.delete(key);
    }
    // Still over the limit: forget the oldest-seen entries (Map keeps insertion order).
    for (const key of snapshots.keys()) {
      if (snapshots.size <= MAX_SNAPSHOTS) break;
      snapshots.delete(key);
    }
  }
  return events;
}

/** First poll: remember what is already assigned to the user, say nothing about it. */
export function baseline(
  snapshots: Map<string, IssueSnapshot>,
  changes: readonly RawIssueChange[],
): void {
  snapshots.clear();
  for (const change of changes) {
    if (change.assignedToMe) snapshots.set(change.key, snapshotOf(change));
  }
}
