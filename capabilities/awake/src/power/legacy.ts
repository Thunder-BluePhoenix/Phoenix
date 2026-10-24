// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Adopting the recovery journal an older Phoenix wrote (Phase 73). Before Core handed capabilities a
// data directory, the journal was `<PHOENIX_DATA_DIR or ~/.phoenix/<env>>/awake/recovery-journal.jsonl`.
// It now lives in the capability's own Core directory (`ctx.dataDir`). A change that was still
// pending in the old file must never be forgotten, so on start the old file's pending entries are
// COPIED into the new journal (one atomic replace), read back and compared, and only then is the old
// file renamed aside (`.adopted-<time>`, kept for audit). Doing it in this order means:
//   - a crash at any point leaves the entries in at least one file, and a rerun finishes the job
//     (entries already present in the new journal, by change id, are not added twice);
//   - the old file is retired, so a later start never undoes a stale entry a second time (an extra
//     `pmset ... 0` would otherwise switch off a lid-closed session that is running legitimately);
//   - anything that cannot be done safely reports "failed" and the caller keeps using the OLD
//     directory, so nothing is ever dropped and the journal still has exactly one home.
// The new journal's own entries come first in the file, the adopted ones after them, so the
// recovery undo (newest first) takes the old changes before the new ones: old first, then new.
import { dirname } from "node:path";
import { decodeLine, encodeLine, parseJournal, type JournalRecord } from "./format";
import { MAX_JOURNAL_BYTES, type JournalFs } from "./journal";

export type AdoptResult =
  /** The old journal is absent or has nothing pending: nothing to do, and it is left alone. */
  | { status: "none" }
  /** `adopted` pending entries are now in the new journal; the old file was renamed aside. */
  | { status: "adopted"; adopted: number }
  /** Not done (nothing was lost; the new journal is as it was). Keep using the old directory. */
  | { status: "failed"; reason: string };

export interface AdoptOptions {
  fs: JournalFs;
  /** The old journal file. */
  legacyPath: string;
  /** The new journal file. */
  path: string;
  now: () => number;
}

/** Every change id the journal text mentions, finished or not. */
function changeIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const rec = decodeLine(line);
    if (rec?.t === "change") ids.add(rec.id);
  }
  return ids;
}

export function adoptLegacyJournal(o: AdoptOptions): AdoptResult {
  const { fs, legacyPath, path } = o;
  if (legacyPath === path) return { status: "none" };
  let legacyText: string | undefined;
  let current: string | undefined;
  try {
    legacyText = fs.read(legacyPath);
    if (legacyText === undefined) return { status: "none" };
    // A journal that cannot be read counts as "failed" below, never as "nothing there".
    current = fs.read(path);
  } catch {
    return { status: "failed", reason: "a journal could not be read" };
  }
  const old = parseJournal(legacyText);
  if (old.pending.length === 0) return { status: "none" };

  const known = changeIds(current ?? "");
  const take = old.pending.filter((e) => !known.has(e.id));
  let written = false;
  const rollback = (): void => {
    if (!written) return;
    try {
      if (current === undefined) fs.remove(path);
      else fs.replace(path, current);
    } catch {
      // A leftover copy is harmless: the next try skips entries already present.
    }
  };

  if (take.length > 0) {
    const records: JournalRecord[] = [];
    for (const e of take) {
      const { applied, ...change } = e;
      records.push({ t: "change", ...change });
      if (applied) records.push({ t: "applied", id: e.id, at: e.at });
      if (e.session !== null && old.endedSessions.has(e.session)) {
        records.push({ t: "session_end", session: e.session, at: e.at });
      }
    }
    // A last line cut off by a crash must not swallow the first adopted record.
    const prefix = current === undefined || current === "" || current.endsWith("\n") ? "" : "\n";
    const next = (current ?? "") + prefix + records.map(encodeLine).join("");
    if (next.length > MAX_JOURNAL_BYTES) {
      return { status: "failed", reason: "the adopted entries do not fit in the new journal" };
    }
    try {
      fs.mkdirPrivate(dirname(path));
      fs.replace(path, next);
      written = true;
      const back = fs.read(path);
      const present = back === undefined ? new Set<string>() : changeIds(back);
      if (back !== next || !take.every((e) => present.has(e.id))) {
        rollback();
        return { status: "failed", reason: "the copy could not be verified" };
      }
    } catch {
      rollback();
      return { status: "failed", reason: "the new journal could not be written" };
    }
  }

  try {
    fs.rename(legacyPath, `${legacyPath}.adopted-${o.now()}`);
  } catch {
    rollback();
    return { status: "failed", reason: "the old journal could not be set aside" };
  }
  return { status: "adopted", adopted: take.length };
}
