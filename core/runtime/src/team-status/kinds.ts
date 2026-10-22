// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * The only states a Phoenix install can share with teammates. The list is closed on purpose: a
 * shared item carries a kind and a start time and nothing else, so no repository, branch, agent
 * prompt, meeting title or attendee can travel with it.
 */
export const TEAM_ITEM_KINDS = ["deploying", "agent_run", "meeting"] as const;
export type TeamItemKind = (typeof TEAM_ITEM_KINDS)[number];

export interface TeamItem {
  kind: TeamItemKind;
  /** Epoch milliseconds, rounded down to the minute. */
  since: number;
}

export type TeamConsent = Record<TeamItemKind, boolean>;

export const NO_CONSENT: Readonly<TeamConsent> = Object.freeze({
  deploying: false,
  agent_run: false,
  meeting: false,
});

export function isTeamItemKind(value: unknown): value is TeamItemKind {
  return typeof value === "string" && (TEAM_ITEM_KINDS as readonly string[]).includes(value);
}

export interface TeamClock {
  now(): number;
}

/** Control, line-separator, bidi and zero-width characters: never accepted in a displayed string. */
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

/** True for a string of 1..max characters with nothing that could reorder, hide or break a line. */
export function isSafeText(value: unknown, max: number, min = 1): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    !UNSAFE_TEXT.test(value)
  );
}

export function minuteFloor(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}
