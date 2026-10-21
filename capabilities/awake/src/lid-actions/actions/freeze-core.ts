// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What both freeze actions (chat apps, Docker Desktop) share: choose targets, prove their identity,
// SIGSTOP them, and later SIGCONT only the ones that are still provably the same processes.
//
// The rules, each pinned by a test:
//   - a target is chosen only from the process table read at plan time (ProcessLister), by the
//     executable path of a table app; nothing named by a user, an agent or a remote service;
//   - a protected process is never a target: `plan` does not even offer it;
//   - the journal entry holds `{pid, start, command}` of every target, so the undo needs nothing
//     from memory;
//   - SIGSTOP re-checks identity and protection against a FRESH table right before signalling;
//   - SIGCONT is sent only when the pid's current start time AND command still equal the recorded
//     ones. A pid that no longer matches is counted and reported, never signalled. The one
//     exception to "dropped": the same command with another start time may be the same app
//     relaunched or a changed time zone, so the entry stays pending and the user is told
//     (`retry_or_alert`);
//   - only processes of Phoenix's own user are targets, and a signal the system refuses (EPERM) is
//     classed `not_ours` and reported, never left pending;
//   - an app that holds a power or audio assertion (a call, a huddle, music) is never frozen, and
//     when the assertions cannot be read nothing is frozen (fail closed).
import { NotAppliedError } from "../../power/journal";
import type { Fields } from "../../power/format";
import { appKeyOf, type FreezableApp } from "../apps";
import { readAssertionHolders } from "../assertions";
import { isProtected, type ProtectedContext } from "../protected";
import {
  RETRY_OR_ALERT,
  type ActionUndone,
  type LidSeams,
  type Planned,
  type ProcInfo,
} from "../types";

export interface FrozenProc {
  pid: number;
  start: string;
  command: string;
}

export const MAX_FROZEN = 200;
const MAX_TEXT = 1024;

/** The recorded targets, validated field by field. Anything malformed is counted and never used. */
export function parseFrozen(raw: unknown): { procs: FrozenProc[]; invalid: number } {
  if (!Array.isArray(raw)) return { procs: [], invalid: 0 };
  const procs: FrozenProc[] = [];
  let invalid = 0;
  for (const item of raw.slice(0, MAX_FROZEN)) {
    const pid: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "pid") : undefined;
    const start: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "start") : undefined;
    const command: unknown =
      item !== null && typeof item === "object" ? Reflect.get(item, "command") : undefined;
    if (
      typeof pid === "number" &&
      Number.isSafeInteger(pid) &&
      pid >= 2 &&
      typeof start === "string" &&
      start.length > 0 &&
      start.length <= 64 &&
      typeof command === "string" &&
      command.length > 0 &&
      command.length <= MAX_TEXT
    ) {
      procs.push({ pid, start, command });
    } else invalid += 1;
  }
  return { procs, invalid: invalid + Math.max(0, raw.length - MAX_FROZEN) };
}

export interface FreezeScope {
  /** The apps this action may freeze. */
  apps: readonly FreezableApp[];
  /** The user's protected additions. */
  extra: () => ReadonlySet<string>;
}

export function protectedContext(
  seams: LidSeams,
  table: readonly ProcInfo[],
  extra: ReadonlySet<string>,
): ProtectedContext {
  return {
    selfPid: seams.selfPid,
    agentPids: new Set(seams.agentPids()),
    table: new Map(table.map((p) => [p.pid, p])),
    extra,
  };
}

/** Targets in `table`: processes of the scope's apps that are running, not stopped and not protected. */
export function chooseTargets(
  seams: LidSeams,
  scope: FreezeScope,
  table: readonly ProcInfo[],
): { targets: FrozenProc[]; keys: string[] } {
  const ctx = protectedContext(seams, table, scope.extra());
  const targets: FrozenProc[] = [];
  const keys = new Set<string>();
  for (const proc of table) {
    const key = appKeyOf(proc.command, scope.apps);
    if (key === undefined || proc.pid < 2) continue;
    // Already stopped by someone else: Phoenix did not freeze it, so it must not "unfreeze" it.
    if (proc.state.startsWith("T")) continue;
    // Another user's process is not Phoenix's to signal. Unknown own uid: none.
    if (seams.uid < 0 || proc.uid !== seams.uid) continue;
    if (isProtected(proc, ctx)) continue;
    targets.push({ pid: proc.pid, start: proc.start, command: proc.command });
    keys.add(key);
    if (targets.length >= MAX_FROZEN) break;
  }
  return { targets, keys: [...keys] };
}

export type HolderCheck =
  | { ok: true; targets: FrozenProc[] }
  | { ok: false; reason: "assertions_unknown" | "holds_assertion" };

/**
 * `targets` without the apps that hold an idle-sleep, display-sleep or audio assertion (the whole
 * app: one helper holding it means the app is in use). Unreadable assertions: nothing is frozen.
 */
export async function withoutAssertionHolders(
  seams: LidSeams,
  scope: FreezeScope,
  targets: readonly FrozenProc[],
): Promise<HolderCheck> {
  const holders = await readAssertionHolders(seams.run);
  if (holders === null) return { ok: false, reason: "assertions_unknown" };
  const keyOf = (t: FrozenProc): string => appKeyOf(t.command, scope.apps) ?? t.command;
  const busy = new Set(targets.filter((t) => holders.has(t.pid)).map(keyOf));
  const kept = targets.filter((t) => !busy.has(keyOf(t)));
  return kept.length === 0 ? { ok: false, reason: "holds_assertion" } : { ok: true, targets: kept };
}

export function framePlanned(targets: FrozenProc[], keys: string[]): Planned {
  const procs: Fields[] = targets.map((t) => ({ ...t }));
  return { apply: { procs }, undo: { procs }, count: targets.length, targets: keys };
}

/** SIGSTOP, after re-reading the table: identity and protection are checked again at the last moment. */
export async function freezeNow(
  seams: LidSeams,
  scope: FreezeScope,
  planned: Planned,
): Promise<void> {
  const { procs } = parseFrozen(planned.apply.procs);
  const table = await seams.processes();
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const ctx = protectedContext(seams, table, scope.extra());
  const fresh: FrozenProc[] = [];
  for (const target of procs) {
    const now = byPid.get(target.pid);
    if (!now || now.start !== target.start || now.command !== target.command) continue;
    if (seams.uid < 0 || now.uid !== seams.uid) continue;
    if (isProtected(now, ctx)) continue;
    fresh.push(target);
  }
  // A call may have started since the plan: the assertions are read again right before signalling.
  const check = await withoutAssertionHolders(seams, scope, fresh);
  if (!check.ok) throw new NotAppliedError(check.reason);
  let stopped = 0;
  let failed = 0;
  for (const target of check.targets) {
    try {
      if (seams.signal(target.pid, "SIGSTOP") === "sent") stopped += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) throw new Error("some processes could not be frozen");
  // Nothing was signalled: the change did not happen, so the entry can be closed.
  if (stopped === 0) throw new NotAppliedError("nothing was frozen");
}

/**
 * SIGCONT for exactly the recorded processes that still match. Throws if the table is unreadable,
 * if a signal failed, or (`retry_or_alert`) if a process with the recorded command has another start
 * time: that entry stays pending and the user is told. Gone, different-command and not-ours
 * processes are reported and never keep the entry pending.
 */
export async function thawNow(seams: LidSeams, undo: Fields): Promise<ActionUndone> {
  const { procs, invalid } = parseFrozen(undo.procs);
  if (procs.length === 0) return { count: 0, mismatched: invalid };
  const table = await seams.processes();
  const byPid = new Map(table.map((p) => [p.pid, p]));
  let count = 0;
  let mismatched = invalid;
  let gone = 0;
  let notOurs = 0;
  let failed = 0;
  let uncertain = 0;
  for (const target of procs) {
    const now = byPid.get(target.pid);
    if (!now) {
      gone += 1;
      continue;
    }
    if (now.command !== target.command) {
      mismatched += 1;
      continue;
    }
    // Same command, another start time: maybe the same app relaunched, maybe a changed time zone.
    // Not signalled, not forgotten.
    if (now.start !== target.start) {
      uncertain += 1;
      continue;
    }
    if (seams.uid < 0 || now.uid !== seams.uid) {
      notOurs += 1;
      continue;
    }
    try {
      const sent = seams.signal(target.pid, "SIGCONT");
      if (sent === "sent") count += 1;
      else if (sent === "denied") notOurs += 1;
      else gone += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) throw new Error("some processes could not be resumed");
  if (uncertain > 0) throw new Error(RETRY_OR_ALERT);
  return { count, mismatched, gone, notOurs };
}
