// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Read-only acceptance counts for the evaluation harness (Phase 33), derived from what the user
// actually decided in Core: Phase 35 review decisions on `meeting_items` and the resolved
// agent-approval records in the audit log. Counts only: the queries select kind, status and
// outcome and a COUNT, never a text, command, path, owner or id column, so there is nothing to leak.
import { acceptanceFromReviews } from "@phoenix/ai-evaluation";
import type { Database } from "@phoenix/persistence";

/** What a user did with items of one kind. `expired` = nobody answered before the request timed out. */
export interface DecisionCounts {
  accepted: number;
  rejected: number;
  expired: number;
}

export const REVIEW_KINDS = [
  "decision",
  "action_item",
  "requirement",
  "topic",
  "project_ref",
] as const;
export const APPROVAL_KINDS = ["permission", "question"] as const;

export interface AcceptanceCounts {
  /**
   * Meeting-item review decisions per kind. `accepted` includes items the user edited before
   * accepting; items still `proposed` are not decisions and are not counted. A meeting item has no
   * expiry, so `expired` is always 0 here.
   */
  reviews: Record<(typeof REVIEW_KINDS)[number], DecisionCounts>;
  /**
   * Resolved agent approvals per kind: allow = accepted, deny and terminal deny = rejected,
   * timed out unanswered = expired. System cancellations (shutdown, kill switch, rate limit) are
   * not user decisions and are not counted.
   */
  approvals: Record<(typeof APPROVAL_KINDS)[number], DecisionCounts>;
  /** `acceptanceFromReviews` over the counts above; null when nothing was decided. */
  acceptance: { reviews: number | null; approvals: number | null };
}

const zero = (): DecisionCounts => ({ accepted: 0, rejected: 0, expired: 0 });

/** Expands counts into the status list `acceptanceFromReviews` takes (expired counts as not accepted). */
function rateOf(groups: Iterable<DecisionCounts>): number | null {
  const statuses: string[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.accepted; i++) statuses.push("accepted");
    for (let i = 0; i < g.rejected; i++) statuses.push("rejected");
    for (let i = 0; i < g.expired; i++) statuses.push("expired");
  }
  return acceptanceFromReviews(statuses);
}

export class EvaluationRuntime {
  constructor(private readonly db: Database) {}

  acceptance(): AcceptanceCounts {
    const reviews = Object.fromEntries(
      REVIEW_KINDS.map((k) => [k, zero()]),
    ) as AcceptanceCounts["reviews"];
    const approvals = Object.fromEntries(
      APPROVAL_KINDS.map((k) => [k, zero()]),
    ) as AcceptanceCounts["approvals"];

    const items = this.db
      .prepare(
        "SELECT kind, status, COUNT(*) AS n FROM meeting_items WHERE status <> 'proposed' GROUP BY kind, status",
      )
      .all() as unknown as { kind: string; status: string; n: number }[];
    for (const r of items) {
      const bucket = (reviews as Record<string, DecisionCounts | undefined>)[r.kind];
      if (!bucket) continue;
      if (r.status === "accepted" || r.status === "edited") bucket.accepted += r.n;
      else if (r.status === "rejected") bucket.rejected += r.n;
    }

    const resolved = this.db
      .prepare(
        `SELECT json_extract(details, '$.kind') AS kind, json_extract(details, '$.outcome') AS outcome,
                COUNT(*) AS n
           FROM audit_log
          WHERE action = 'agent_approval.resolved' AND json_valid(details)
          GROUP BY kind, outcome`,
      )
      .all() as unknown as { kind: string | null; outcome: string | null; n: number }[];
    for (const r of resolved) {
      const bucket = (approvals as Record<string, DecisionCounts | undefined>)[r.kind ?? ""];
      if (!bucket) continue;
      if (r.outcome === "allow") bucket.accepted += r.n;
      else if (r.outcome === "deny" || r.outcome === "terminal") bucket.rejected += r.n;
      else if (r.outcome === "expired") bucket.expired += r.n;
    }

    return {
      reviews,
      approvals,
      acceptance: {
        reviews: rateOf(Object.values(reviews)),
        approvals: rateOf(Object.values(approvals)),
      },
    };
  }
}
