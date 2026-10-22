// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Where handoff notes live (Phase 79): one small JSON file per note under `<dataDir>/handoff/`,
// owner-only (directory 0700, files 0600, re-tightened on every use), never in SQLite (no new
// table exists for notes) and never anywhere else. Bounded: at most MAX_NOTES notes of at most
// MAX_NOTE_BYTES each; when a new note would exceed the count the OLDEST are deleted first. A file
// that is not a note this code wrote (wrong name, wrong shape, too big, a link) is ignored and
// never read or deleted by the retention rules.
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { HandoffNoteView } from "@phoenix/api";

export const MAX_NOTES = 50;
export const MAX_NOTE_BYTES = 64 * 1024;
export const NOTE_ID = /^hn_[0-9a-f]{24}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Shape check of a stored note: enough to refuse a hand-edited file, not a full schema. */
function asNote(raw: unknown, id: string): HandoffNoteView | null {
  if (!isObject(raw) || raw.id !== id) return null;
  const strings = ["created_at", "agent", "session_id", "project"] as const;
  if (!strings.every((k) => typeof raw[k] === "string")) return null;
  if (raw.trigger !== "auto" && raw.trigger !== "user") return null;
  const lists = ["files", "commands", "open_questions"] as const;
  if (!lists.every((k) => Array.isArray(raw[k]))) return null;
  if (!["files_total", "added", "removed", "steps_total"].every((k) => typeof raw[k] === "number"))
    return null;
  return raw as unknown as HandoffNoteView;
}

export class HandoffStore {
  constructor(private readonly dir: string) {}

  private ensure(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Note ids on disk that look like ours, newest first (ids sort by creation, see `newId`). */
  private ids(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.endsWith(".json") && NOTE_ID.test(n.slice(0, -5)))
      .map((n) => n.slice(0, -5))
      .sort()
      .reverse();
  }

  private sequence = 0;

  /**
   * `hn_` + 12 hex of the millisecond time + 4 hex of a per-process counter + 8 hex of randomness:
   * ids sort in creation order even inside one millisecond, and cannot be guessed.
   */
  newId(nowMs: number): string {
    const seq = (this.sequence++ & 0xffff).toString(16).padStart(4, "0");
    return `hn_${nowMs.toString(16).padStart(12, "0").slice(-12)}${seq}${randomBytes(4).toString("hex")}`;
  }

  get(id: string): HandoffNoteView | null {
    if (!NOTE_ID.test(id)) return null;
    const path = this.file(id);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) return null;
      return asNote(JSON.parse(readFileSync(path, "utf8")), id);
    } catch {
      return null;
    }
  }

  list(): HandoffNoteView[] {
    return this.ids()
      .map((id) => this.get(id))
      .filter((n): n is HandoffNoteView => n !== null);
  }

  count(): number {
    return this.ids().length;
  }

  /** Writes (or replaces) a note. Throws when it is over MAX_NOTE_BYTES: callers bound their text. */
  put(note: HandoffNoteView): void {
    const body = JSON.stringify(note);
    if (Buffer.byteLength(body) > MAX_NOTE_BYTES) throw new Error("handoff note is too large");
    this.ensure();
    const path = this.file(note.id);
    const temp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
    for (const old of this.ids().slice(MAX_NOTES)) rmSync(this.file(old), { force: true });
  }

  remove(id: string): boolean {
    if (!NOTE_ID.test(id)) return false;
    const existed = this.ids().includes(id);
    rmSync(this.file(id), { force: true });
    return existed;
  }

  /** Deletes every note of ours; returns how many. */
  deleteAll(): number {
    const ids = this.ids();
    for (const id of ids) rmSync(this.file(id), { force: true });
    return ids.length;
  }
}
