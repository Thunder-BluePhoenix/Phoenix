// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A size cap applied BEFORE `redactSecrets`: the redactor is a set of regular expressions, and the
// text it sees (a diff of a file an agent wrote, a model's reply) is not trusted to be a sensible
// size. Shared by the rollback preview and the handoff summary.

/** Characters of git's diff output, and of any one line of it, that reach the redactor. */
export const DIFF_REDACT_CHARS = 250_000;
export const DIFF_REDACT_LINE = 2_000;

/**
 * `text` cut to `DIFF_REDACT_CHARS` and every line to `DIFF_REDACT_LINE` BEFORE the redactor runs,
 * so an attacker-sized line (a repository file the agent wrote) cannot make masking expensive.
 * A cut line ends in `…`; `cut` says anything was removed.
 */
export function capForRedaction(text: string): { text: string; cut: boolean } {
  const head = text.length > DIFF_REDACT_CHARS ? text.slice(0, DIFF_REDACT_CHARS) : text;
  let cut = head.length < text.length;
  const lines = head.split("\n").map((line) => {
    if (line.length <= DIFF_REDACT_LINE) return line;
    cut = true;
    return `${line.slice(0, DIFF_REDACT_LINE)}…`;
  });
  return { text: lines.join("\n"), cut };
}
