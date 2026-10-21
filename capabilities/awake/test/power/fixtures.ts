// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Fakes for the recovery tests. No file outside memory, no process, no command is ever touched:
// the file system is a map, "processes" are a table, and every command goes to a recording Runner.
import type { JournalFs } from "../../src/power/journal";
import { RecoveryJournal } from "../../src/power/journal";
import { RecoveryLock, type ProcessProbe } from "../../src/power/lock";
import { RecoveryManager, type RecoveryEvent, type Reverter } from "../../src/power/reconcile";
import type { Owner, PendingEntry } from "../../src/power/format";
import type { RunResult } from "../../src/system";

/** An in-memory file system with switches to make writes fail, like a full or read-only disk. */
export class MemFs implements JournalFs {
  readonly files = new Map<string, string>();
  readonly dirs: string[] = [];
  failAppend = false;
  failReplace = false;
  failRemove = false;

  mkdirPrivate(dir: string): void {
    this.dirs.push(dir);
  }
  read(path: string): string | undefined {
    return this.files.get(path);
  }
  append(path: string, data: string): void {
    if (this.failAppend) throw new Error("ENOSPC");
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }
  replace(path: string, data: string): void {
    if (this.failReplace) throw new Error("EROFS");
    this.files.set(path, data);
  }
  createExclusive(path: string, data: string): void {
    if (this.files.has(path)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
    this.files.set(path, data);
  }
  remove(path: string): void {
    if (this.failRemove) throw new Error("EPERM");
    this.files.delete(path);
  }
  size(path: string): number {
    return this.files.get(path)?.length ?? 0;
  }
}

/** Which "processes" exist: pid -> start time. */
export class FakeProcesses {
  readonly table: Map<number, string>;
  constructor(
    readonly selfPid: number,
    table: Map<number, string> = new Map(),
  ) {
    this.table = table;
    if (!table.has(selfPid)) table.set(selfPid, `start-${selfPid}`);
  }
  /** Another Phoenix instance on the same machine: same process table, its own pid. */
  as(pid: number): FakeProcesses {
    return new FakeProcesses(pid, this.table);
  }
  get self(): Owner {
    return { pid: this.selfPid, started: this.table.get(this.selfPid) ?? "" };
  }
  probe(): ProcessProbe {
    return {
      self: () => Promise.resolve(this.self),
      alive: (owner) => Promise.resolve(this.table.get(owner.pid) === owner.started),
    };
  }
  die(pid: number): void {
    this.table.delete(pid);
  }
}

export const JOURNAL = "/data/awake/recovery-journal.jsonl";
export const LOCK = "/data/awake/recovery.lock";

export interface Calls {
  /** Every privileged command the fake "ran" (argv without sudo). */
  ran: string[];
  /** Commands that fail with this exit code (default: none fail). */
  failWith: Map<string, number>;
}

export function recordingRunner(
  calls: Calls,
): (file: string, args: readonly string[]) => Promise<RunResult> {
  return (file, args) => {
    const line = [file, ...args].join(" ");
    calls.ran.push(line);
    const code = calls.failWith.get(line) ?? 0;
    return Promise.resolve({ code, stdout: "", stderr: "" });
  };
}

export interface Instance {
  manager: RecoveryManager;
  journal: RecoveryJournal;
  events: { type: RecoveryEvent; severity: string; payload: Record<string, unknown> }[];
  undoCalls: Record<string, unknown>[];
}

/** One "Phoenix instance" on shared fake disk and process table. Dropping it is a crash. */
export function instance(
  fs: MemFs,
  procs: FakeProcesses,
  options: {
    reverters?: Record<string, Reverter>;
    verifyNotApplied?: (entry: PendingEntry) => Promise<boolean>;
    now?: () => number;
    maxBytes?: number;
  } = {},
): Instance {
  const journal = new RecoveryJournal({
    path: JOURNAL,
    fs,
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
  });
  const probe = procs.probe();
  let n = 0;
  const events: Instance["events"] = [];
  const undoCalls: Instance["undoCalls"] = [];
  const now = options.now ?? (() => 1_000_000);
  const manager = new RecoveryManager({
    journal,
    lock: new RecoveryLock({ path: LOCK, fs, probe, now }),
    probe,
    reverters: options.reverters ?? {
      "pmset.disablesleep": (undo) => {
        undoCalls.push(undo);
        return Promise.resolve();
      },
    },
    ...(options.verifyNotApplied ? { verifyNotApplied: options.verifyNotApplied } : {}),
    now,
    newId: () => `chg_${procs.selfPid}_${++n}`,
    emit: (type, severity, payload) => events.push({ type, severity, payload }),
  });
  return { manager, journal, events, undoCalls };
}

export const OFF = { argv: ["/usr/bin/pmset", "-a", "disablesleep", "0"] };
export const ON = { argv: ["/usr/bin/pmset", "-a", "disablesleep", "1"] };
