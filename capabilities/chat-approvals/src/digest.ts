// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The scheduled approvals digest (Phase 86). A digest is an UNSOLICITED outbound message, so what it
// may say is narrower than a card: counts, a few short approval ids and short action (tool) names, and
// nothing else. Never a title, request body, path, command, project name, secret or agent output.
// This file is pure: the schedule decision and the text. Sending, secrets and audit stay in index.ts.
import { sanitizeText } from "./cards";
import type { ApprovalSnapshot } from "./types";

export const MIN_DIGEST_INTERVAL_MINUTES = 60;
export const MAX_DIGEST_INTERVAL_MINUTES = 7 * 24 * 60;
export const DEFAULT_DIGEST_INTERVAL_MINUTES = 24 * 60;
export const MAX_DIGEST_CHARS = 600;
/** Pending approvals named (by short id and action) in one digest; the rest are only counted. */
export const MAX_DIGEST_LISTED = 5;
const ID_CHARS = 12;
const ACTION_CHARS = 32;
const COUNT_CAP = 9_999;

export interface QuietHours {
  timezone: string;
  start: string;
  end: string;
}

/** The owner's opt-in. Default OFF; the interval never goes below one hour. */
export interface DigestSchedule {
  enabled: boolean;
  intervalMs: number;
  quietHours: QuietHours | null;
}

export const OFF_SCHEDULE: DigestSchedule = {
  enabled: false,
  intervalMs: DEFAULT_DIGEST_INTERVAL_MINUTES * 60_000,
  quietHours: null,
};

/** Decisions Core saw since the last digest, by outcome. Counts only. */
export interface DigestActivity {
  approved: number;
  denied: number;
  expired: number;
  other: number;
}

export const emptyActivity = (): DigestActivity => ({
  approved: 0,
  denied: 0,
  expired: 0,
  other: 0,
});

export const decidedTotal = (a: DigestActivity): number =>
  a.approved + a.denied + a.expired + a.other;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (time: string): number => {
  if (!HHMM.test(time)) throw new Error("Invalid quiet hours");
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
};

/**
 * Is `now` inside the quiet window (it may cross midnight; equal start and end is no window)? A
 * malformed time or an unknown time zone counts as quiet: a digest that cannot prove it is outside
 * quiet hours is not sent.
 */
export function quietNow(now: number, hours: QuietHours | null): boolean {
  if (hours === null) return false;
  try {
    const start = minutesOf(hours.start);
    const end = minutesOf(hours.end);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: hours.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const local =
      Number(parts.find((p) => p.type === "hour")?.value) * 60 +
      Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(local)) return true;
    if (start === end) return false;
    return start < end ? local >= start && local < end : local >= start || local < end;
  } catch {
    return true;
  }
}

export type DigestSkip = "off" | "no_destination" | "not_due" | "quiet" | "idle";

export interface VerdictInput {
  schedule: DigestSchedule;
  now: number;
  /** When the last digest was attempted (or the baseline the schedule started from). */
  lastAt: number | undefined;
  /** Some provider has its `digest` switch on and can be reached. */
  hasDestination: boolean;
  /** Anything decided since the last digest, or a pending request not named in the last one. */
  hasNews: boolean;
}

/**
 * Whether a digest goes out now. At most one per interval (the caller records the attempt time),
 * never in quiet hours (it waits for the next check), never when nothing happened.
 */
export function digestVerdict(i: VerdictInput): "send" | DigestSkip {
  if (!i.schedule.enabled) return "off";
  if (!i.hasDestination) return "no_destination";
  if (i.lastAt === undefined || i.now - i.lastAt < i.schedule.intervalMs) return "not_due";
  if (quietNow(i.now, i.schedule.quietHours)) return "quiet";
  if (!i.hasNews) return "idle";
  return "send";
}

const count = (n: number): string =>
  n > COUNT_CAP ? `${COUNT_CAP}+` : String(Math.max(0, Math.trunc(n) || 0));

/**
 * A short id: letters, digits, underscore and hyphen only, clipped. The same allow-list is used for
 * action (tool) names, so no URL, mention, markup or hidden character can ride along in a digest.
 */
export const shortId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, ID_CHARS);

export interface FormatDigestInput {
  pending: readonly ApprovalSnapshot[];
  /** Requests whose project is switched on for chat; the others are counted but never named. */
  allowed: (snapshot: ApprovalSnapshot) => boolean;
  activity: DigestActivity;
}

/**
 * One bounded, single-line message with control and hidden characters removed. It names at most
 * {@link MAX_DIGEST_LISTED} pending approvals, only those switched on for chat, by short id and
 * action name.
 */
export function formatDigest({ pending, allowed, activity }: FormatDigestInput): string {
  const listed = pending.filter(allowed).slice(0, MAX_DIGEST_LISTED);
  const decided = decidedTotal(activity);
  let text = `Phoenix approvals digest: ${count(pending.length)} waiting, ${count(decided)} decided since the last digest`;
  if (decided > 0) {
    const parts = [
      `${count(activity.approved)} allowed`,
      `${count(activity.denied)} denied`,
      `${count(activity.expired)} expired`,
    ];
    if (activity.other > 0) parts.push(`${count(activity.other)} other`);
    text += ` (${parts.join(", ")})`;
  }
  text += ".";
  if (listed.length > 0) {
    text += ` Waiting: ${listed
      .map(
        (s) =>
          `${shortId(s.id)} ${
            s.tool
              .replace(/\./g, "_")
              .replace(/[^A-Za-z0-9_-]/g, "")
              .slice(0, ACTION_CHARS) || "unknown"
          }`,
      )
      .join(", ")}`;
    const rest = pending.length - listed.length;
    if (rest > 0) text += `, ${count(rest)} not listed`;
    text += ".";
  } else if (pending.length > 0) {
    text += " None are switched on for chat.";
  }
  text += " Open Phoenix to review.";
  return sanitizeText(text, MAX_DIGEST_CHARS);
}
