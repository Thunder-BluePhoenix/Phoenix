// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Provider-independent status buckets; the tracker's own status name travels alongside. */
export type IssueCategory = "open" | "in_progress" | "done" | "cancelled";

/**
 * One issue as a tracker reports it right now, validated and normalised.
 * `updatedAt` is the tracker's own timestamp (ISO 8601, UTC), never local time.
 */
export interface RawIssueChange {
  /** Provider id: github, linear or jira. */
  tracker: string;
  /** Human key: `owner/repo#12`, `ENG-123`, `PROJ-45`. */
  key: string;
  title: string;
  url: string;
  /** The tracker's own status name, e.g. "In Review". */
  status: string;
  category: IssueCategory;
  assignedToMe: boolean;
  updatedAt: string;
  /** Provider-specific handle for re-querying this issue (Linear id, Jira key). */
  ref: string;
}

export interface IssueProvider {
  readonly id: string;
  /**
   * Issues that changed since `since` (an ISO timestamp taken from this tracker's own
   * `updatedAt` values). With `since` undefined it returns the user's open assigned issues
   * (the baseline). `tracked` holds the `ref`s of issues currently assigned to the user: the
   * tracker re-reports those too when they changed, so an issue just unassigned from the user
   * (which no longer matches an "assigned to me" query) is still seen. Throws TrackerError;
   * only validated data is ever returned.
   */
  poll(
    since: string | undefined,
    signal: AbortSignal,
    tracked: readonly string[],
  ): Promise<RawIssueChange[]>;
  /** The tracker's clock (HTTP Date header) as of the last response; seeds an empty baseline. */
  serverTime(): string | undefined;
  /** A non-fatal caveat about the last poll (truncated results, unauthenticated limits). */
  note(): string | undefined;
}

export type TrackerErrorKind =
  "config" | "auth" | "rate_limit" | "unavailable" | "invalid_response";

/** A provider failure whose message is safe to show and log (it never holds credentials). */
export class TrackerError extends Error {
  constructor(
    readonly kind: TrackerErrorKind,
    message: string,
    /** For rate limits: how long the tracker asked us to wait, from the tracker's own clock. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export type SecretReader = (name: string) => Promise<string | undefined>;

/** Request limits shared by the providers. */
export interface HttpLimits {
  timeoutMs: number;
  maxBytes: number;
}

/** An event ready for `ctx.emit`. */
export interface IssueEvent {
  event_type: string;
  severity: "info" | "success";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
  /** Reaches live subscribers (Fawkes) without being stored in the activity feed. */
  ephemeral: boolean;
}
