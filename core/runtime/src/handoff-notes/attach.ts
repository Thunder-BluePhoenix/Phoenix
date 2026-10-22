// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What an attached handoff note looks like at each destination (Phase 79), and the hash a
// confirmation is bound to. Pure. The text comes from the stored, already-redacted note and is
// checked for secrets once more before it can be previewed.
import { createHash } from "node:crypto";
import type { HandoffNoteView, HandoffTarget } from "@phoenix/api";
import { secretPaths } from "@phoenix/capability-agents";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { renderNote } from "./generate";

export const HANDOFF_TARGETS: readonly HandoffTarget[] = [
  "commit_message",
  "pr_description",
  "task",
];
export const MAX_ISSUE_TITLE = 256;
export const MAX_ISSUE_BODY = 10_000;
const SUBJECT_MAX = 72;

/** "owner/name", the same shape the github capability accepts. */
export const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A commit message: a subject, a blank line, plain-text facts. No Markdown, no model text. */
export function commitMessage(note: HandoffNoteView): string {
  const subject = clip(note.goal ?? `Changes by ${note.agent} in ${note.project}`, SUBJECT_MAX);
  const body: string[] = [
    "Agent handoff (from what the agent reported; written by Phoenix):",
    `Agent: ${note.agent}`,
    `Files: ${note.files_total}, +${note.added} -${note.removed} lines`,
  ];
  for (const f of note.files.slice(0, 15)) body.push(`  ${f.path} (+${f.added} -${f.removed})`);
  if (note.files_total > 15) body.push(`  and ${note.files_total - 15} more`);
  if (note.open_questions.length > 0) {
    body.push("Open questions:");
    for (const q of note.open_questions) body.push(`  ${q}`);
  }
  return `${subject}\n\n${body.join("\n")}\n`;
}

export function issueTitle(note: HandoffNoteView): string {
  return clip(`Agent handoff: ${note.project} (${note.agent})`, MAX_ISSUE_TITLE);
}

export function attachText(note: HandoffNoteView, target: HandoffTarget): string {
  if (target === "commit_message") return commitMessage(note);
  const markdown = renderNote(note);
  return target === "task" ? clip(markdown, MAX_ISSUE_BODY) : markdown;
}

/** The idempotency key of an issue made from a note: the same note never makes two issues. */
export const issueKey = (noteId: string): string => `handoff-${noteId}`;

/** Refuses text that still holds a secret, naming only JSON paths. */
export function assertNoSecret(text: string, title: string | undefined): void {
  const found = secretPaths({ text, ...(title === undefined ? {} : { title }) });
  if (found.length > 0) {
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      "The note still looks like it holds a secret, so it was not attached",
      found,
    );
  }
}

/** Binds a confirmation to exactly what was previewed. */
export function attachHash(parts: {
  noteId: string;
  target: HandoffTarget;
  repository: string | undefined;
  title: string | undefined;
  text: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        parts.noteId,
        parts.target,
        parts.repository ?? "",
        parts.title ?? "",
        parts.text,
      ]),
    )
    .digest("hex");
}
