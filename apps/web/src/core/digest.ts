// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export type DigestSourceId = "git" | "events" | "sessions" | "meetings";
export interface DigestLine {
  text: string;
  source: {
    kind: "commit" | "session" | "meeting" | "ci" | "task";
    href: string;
    title: string;
    occurredAt: string;
    status: "done" | "planned" | "blocked";
  };
}
export interface DailyDigest {
  day: string;
  yesterday: DigestLine[];
  today: DigestLine[];
  blockers: DigestLine[];
  endOfDay: DigestLine[];
  model: "deterministic-local";
  /** Sources that could not be read; their absence is not an empty day. */
  unavailable: DigestSourceId[];
  /** Sources read only in part because a window limit was reached. */
  partial: DigestSourceId[];
  /** Sources left out because the work could not be attributed to the user. */
  unattributed: DigestSourceId[];
}

export interface DigestEventEvidence {
  id: string;
  title: string;
  kind: "commit" | "meeting" | "ci" | "task" | "session";
  status: "done" | "planned" | "blocked";
  occurredAt: string;
  verified: false;
}

export interface DigestCommitEvidence {
  sha: string;
  title: string;
  occurredAt: string;
}

export const MAX_TITLE = 200;

/** Control, line-break and invisible format (bidi, zero-width) characters never reach a pasted digest. */
export function cleanTitle(value: string): string {
  const text = value
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join("")}…` : text;
}

export interface DigestTextLabels {
  yesterday: string;
  today: string;
  blockers: string;
  endOfDay: string;
  none: string;
  /** Already-translated notices (missing, partial, unattributed sources); printed first. */
  notices: readonly string[];
}

/** Plain text export preserves a citation on every activity line and states what could not be read. */
export function digestText(digest: DailyDigest, labels: DigestTextLabels): string {
  const notices = labels.notices.map((notice) => `! ${cleanTitle(notice)}`);
  const sections = (
    [
      [labels.yesterday, digest.yesterday],
      [labels.today, digest.today],
      [labels.blockers, digest.blockers],
      [labels.endOfDay, digest.endOfDay],
    ] as const
  ).map(
    ([heading, lines]) =>
      `${heading}\n${
        lines.length
          ? lines.map((line) => `- ${cleanTitle(line.text)} (${line.source.href})`).join("\n")
          : labels.none
      }`,
  );
  return [...(notices.length ? [notices.join("\n")] : []), ...sections].join("\n\n");
}
