// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The recovery journal's on-disk format (Phase 73): one JSON object per line,
// `{"v":1,"sum":"<sha256 prefix of the record text>","rec":{...}}`. Pure functions only. A line that
// does not parse, or whose checksum does not match, is never trusted: it is counted and surfaced,
// and no action is ever derived from it. A last line without a newline is a torn append (a crash
// while writing): tolerated and flagged, not counted as corruption.
//
// helper/phoenix-awake-backstop.mjs reads the same format with its own copy of this code (it is
// installed on its own, outside the repo); test/power/backstop.test.ts keeps the two in step.
import { createHash } from "node:crypto";

export const JOURNAL_VERSION = 1;
const MAX_ID = 80;
const MAX_ERROR = 200;
const MAX_STARTED = 80;
const KIND = /^[a-z][a-z0-9_.]{0,63}$/;

/** Who wrote an entry: pid plus a process start token, so a reused pid is not mistaken for the owner. */
export interface Owner {
  pid: number;
  /** The process start time as `ps -o lstart=` prints it; "" when it could not be read. */
  started: string;
}

export type Fields = Record<string, unknown>;

export interface ChangeRecord {
  t: "change";
  id: string;
  kind: string;
  apply: Fields;
  undo: Fields;
  at: number;
  session: string | null;
  owner: Owner;
}
export interface MarkRecord {
  t: "applied" | "undone";
  id: string;
  at: number;
}
export interface UndoFailedRecord {
  t: "undo_failed";
  id: string;
  at: number;
  error: string;
}
export interface SessionEndRecord {
  t: "session_end";
  session: string;
  at: number;
}
export type JournalRecord = ChangeRecord | MarkRecord | UndoFailedRecord | SessionEndRecord;

/** A change written to the journal and not yet undone. `applied` false: the apply was never confirmed, but may have happened. */
export interface PendingEntry {
  id: string;
  kind: string;
  apply: Fields;
  undo: Fields;
  at: number;
  session: string | null;
  owner: Owner;
  applied: boolean;
}

export interface ParsedJournal {
  /** In file order. */
  pending: PendingEntry[];
  endedSessions: Set<string>;
  /** Complete lines that were unreadable or failed their checksum. Never acted on. */
  untrusted: number;
  /** The last line was cut off mid-write. */
  partialTail: boolean;
}

export function checksum(recText: string): string {
  return createHash("sha256").update(recText).digest("hex").slice(0, 32);
}

export function encodeLine(rec: JournalRecord): string {
  const body = JSON.stringify(rec);
  return `${JSON.stringify({ v: JOURNAL_VERSION, sum: checksum(body), rec })}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const idText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const epoch = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function ownerOf(v: unknown): Owner | undefined {
  if (!isObject(v)) return undefined;
  const { pid, started } = v;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return undefined;
  if (typeof started !== "string" || started.length > MAX_STARTED) return undefined;
  return { pid, started };
}

/** A record checked field by field; anything unexpected is undefined (and so untrusted). */
export function validateRecord(value: unknown): JournalRecord | undefined {
  if (!isObject(value) || !epoch(value.at)) return undefined;
  const { t, id, at } = value;
  switch (t) {
    case "change": {
      const owner = ownerOf(value.owner);
      const session = value.session;
      if (!idText(id, MAX_ID) || !idText(value.kind, 64) || !KIND.test(value.kind))
        return undefined;
      if (!isObject(value.apply) || !isObject(value.undo) || !owner) return undefined;
      if (session !== null && !idText(session, MAX_ID)) return undefined;
      return { t, id, kind: value.kind, apply: value.apply, undo: value.undo, at, session, owner };
    }
    case "applied":
    case "undone":
      return idText(id, MAX_ID) ? { t, id, at } : undefined;
    case "undo_failed":
      if (!idText(id, MAX_ID) || typeof value.error !== "string") return undefined;
      return { t, id, at, error: value.error.slice(0, MAX_ERROR) };
    case "session_end":
      return idText(value.session, MAX_ID) ? { t, session: value.session, at } : undefined;
    default:
      return undefined;
  }
}

/** One line, or undefined when it is not a well-formed, checksum-correct record. */
export function decodeLine(line: string): JournalRecord | undefined {
  let outer: unknown;
  try {
    outer = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isObject(outer) || outer.v !== JOURNAL_VERSION || typeof outer.sum !== "string")
    return undefined;
  if (checksum(JSON.stringify(outer.rec)) !== outer.sum) return undefined;
  return validateRecord(outer.rec);
}

/** Folds the journal text into what still needs undoing. Never throws. */
export function parseJournal(source: string): ParsedJournal {
  const changes = new Map<string, PendingEntry>();
  const undone = new Set<string>();
  const applied = new Set<string>();
  const endedSessions = new Set<string>();
  let untrusted = 0;
  let partialTail = false;
  const lines = source.split("\n");
  const tail = lines.pop() ?? "";
  const fold = (rec: JournalRecord): void => {
    if (rec.t === "change") {
      if (!changes.has(rec.id)) changes.set(rec.id, { ...rec, applied: false });
    } else if (rec.t === "applied") applied.add(rec.id);
    else if (rec.t === "undone") undone.add(rec.id);
    else if (rec.t === "session_end") endedSessions.add(rec.session);
  };
  for (const line of lines) {
    if (line.trim() === "") continue;
    const rec = decodeLine(line);
    if (rec) fold(rec);
    else untrusted += 1;
  }
  if (tail.trim() !== "") {
    // No trailing newline: a complete record is fine, anything else is a torn append.
    const rec = decodeLine(tail);
    if (rec) fold(rec);
    else partialTail = true;
  }
  const pending: PendingEntry[] = [];
  for (const entry of changes.values()) {
    if (!undone.has(entry.id)) pending.push({ ...entry, applied: applied.has(entry.id) });
  }
  return { pending, endedSessions, untrusted, partialTail };
}
