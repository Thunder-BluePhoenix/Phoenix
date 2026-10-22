// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { freezeAt, type CalendarEvent } from "@phoenix/capability-calendar";

/** A feed older than this is treated as unavailable. */
export const FREEZE_FEED_MAX_AGE_MS = 5 * 60_000;

export interface FreezeSnapshot {
  /** Epoch ms of the feed read this snapshot came from. Freshness is checked at execution time. */
  checkedAt: number;
  events?: readonly CalendarEvent[];
  /** The user turned calendar deploy freezes on. Without it there is no hold. */
  enabled: boolean;
}

/**
 * Call immediately before every deployment side effect, with a snapshot read for this call.
 * Calendar freeze not enabled (or no snapshot at all): deployment is allowed. Enabled but the feed
 * is missing, stale, from the future or unreadable: blocked. A freeze window is half-open,
 * [start, end), so a deploy exactly at its end is allowed.
 */
export function assertDeployAllowed(snapshot: FreezeSnapshot | undefined, now: number): void {
  if (!snapshot?.enabled) return;
  const age = now - snapshot.checkedAt;
  if (
    !Number.isFinite(snapshot.checkedAt) ||
    !Number.isFinite(now) ||
    !snapshot.events ||
    age < 0 ||
    age > FREEZE_FEED_MAX_AGE_MS
  )
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      "Deployment blocked: calendar freeze feed is unavailable or stale",
    );
  const malformed = snapshot.events.some(
    (event) =>
      event.deployFreeze &&
      !event.cancelled &&
      !event.private &&
      !(Date.parse(event.start) < Date.parse(event.end)),
  );
  if (malformed)
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      "Deployment blocked: calendar freeze feed is unreadable",
    );
  const blocked = freezeAt(snapshot.events, now);
  if (blocked)
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      `Deployment blocked by calendar freeze until ${blocked.end}`,
    );
}
