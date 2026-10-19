// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What Fawkes says about a tool's output. The output comes from a capability and may hold text
// written by third parties, so it is DATA: only strings (clipped, control characters removed),
// numbers and array lengths are read, and the sentence around them is fixed here. Nothing in the
// output can add a clause, a link or an instruction to what is spoken.

export const MAX_REPLY_CHARS = 300;
const MAX_FIELD_CHARS = 40;
const MAX_ITEMS = 3;

/** One line of plain text: control characters become spaces, then clipped with an ellipsis. */
export function clipSpeech(text: string, max: number): string {
  const flat = text
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function field(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? clipSpeech(value, MAX_FIELD_CHARS)
    : null;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function repositories(output: Record<string, unknown>): string | null {
  const list = output.repositories;
  if (!Array.isArray(list)) return null;
  if (list.length === 0) return "No repositories are being watched.";
  const parts: string[] = [];
  for (const item of list.slice(0, MAX_ITEMS)) {
    if (typeof item !== "object" || item === null) continue;
    const repo = item as Record<string, unknown>;
    const name = field(repo.name) ?? "A repository";
    if (typeof repo.error === "string") {
      parts.push(`${name} could not be read`);
      continue;
    }
    const branch = field(repo.branch);
    const changed = typeof repo.changed === "number" ? repo.changed : 0;
    const conflicts = Array.isArray(repo.conflicts) ? repo.conflicts.length : 0;
    parts.push(
      `${name} is ${branch ? `on ${branch}` : "on no branch"} with ${
        changed === 0 ? "no changes" : plural(changed, "change")
      }${conflicts > 0 ? ` and ${plural(conflicts, "conflict")}` : ""}`,
    );
  }
  const more = list.length > MAX_ITEMS ? `, and ${list.length - MAX_ITEMS} more` : "";
  return `${parts.join("; ")}${more}.`;
}

function nowPlaying(output: Record<string, unknown>): string | null {
  const title = field(output.title) ?? field(output.name) ?? field(output.track);
  if (!title) return "Nothing is playing.";
  const artist = field(output.artist);
  return artist ? `Playing ${title} by ${artist}.` : `Playing ${title}.`;
}

/** A short fixed-shape sentence for `tool`'s output. Never longer than MAX_REPLY_CHARS. */
export function summariseToolOutput(tool: string, output: unknown): string {
  const record =
    typeof output === "object" && output !== null && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : null;
  let text: string | null = null;
  if (record) {
    if (tool.endsWith(".now_playing")) text = nowPlaying(record);
    else if (tool === "git.status") text = repositories(record);
    else {
      const counts = Object.entries(record)
        .filter(([, v]) => Array.isArray(v))
        .slice(0, MAX_ITEMS)
        .map(([key, v]) => `${plural((v as unknown[]).length, "item")} in ${clipSpeech(key, 24)}`);
      if (counts.length > 0) text = `${counts.join(", ")}.`;
    }
  }
  return clipSpeech(text ?? `I checked ${clipSpeech(tool, 60)}.`, MAX_REPLY_CHARS);
}
