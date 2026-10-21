// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The recovery journal's storage (Phase 73): an append-only JSON-lines file in the Core data dir.
// The directory is created 0700 and the file 0600. Every append is one write on an O_APPEND handle
// followed by fsync, so a crash leaves at most one torn last line (which `parseJournal` tolerates).
// The file is size-bounded: once it passes MAX_JOURNAL_BYTES it is rewritten, atomically, down to
// the entries that still need undoing; if that is not enough, new changes are refused (fail closed).
// All file access goes through `JournalFs`, so tests inject failures and use a temp dir.
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { encodeLine, parseJournal, type JournalRecord, type ParsedJournal } from "./format";

export const MAX_JOURNAL_BYTES = 1 << 20;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** The file operations the journal and its lock need. Every method throws on failure. */
export interface JournalFs {
  /** Creates the directory (and parents) with mode 0700. */
  mkdirPrivate(dir: string): void;
  /** Whole file text, or undefined when it does not exist. */
  read(path: string): string | undefined;
  /** Appends `data` in one write and fsyncs; creates the file 0600. */
  append(path: string, data: string): void;
  /** Replaces the file atomically (temp file, fsync, rename), mode 0600. */
  replace(path: string, data: string): void;
  /** Creates the file 0600 holding `data`; throws EEXIST if it exists. */
  createExclusive(path: string, data: string): void;
  remove(path: string): void;
  size(path: string): number;
}

export const nodeJournalFs: JournalFs = {
  mkdirPrivate(dir) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    chmodSync(dir, DIR_MODE);
  },
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      if (err instanceof Error && Reflect.get(err, "code") === "ENOENT") return undefined;
      throw err;
    }
  },
  append(path, data) {
    const fd = openSync(path, "a", FILE_MODE);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(path, FILE_MODE);
  },
  replace(path, data) {
    const temp = `${path}.${process.pid}.tmp`;
    const fd = openSync(temp, "w", FILE_MODE);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  },
  createExclusive(path, data) {
    const fd = openSync(path, "wx", FILE_MODE);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  },
  remove(path) {
    rmSync(path, { force: true });
  },
  size(path) {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  },
};

/** The journal could not be written: the caller must not make the change it was about to record. */
export class JournalWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalWriteError";
  }
}

export interface RecoveryJournalOptions {
  /** The journal file; its directory is created private. */
  path: string;
  fs?: JournalFs;
  maxBytes?: number;
}

export class RecoveryJournal {
  readonly path: string;
  private readonly fs: JournalFs;
  private readonly maxBytes: number;
  private ready = false;

  constructor(options: RecoveryJournalOptions) {
    this.path = options.path;
    this.fs = options.fs ?? nodeJournalFs;
    this.maxBytes = options.maxBytes ?? MAX_JOURNAL_BYTES;
  }

  /** Throws JournalWriteError when the record is not durably on disk. */
  append(rec: JournalRecord): void {
    try {
      if (!this.ready) {
        this.fs.mkdirPrivate(dirname(this.path));
        this.ready = true;
      }
      const line = encodeLine(rec);
      if (this.fs.size(this.path) + line.length > this.maxBytes) this.compact();
      if (this.fs.size(this.path) + line.length > this.maxBytes) {
        throw new Error("the recovery journal is full of changes that still need undoing");
      }
      this.fs.append(this.path, line);
    } catch (err) {
      throw new JournalWriteError(err instanceof Error ? err.message : "journal write failed");
    }
  }

  /** The journal as it is now. An unreadable file reads as empty with one untrusted entry. */
  read(): ParsedJournal {
    try {
      return parseJournal(this.fs.read(this.path) ?? "");
    } catch {
      return { pending: [], endedSessions: new Set(), untrusted: 1, partialTail: false };
    }
  }

  sizeBytes(): number {
    return this.fs.size(this.path);
  }

  /** Rewrites the file with only what still needs undoing (and the session-end marks that explain it). */
  private compact(): void {
    const parsed = parseJournal(this.fs.read(this.path) ?? "");
    const keep: string[] = [];
    for (const e of parsed.pending) {
      const { applied, ...change } = e;
      keep.push(encodeLine({ t: "change", ...change }));
      if (applied) keep.push(encodeLine({ t: "applied", id: e.id, at: e.at }));
      if (e.session !== null && parsed.endedSessions.has(e.session)) {
        keep.push(encodeLine({ t: "session_end", session: e.session, at: e.at }));
      }
    }
    this.fs.replace(this.path, keep.join(""));
  }
}

/**
 * A change that definitely did NOT happen (for example `sudo -n` refused before any pmset ran).
 * The journal marks such an entry undone at once, so a refused change never blocks quitting.
 */
export class NotAppliedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAppliedError";
  }
}
