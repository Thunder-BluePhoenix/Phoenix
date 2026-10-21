// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The recovery lock (Phase 73): a file that keeps two Phoenix instances from undoing the same
// changes at once. The holder is identified by pid AND process start time, so a pid reused by an
// unrelated process after a crash does not keep the lock alive. A lock whose holder is gone, whose
// file cannot be read, that is older than STALE_LOCK_MS (an undo never takes that long), or that is dated in the future
// (beyond MAX_LOCK_SKEW_MS) is stale
// and is taken over.
import { dirname } from "node:path";
import type { Runner } from "../system";
import type { JournalFs } from "./journal";
import type { Owner } from "./format";

export const STALE_LOCK_MS = 10 * 60_000;
/** A lock stamped further ahead of the clock than this is forged or from a broken clock: stale. */
export const MAX_LOCK_SKEW_MS = 60_000;
const ENV = "/usr/bin/env";
const PS = "/bin/ps";
/**
 * `ps` prints `lstart` in the local time zone and locale, so a zone or DST change between the time an
 * owner was recorded and the time it is checked would make the same process look like a different
 * one. Recording and checking both pin the zone and locale (the same argv as helper/phoenix-awake-backstop.mjs).
 */
export const PS_START_ARGV = (pid: number): readonly string[] => [
  "TZ=UTC",
  "LC_ALL=C",
  PS,
  "-o",
  "lstart=",
  "-p",
  String(pid),
];
const PS_TIMEOUT_MS = 5_000;

/** Reads who is running; both methods go through the injected Runner (`ps`, read-only). */
export interface ProcessProbe {
  /** This process's owner token (pid and start time). */
  self(): Promise<Owner>;
  /** Whether the process that wrote `owner` is still running. */
  alive(owner: Owner): Promise<boolean>;
}

/** The start time of a pid as `ps -o lstart=` prints it; "" when it is not running or unreadable. */
async function startOf(run: Runner, pid: number): Promise<string | undefined> {
  const result = await run(ENV, PS_START_ARGV(pid), { timeoutMs: PS_TIMEOUT_MS });
  if (result.code === null) return undefined;
  return result.code === 0 ? result.stdout.trim() : "";
}

/** The real probe over a Runner. `ps` failing to run answers "alive": never undo from a guess. */
export function createProcessProbe(run: Runner, pid: number): ProcessProbe {
  return {
    async self() {
      return { pid, started: (await startOf(run, pid)) ?? "" };
    },
    async alive(owner) {
      const started = await startOf(run, owner.pid);
      if (started === undefined) return true;
      if (started === "") return false;
      // Without a recorded start time only existence can be checked.
      return owner.started === "" || owner.started === started;
    },
  };
}

export type LockResult = { ok: true } | { ok: false; heldBy: Owner | undefined };

export interface RecoveryLockOptions {
  path: string;
  fs: JournalFs;
  probe: ProcessProbe;
  now: () => number;
}

export class RecoveryLock {
  private held = false;

  constructor(private readonly o: RecoveryLockOptions) {}

  /** Takes the lock, or reports who holds it. Never throws. */
  async acquire(): Promise<LockResult> {
    const me = await this.o.probe.self();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.o.fs.mkdirPrivate(dirname(this.o.path));
        this.o.fs.createExclusive(this.o.path, JSON.stringify({ ...me, at: this.o.now() }));
        this.held = true;
        return { ok: true };
      } catch (err) {
        if (!(err instanceof Error) || Reflect.get(err, "code") !== "EEXIST") {
          return { ok: false, heldBy: undefined };
        }
      }
      const holder = await this.holder();
      if (holder.live) return { ok: false, heldBy: holder.owner };
      try {
        this.o.fs.remove(this.o.path);
      } catch {
        return { ok: false, heldBy: undefined };
      }
    }
    return { ok: false, heldBy: undefined };
  }

  /** Gives the lock back. Idempotent; a lock this instance does not hold is left alone. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      this.o.fs.remove(this.o.path);
    } catch {
      // A leftover lock is stale by definition once this process is gone.
    }
  }

  private async holder(): Promise<{ live: boolean; owner: Owner | undefined }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.o.fs.read(this.o.path) ?? "null");
    } catch {
      return { live: false, owner: undefined };
    }
    if (parsed === null || typeof parsed !== "object") return { live: false, owner: undefined };
    const pid: unknown = Reflect.get(parsed, "pid");
    const started: unknown = Reflect.get(parsed, "started");
    const at: unknown = Reflect.get(parsed, "at");
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) {
      return { live: false, owner: undefined };
    }
    if (typeof started !== "string" || typeof at !== "number")
      return { live: false, owner: undefined };
    const owner: Owner = { pid, started };
    if (!Number.isFinite(at)) return { live: false, owner: undefined };
    // Too old, or stamped in the future (a forged `at` would otherwise keep a live pid's lock forever).
    const age = this.o.now() - at;
    if (age > STALE_LOCK_MS || age < -MAX_LOCK_SKEW_MS) return { live: false, owner };
    return { live: await this.o.probe.alive(owner), owner };
  }
}
