// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 session timeline export (Markdown). Every string that came from an agent, a path, a
// command or a link is untrusted: it is never allowed to become Markdown or HTML structure.
//  - Free text: control and bidi characters become spaces, newlines are flattened, and EVERY ASCII
//    punctuation character is backslash-escaped (valid CommonMark), so no emphasis, heading, list,
//    table, link, image, autolink or raw HTML can be formed.
//  - Commands and paths go in an inline code span whose backtick fence is longer than any backtick
//    run inside, so the text cannot close it.
// What is exported is what Phoenix already keeps: steps (path/command, never output or contents),
// per-file counts, links, and the session's own timeline.
import type { FileTally } from "./diffs";
import type { DiffLink } from "./diffs";
import type { LoggedStep } from "./steps";

// eslint-disable-next-line no-control-regex
const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
const PUNCTUATION = /[!-/:-@[-`{-~]/g;
const MAX_FIELD = 300;

/** Plain text that renders as itself. */
export function mdText(value: unknown): string {
  const text = String(value ?? "")
    .slice(0, MAX_FIELD * 2)
    .replace(CONTROL, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  const cut = text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;
  return cut.replace(PUNCTUATION, (c) => `\\${c}`);
}

/** An inline code span that cannot be closed from inside. */
export function mdCode(value: unknown): string {
  const text = String(value ?? "")
    .slice(0, MAX_FIELD * 2)
    .replace(CONTROL, " ")
    .trim();
  const cut = text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;
  if (cut === "") return "(none)";
  const longest = Math.max(0, ...(cut.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence} ${cut} ${fence}`;
}

export interface ExportSession {
  id: string;
  /** Orchestrated session facts, when the session is one Phoenix started. */
  session?: {
    launcher: string;
    workspace: string;
    state: string;
    started_at: string;
    ended_at?: string;
  };
  live: { agent: string; project: string; first_seen: string; last_seen: string }[];
  timeline: { at: string; kind: string; detail?: Record<string, unknown> }[];
  steps: (LoggedStep & { session_id: string })[];
  dropped_steps: number;
  files: FileTally[];
  commits: DiffLink[];
  ci_runs: DiffLink[];
}

const KIND_LABEL: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  run: "Run",
  other: "Other",
};

function linkLines(title: string, links: readonly DiffLink[]): string[] {
  if (links.length === 0) return [];
  return [
    `## ${title}`,
    "",
    ...links.map(
      (l) =>
        `- ${mdCode(l.ref)} in ${mdText(l.repo)} (${mdText(l.confidence)}${
          l.conclusion ? `, ${mdText(l.conclusion)}` : ""
        })`,
    ),
    "",
  ];
}

/** The Markdown document. Always ends with a newline. */
export function exportMarkdown(input: ExportSession): string {
  const out: string[] = [`# Agent session ${mdText(input.id)}`, ""];
  const s = input.session;
  if (s) {
    out.push(
      `- Launcher: ${mdText(s.launcher)}`,
      `- Workspace: ${mdCode(s.workspace)}`,
      `- State: ${mdText(s.state)}`,
      `- Started: ${mdText(s.started_at)}`,
      ...(s.ended_at ? [`- Ended: ${mdText(s.ended_at)}`] : []),
      "",
    );
  }
  for (const l of input.live) {
    out.push(
      `- Agent ${mdText(l.agent)} in ${mdCode(l.project)}, seen ${mdText(l.first_seen)} to ${mdText(l.last_seen)}`,
    );
  }
  if (input.live.length > 0) out.push("");

  out.push("## Timeline", "");
  if (input.timeline.length === 0) out.push("Nothing recorded.", "");
  else {
    for (const t of input.timeline) {
      const detail = t.detail
        ? ` (${Object.entries(t.detail)
            .slice(0, 8)
            .map(([k, v]) => `${mdText(k)}: ${mdText(v)}`)
            .join(", ")})`
        : "";
      out.push(`- ${mdText(t.at)} ${mdText(t.kind)}${detail}`);
    }
    out.push("");
  }

  out.push("## Steps", "");
  if (input.dropped_steps > 0) {
    out.push(
      `${input.dropped_steps} older step\\(s\\) were dropped; only the most recent are kept\\.`,
      "",
    );
  }
  if (input.steps.length === 0) out.push("No steps recorded.", "");
  else {
    for (const step of input.steps) {
      out.push(
        `1. ${mdText(step.at)} ${KIND_LABEL[step.kind] ?? "Other"} ${mdText(step.tool)} ${mdCode(step.target)}`,
      );
    }
    out.push("");
  }

  out.push("## Files changed", "");
  if (input.files.length === 0) out.push("No file changes recorded.", "");
  else {
    for (const f of input.files) {
      out.push(`- ${mdCode(f.path)} +${f.added} \\-${f.removed} (${f.edits} edit\\(s\\))`);
    }
    out.push("");
  }

  out.push(...linkLines("Commits seen during the session", input.commits));
  out.push(...linkLines("CI runs seen during the session", input.ci_runs));
  out.push(
    "*These were linked because they happened while the session was active; that does not prove the agent made them\\.*",
    "",
  );
  return out.join("\n");
}
