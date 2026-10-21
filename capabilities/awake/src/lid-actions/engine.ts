// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The framework every lid action runs in (Phase 74).
//
//   close:  for each ENABLED action, in order: plan (read-only) -> journal {kind, apply, undo}
//           -> apply. The journal write is Recovery's `change()`: it happens BEFORE `apply`, and if
//           it fails the action is not run (fail closed). An action that fails, or is refused,
//           never blocks the others.
//   open:   everything this module journalled is undone, newest first, by Recovery's `undo()`.
//           The same reverters are registered with Recovery (`lidReverters`), so an entry written
//           by a dead instance is undone by the next instance's reconcile with nothing from memory:
//           the undo data in the entry is self-sufficient.
// Close and open never overlap: they run one after the other, in the order they were asked.
import { JournalWriteError, NotAppliedError } from "../power/journal";
import type { Reverter } from "../power/reconcile";
import {
  ACTION_IDS,
  QUIET_SKIPS,
  type ActionId,
  type ActionResult,
  type ActionUndone,
  isSettledUndoError,
  type LidAction,
  type LidRun,
  type PlanContext,
  type ProcInfo,
  type ReleaseWhy,
  type RecoveryPort,
  type SkipReason,
} from "./types";

export type LidEmit = (
  type: string,
  severity: "info" | "warning",
  payload: Record<string, unknown>,
) => void;

export interface LidEngineOptions {
  /** Every action (enabled or not): undo must work for what an earlier run left, whatever the config says now. */
  actions: readonly LidAction[];
  /** Ids of the actions the user has switched on. */
  enabled: ReadonlySet<ActionId>;
  recovery: RecoveryPort;
  processes: () => Promise<ProcInfo[]>;
  emit: LidEmit;
  now: () => number;
  /** Waits `ms` on the host clock's timer (a test makes it instant or counts it). */
  sleep: (ms: number) => Promise<void>;
}

/** An undo that failed is tried this many times in all, with the pauses below between the tries. */
export const UNDO_TRIES = 3;
export const UNDO_BACKOFF_MS: readonly number[] = [1_000, 3_000];

/** Remembers what each undo reported, so the engine can tell the user without reading the journal. */
export type UndoSink = Map<string, ActionUndone>;

/**
 * One Reverter per journal kind this module owns. The recorded `undo` data is user-writable
 * storage: each action validates it itself. Low Power Mode is not here: Recovery registers it.
 */
export function lidReverters(
  actions: readonly LidAction[],
  sink?: UndoSink,
): Record<string, Reverter> {
  const out: Record<string, Reverter> = {};
  for (const action of actions) {
    const undo = action.undo;
    if (!undo) continue;
    out[action.kind] = async (data, entry) => {
      const done = await undo.call(action, data);
      sink?.set(entry.id, done);
    };
  }
  return out;
}

function failureReason(err: unknown): string {
  if (err instanceof JournalWriteError) return "journal_unwritable";
  if (err instanceof NotAppliedError) return "not_applied";
  return "apply_failed";
}

export class LidEngine {
  private chain: Promise<unknown> = Promise.resolve();
  private closedFor: string | null = null;
  /** The actions were applied because the lid observer reported a close (not a simulation). */
  private byLid = false;
  private lastRun: LidRun | null = null;
  /** Ids of the journal entries this engine made (Low Power Mode shares its kind with Recovery's floors). */
  private readonly ours = new Set<string>();
  private readonly undone: UndoSink = new Map();

  constructor(private readonly o: LidEngineOptions) {}

  /** The sink to hand to `lidReverters`. */
  get sink(): UndoSink {
    return this.undone;
  }

  /** The session whose lid-close actions are applied now, or null. */
  get closedSession(): string | null {
    return this.closedFor;
  }

  get last(): LidRun | null {
    return this.lastRun;
  }

  /** Runs the enabled actions for a lid close during `session`. Never throws. */
  close(session: string, viaLid = false): Promise<LidRun> {
    return this.queue(() => this.closeNow(session, viaLid));
  }

  /**
   * The lid observer's current reading. The observer only announces a change between two KNOWN
   * readings, so a lid that opened while the reading was `unknown` is never announced: when the
   * actions were applied for a real lid close and the reading is now `open`, that is the open.
   */
  lidReading(state: "open" | "closed" | "unknown" | "unsupported"): Promise<LidRun> | null {
    if (state !== "open" || this.closedFor === null || !this.byLid) return null;
    return this.open("lid_opened");
  }

  /** Undoes everything this module journalled. Idempotent. Never throws. */
  open(why: ReleaseWhy): Promise<LidRun> {
    return this.queue(() => this.openNow(why));
  }

  /** Marks the session ended (so the backstop can see it) and then undoes. */
  endSession(session: string, why: ReleaseWhy): Promise<LidRun> {
    this.o.recovery.markSessionEnded(session);
    return this.open(why);
  }

  private queue(job: () => Promise<LidRun>): Promise<LidRun> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async closeNow(session: string, viaLid: boolean): Promise<LidRun> {
    // Already closed for this session: the actions are applied; applying again would journal twice.
    if (this.closedFor === session && this.lastRun) return this.lastRun;
    const results: ActionResult[] = [];
    let table: Promise<ProcInfo[] | null> | undefined;
    for (const id of ACTION_IDS) {
      const action = this.o.actions.find((a) => a.id === id);
      if (!action || !this.o.enabled.has(id)) continue;
      const skipped: SkipReason[] = [];
      const ctx: PlanContext = {
        session,
        procs: () => (table ??= this.o.processes().catch(() => null)),
        skip: (reason) => {
          skipped.push(reason);
          return null;
        },
      };
      try {
        const planned = await action.plan(ctx);
        if (!planned) {
          const reason = skipped[0] ?? "nothing_to_do";
          results.push({ action: id, outcome: "skipped", reason });
          if (!Object.hasOwn(QUIET_SKIPS, reason)) this.fail(id, session, "plan", reason);
          continue;
        }
        // The journal write is inside `change`, before the callback; a failed write throws and `apply` never runs.
        // Ids pending before this change: whatever is new afterwards (even if apply threw, because the
        // change may have happened) is ours, so the lid opening undoes it.
        const before = new Set(this.o.recovery.canQuit().pending.map((p) => p.id));
        try {
          await this.o.recovery.change(
            action.kind,
            planned.apply,
            planned.undo,
            () => action.apply(planned),
            session,
          );
        } finally {
          for (const p of this.o.recovery.canQuit().pending)
            if (!before.has(p.id) && p.kind === action.kind) this.ours.add(p.id);
        }
        const result: ActionResult = {
          action: id,
          outcome: "applied",
          count: planned.count,
          ...(planned.notes ? { notes: planned.notes } : {}),
        };
        results.push(result);
        this.o.emit("awake.lid_action.applied", "info", {
          action: id,
          session_id: session,
          count: planned.count,
          ...(planned.targets ? { targets: planned.targets } : {}),
          ...(planned.notes ? { notes: planned.notes } : {}),
        });
      } catch (err) {
        const reason = failureReason(err);
        results.push({ action: id, outcome: "failed", reason });
        this.fail(id, session, "apply", reason);
      }
    }
    this.closedFor = session;
    this.byLid = viaLid;
    this.lastRun = { event: "closed", at: this.o.now(), session_id: session, results };
    return this.lastRun;
  }

  private async openNow(why: ReleaseWhy): Promise<LidRun> {
    const session = this.closedFor;
    const kinds = new Set(this.o.actions.map((a) => a.kind));
    const results: ActionResult[] = [];
    let filter = (e: { kind: string; id: string }): boolean =>
      kinds.has(e.kind) && (e.kind.startsWith("lid.") || this.ours.has(e.id));
    const undoneEntries: { kind: string; id: string }[] = [];
    // The latest outcome of every entry that has failed so far (a later success removes it).
    const failedById = new Map<string, { kind: string; id: string; error?: string }>();
    for (let attempt = 1; attempt <= UNDO_TRIES; attempt++) {
      let report;
      try {
        report = await this.o.recovery.undo(filter);
      } catch {
        report = undefined;
      }
      for (const u of report?.undone ?? []) {
        undoneEntries.push(u);
        failedById.delete(u.id);
      }
      for (const f of report?.failed ?? []) failedById.set(f.id, f);
      const failedEntries = [...failedById.values()];
      if (report === undefined) break;
      // Only what failed for a reason that may pass is tried again; `retry_or_alert` and
      // `output_changed` need the world to change, so they stay pending without a retry loop.
      const retry = failedEntries.filter((f) => !isSettledUndoError(f.error));
      if (retry.length === 0 || attempt === UNDO_TRIES) break;
      const ids = new Set(retry.map((f) => f.id));
      filter = (e) => ids.has(e.id);
      await this.o.sleep(UNDO_BACKOFF_MS[attempt - 1] ?? 3_000);
    }
    const actionOf = (kind: string): ActionId | undefined =>
      this.o.actions.find((a) => a.kind === kind)?.id;
    for (const entry of undoneEntries) {
      const action = actionOf(entry.kind);
      if (!action) continue;
      const done = this.undone.get(entry.id);
      this.undone.delete(entry.id);
      this.ours.delete(entry.id);
      results.push({
        action,
        outcome: "undone",
        count: done?.count ?? 1,
        ...(done?.mismatched ? { mismatched: done.mismatched } : {}),
        ...(done?.gone ? { gone: done.gone } : {}),
        ...(done?.notOurs ? { notOurs: done.notOurs } : {}),
        ...(done?.notes && done.notes.length > 0 ? { notes: done.notes } : {}),
      });
      this.o.emit("awake.lid_action.undone", "info", {
        action,
        session_id: session,
        count: done?.count ?? 1,
        mismatched: done?.mismatched ?? 0,
        gone: done?.gone ?? 0,
        not_ours: done?.notOurs ?? 0,
        ...(done?.notes && done.notes.length > 0 ? { notes: done.notes } : {}),
      });
      // Processes the system would not let Phoenix resume are not Phoenix's: said out loud.
      if (done?.notOurs) this.fail(action, session, "undo", "not_ours");
    }
    for (const entry of failedById.values()) {
      const action = actionOf(entry.kind);
      if (!action) continue;
      // Fixed codes only; any other error text stays out of events and status.
      const reason = isSettledUndoError(entry.error)
        ? (entry.error ?? "undo_failed")
        : "undo_failed";
      results.push({ action, outcome: "undo_failed", reason });
      this.fail(action, session, "undo", reason);
    }
    this.closedFor = null;
    this.byLid = false;
    this.lastRun = { event: "opened", at: this.o.now(), session_id: session, why, results };
    return this.lastRun;
  }

  private fail(
    action: ActionId,
    session: string | null,
    phase: "plan" | "apply" | "undo",
    reason: string,
  ): void {
    this.o.emit("awake.lid_action.failed", "warning", {
      action,
      session_id: session,
      phase,
      reason,
    });
  }
}
