// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Handoff notes (Phase 79), the pure half: turns what an agent REPORTED about a session into a
// note. No model, no clock, no I/O: the same input always gives the same note.
//
// Where each part comes from (and what it is not):
//   goal            the task title the agent reported, which exists only when the user turned on
//                   `include_prompt_title` for the agents capability; otherwise "unknown".
//   what changed    per-file counts Core summed from the agent's Edit/Write steps (FileTallies).
//                   Reported by the agent's hook, never checked against git.
//   commands run    the `run` steps (Bash and the like): already cut and redacted by the hook and
//                   again by Core; here they are redacted a third time and secret-scanned.
//   open questions  approval requests still waiting for the user, and requests of this session
//                   that were denied or never answered (Phase 56 history).
// Everything that came from the agent is untrusted DATA: it is flattened to one line, redacted,
// bounded, and rendered into Markdown as text or as a code span that cannot be closed from inside.
import { basename, isAbsolute, relative } from "node:path";
import type {
  AgentApprovalHistoryRow,
  AgentApprovalPendingView,
  HandoffFileView,
  HandoffNoteDetailView,
  HandoffNoteView,
  LiveSessionDetailView,
} from "@phoenix/api";
import { mdCode, mdText, redactSecrets, scanText } from "@phoenix/capability-agents";

export const MAX_NOTE_FILES = 30;
export const MAX_NOTE_COMMANDS = 30;
export const MAX_NOTE_QUESTIONS = 10;
export const MAX_FIELD = 200;
export const MAX_GOAL = 120;
/** Slack around a session's first/last report when matching its approval history. */
const HISTORY_SLACK_MS = 2 * 60_000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * One line of agent-supplied text made safe to keep: control and bidi characters flattened,
 * secrets redacted, and a line the detector still flags replaced outright. Cut to `max`.
 */
export function cleanLine(raw: string, max = MAX_FIELD): string {
  const flat = raw.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim();
  const redacted = redactSecrets(flat);
  const text = scanText(redacted, "x").length > 0 ? "[line hidden: looks like a secret]" : redacted;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What a note is built from. Every field is data Core already holds in memory. */
export interface NoteInput {
  agent: string;
  sessionId: string;
  /** Absolute project path (used to shorten file paths; never stored). */
  project: string;
  trigger: "auto" | "user";
  /** The reported task title, if any. */
  goal: string | undefined;
  detail: Pick<LiveSessionDetailView, "steps" | "files" | "dropped_steps">;
  stepsTotal: number;
  firstSeenMs: number;
  lastSeenMs: number;
  pending: readonly AgentApprovalPendingView[];
  history: readonly AgentApprovalHistoryRow[];
}

const OUTCOME_TEXT: Record<string, string> = {
  deny: "was denied",
  terminal: "was answered in the terminal (Phoenix did not see the answer)",
  expired: "timed out without an answer",
  cancelled: "was cancelled",
};

function fileView(project: string, f: LiveSessionDetailView["files"][number]): HandoffFileView {
  const rel = isAbsolute(f.path) ? relative(project, f.path) : f.path;
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return {
    path: cleanLine(inside ? rel : basename(f.path)),
    added: f.added,
    removed: f.removed,
    edits: f.edits,
  };
}

/** The structured note (no id, no time: the caller adds them). */
export type NoteBody = Omit<HandoffNoteView, "id" | "created_at" | "summary" | "generated_by">;

export function buildNote(input: NoteInput): NoteBody {
  const files = [...input.detail.files]
    // Most edited first, then by path, so the same input always lists the same files.
    .sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path))
    .map((f) => fileView(input.project, f));
  const runs = input.detail.steps.filter((s) => s.kind === "run" && s.target !== "");
  const commands: string[] = [];
  for (const run of runs) {
    const line = cleanLine(run.target);
    if (line !== "" && commands[commands.length - 1] !== line) commands.push(line);
  }
  const questions: string[] = [];
  for (const p of input.pending) {
    if (p.agent !== input.agent || p.project !== input.project) continue;
    const asked =
      p.kind === "question" && p.questions?.[0]
        ? `Asked: ${p.questions[0].question}`
        : `Waiting for you: ${p.tool}${p.input_summary.command ? ` ${p.input_summary.command}` : p.input_summary.path ? ` ${p.input_summary.path}` : ""}`;
    questions.push(cleanLine(asked));
  }
  const from = input.firstSeenMs - HISTORY_SLACK_MS;
  const to = input.lastSeenMs + HISTORY_SLACK_MS;
  for (const row of input.history) {
    const at = Date.parse(row.at);
    const text = Object.hasOwn(OUTCOME_TEXT, row.outcome) ? OUTCOME_TEXT[row.outcome] : undefined;
    if (row.agent !== input.agent || row.project !== input.project) continue;
    if (!text || Number.isNaN(at) || at < from || at > to) continue;
    questions.push(cleanLine(`${row.tool}${row.command ? ` ${row.command}` : ""} ${text}`));
  }
  const goal = input.goal ? cleanLine(input.goal, MAX_GOAL) : "";
  return {
    agent: cleanLine(input.agent, 40),
    session_id: cleanLine(input.sessionId, 100),
    project: cleanLine(basename(input.project) || "(project)", 100),
    trigger: input.trigger,
    goal: goal === "" ? null : goal,
    files: files.slice(0, MAX_NOTE_FILES),
    files_total: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    commands: commands.slice(-MAX_NOTE_COMMANDS),
    commands_total: commands.length,
    open_questions: [...new Set(questions)].slice(0, MAX_NOTE_QUESTIONS),
    steps_total: input.stepsTotal,
    dropped_steps: input.detail.dropped_steps,
  };
}

/** The Markdown of a note: the deterministic body, then the model summary if one was added. */
export function renderNote(note: HandoffNoteView): string {
  const lines: string[] = [
    `# Agent handoff: ${mdText(note.project)}`,
    "",
    `Agent ${mdText(note.agent)}, session ${mdCode(note.session_id)}, written ${note.created_at}.`,
    "Built by Phoenix from what the agent reported; not checked against the repository.",
    "",
    "## Goal",
    note.goal === null ? "Unknown (the agent did not report a task title)." : mdText(note.goal),
    "",
    "## What changed",
  ];
  if (note.files.length === 0) lines.push("No file changes were reported.");
  else {
    lines.push(`${note.files_total} file(s), +${note.added} -${note.removed} lines (as reported).`);
    for (const f of note.files)
      lines.push(`- ${mdCode(f.path)} +${f.added} -${f.removed}, ${f.edits} edit(s)`);
    if (note.files_total > note.files.length)
      lines.push(`- and ${note.files_total - note.files.length} more`);
  }
  lines.push("", "## Commands run");
  if (note.commands.length === 0) lines.push("No commands were reported.");
  else {
    for (const c of note.commands) lines.push(`- ${mdCode(c)}`);
    if (note.commands_total > note.commands.length)
      lines.push(`- ${note.commands_total - note.commands.length} earlier command(s) not listed`);
  }
  lines.push("", "## Open questions");
  if (note.open_questions.length === 0) lines.push("None recorded.");
  else for (const q of note.open_questions) lines.push(`- ${mdText(q)}`);
  if (note.dropped_steps > 0)
    lines.push(
      "",
      `${note.dropped_steps} older step(s) were no longer held when this was written.`,
    );
  if (note.summary) {
    lines.push(
      "",
      `## Summary (written by ${mdText(note.summary.processed_by)}; may be wrong)`,
      mdText(note.summary.text),
    );
  }
  return `${lines.join("\n")}\n`;
}

export const withText = (note: HandoffNoteView): HandoffNoteDetailView => ({
  ...note,
  text: renderNote(note),
});
