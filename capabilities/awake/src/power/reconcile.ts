// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Journal-first changes and their undo (Phase 73). The rules, in order of importance:
//   1. `change()` writes the entry to the journal BEFORE it makes the change. If that write fails
//      the change is not made and the error is returned to the caller (fail closed).
//   2. `undo()` is idempotent and goes in reverse order. One failing undo never stops the rest;
//      what could not be undone is reported (and stays in the journal, so it is tried again).
//   3. `reconcile()` (run when the capability starts) undoes everything a previous run left behind,
//      under the recovery lock so two Phoenix instances never do it at once. An entry owned by a
//      DIFFERENT, still-running Phoenix is left alone.
//   4. `canQuit()` says no while anything still needs undoing.
// Undo data is read back from a user-writable file, so a Reverter must validate it itself.
import type { Fields, Owner, PendingEntry } from "./format";
import { NotAppliedError, type RecoveryJournal } from "./journal";
import type { ProcessProbe, RecoveryLock } from "./lock";

/** Undoes one recorded change from its recorded `undo` data. Throws if it could not. */
export type Reverter = (undo: Fields, entry: PendingEntry) => Promise<void>;

export interface UndoOutcome {
  id: string;
  kind: string;
  /** Why it failed (clipped; only what a Reverter threw, never secrets). */
  error?: string;
}

export interface UndoReport {
  undone: UndoOutcome[];
  failed: UndoOutcome[];
  /** Entries left alone because another running Phoenix owns them. */
  heldByOther: number;
  /** The recovery lock was held by a live instance: nothing was done. */
  locked: boolean;
  untrusted: number;
  partialTail: boolean;
}

export interface PendingChange {
  id: string;
  kind: string;
  at: number;
}

export interface QuitCheck {
  ok: boolean;
  pending: PendingChange[];
}

export type RecoveryEvent =
  | "awake.privileged.apply"
  | "awake.privileged.undo"
  | "awake.recovery.pending"
  | "awake.recovery.reconciled";

export interface RecoveryManagerOptions {
  journal: RecoveryJournal;
  lock: RecoveryLock;
  probe: ProcessProbe;
  reverters: Record<string, Reverter>;
  now: () => number;
  newId: () => string;
  /** Publishes an awake.* event; "warning" severities are the loud ones. */
  emit: (
    type: RecoveryEvent,
    severity: "info" | "warning",
    payload: Record<string, unknown>,
  ) => void;
}

const MAX_ERROR = 200;

export class RecoveryManager {
  private self: Owner | undefined;
  /** Changes that still need undoing (made by this instance, or found and not yet undone). */
  private readonly outstanding = new Map<string, PendingChange>();
  private chain: Promise<unknown> = Promise.resolve();
  private integrityAnnounced = false;

  constructor(private readonly o: RecoveryManagerOptions) {}

  /** This process's identity (pid and start time), read once, when first needed. */
  async identity(): Promise<Owner> {
    this.self ??= await this.o.probe.self();
    return this.self;
  }

  /**
   * Records the change, makes it, then marks it applied. `apply` and `undo` are the data that is
   * written down; `doApply` is what actually changes the machine. Throws JournalWriteError (change
   * not made) or whatever `doApply` throws: a NotAppliedError closes the entry, anything else
   * leaves it pending, because the change may have happened.
   */
  async change(
    kind: string,
    apply: Fields,
    undo: Fields,
    doApply: () => Promise<void>,
    session: string | null,
  ): Promise<string> {
    const owner = await this.identity();
    const id = this.o.newId();
    const at = this.o.now();
    // 1. Journal first. A throw here means nothing has been changed.
    this.o.journal.append({ t: "change", id, kind, apply, undo, at, session, owner });
    this.outstanding.set(id, { id, kind, at });
    try {
      await doApply();
    } catch (err) {
      if (err instanceof NotAppliedError) this.close(id);
      throw err;
    }
    try {
      this.o.journal.append({ t: "applied", id, at: this.o.now() });
    } catch {
      // The change is made and its entry exists: it is still undone by id. Unconfirmed is safe.
    }
    this.o.emit("awake.privileged.apply", "info", { id, kind, session });
    return id;
  }

  /** The entry's change never happened: record that so it does not block quitting. */
  private close(id: string): void {
    try {
      this.o.journal.append({ t: "undone", id, at: this.o.now() });
      this.outstanding.delete(id);
    } catch {
      // Left pending; undoing a change that never happened is harmless.
    }
  }

  /** Records that a session ended, so the backstop can undo what it left. */
  markSessionEnded(session: string): void {
    try {
      this.o.journal.append({ t: "session_end", session, at: this.o.now() });
    } catch {
      // The owner check still covers a dead Phoenix; a live one undoes it itself.
    }
  }

  /**
   * Undoes what this instance owns plus anything whose owner is gone, newest first, optionally only
   * entries `filter` accepts. Safe to call any number of times; calls never overlap.
   */
  undo(filter?: (entry: PendingEntry) => boolean): Promise<UndoReport> {
    const run = this.chain.then(() => this.undoNow(filter));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Launch-time crash recovery: the same undo, named for what it is. */
  reconcile(): Promise<UndoReport> {
    return this.undo();
  }

  private async undoNow(
    filter: ((entry: PendingEntry) => boolean) | undefined,
  ): Promise<UndoReport> {
    const report: UndoReport = {
      undone: [],
      failed: [],
      heldByOther: 0,
      locked: false,
      untrusted: 0,
      partialTail: false,
    };
    const peek = this.o.journal.read();
    report.untrusted = peek.untrusted;
    report.partialTail = peek.partialTail;
    // Nothing to undo: no lock, no files touched, no processes asked about.
    if (peek.pending.length === 0) {
      this.track([]);
      this.announce(report);
      return report;
    }
    const lock = await this.o.lock.acquire();
    if (!lock.ok) {
      report.locked = true;
      this.track(peek.pending);
      return report;
    }
    const heldByOther = new Set<string>();
    try {
      const self = await this.identity();
      const parsed = this.o.journal.read();
      for (const entry of [...parsed.pending].reverse()) {
        if (filter && !filter(entry)) continue;
        const mine = entry.owner.pid === self.pid && entry.owner.started === self.started;
        if (!mine && (await this.o.probe.alive(entry.owner))) {
          heldByOther.add(entry.id);
          continue;
        }
        const outcome = await this.undoOne(entry);
        (outcome.error === undefined ? report.undone : report.failed).push(outcome);
      }
      report.heldByOther = heldByOther.size;
      // An entry a different running Phoenix owns is that Phoenix's to undo, not a reason for this one to stay open.
      this.track(this.o.journal.read().pending.filter((e) => !heldByOther.has(e.id)));
    } finally {
      this.o.lock.release();
    }
    this.announce(report);
    return report;
  }

  /** What the journal says is pending is what blocks quitting (except what another running Phoenix owns). */
  private track(pending: readonly PendingEntry[]): void {
    this.outstanding.clear();
    for (const e of pending) this.outstanding.set(e.id, { id: e.id, kind: e.kind, at: e.at });
  }

  private async undoOne(entry: PendingEntry): Promise<UndoOutcome> {
    const outcome: UndoOutcome = { id: entry.id, kind: entry.kind };
    try {
      const reverter = this.o.reverters[entry.kind];
      if (!reverter) throw new Error(`no way to undo "${entry.kind}"`);
      try {
        await reverter(entry.undo, entry);
      } catch (err) {
        // A change whose apply was never confirmed, and whose undo is refused because the helper is
        // absent, cannot have been applied through that helper: close it rather than block quitting.
        if (!(err instanceof NotAppliedError) || entry.applied) throw err;
      }
      this.o.journal.append({ t: "undone", id: entry.id, at: this.o.now() });
    } catch (err) {
      outcome.error = (err instanceof Error ? err.message : "undo failed").slice(0, MAX_ERROR);
      try {
        this.o.journal.append({
          t: "undo_failed",
          id: entry.id,
          at: this.o.now(),
          error: outcome.error,
        });
      } catch {
        // The entry is still pending; that is what matters.
      }
    }
    this.o.emit("awake.privileged.undo", outcome.error === undefined ? "info" : "warning", {
      id: entry.id,
      kind: entry.kind,
      ok: outcome.error === undefined,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    });
    return outcome;
  }

  /**
   * One loud warning when something could not be undone (the Fawkes WARNING state), else a quiet
   * "reconciled" that clears it. Journal damage is announced once per instance.
   */
  private announce(report: UndoReport): void {
    if (report.failed.length > 0) {
      this.o.emit("awake.recovery.pending", "warning", {
        count: report.failed.length,
        kinds: report.failed.map((f) => f.kind),
      });
      return;
    }
    const damaged = (report.untrusted > 0 || report.partialTail) && !this.integrityAnnounced;
    if (report.undone.length > 0 || damaged) {
      if (damaged) this.integrityAnnounced = true;
      this.o.emit("awake.recovery.reconciled", report.untrusted > 0 ? "warning" : "info", {
        undone: report.undone.length,
        untrusted: report.untrusted,
        partial_tail: report.partialTail,
      });
    }
  }

  /** The veto the desktop shell and Core shutdown consult: no while a change still needs undoing. */
  canQuit(): QuitCheck {
    const pending = [...this.outstanding.values()];
    return { ok: pending.length === 0, pending };
  }
}
