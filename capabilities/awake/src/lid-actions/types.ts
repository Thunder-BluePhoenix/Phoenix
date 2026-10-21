// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared shapes of the lid-close actions (Phase 74). Every OS effect an action can have goes
// through one of the seams below, so tests use recording fakes and nothing real can be frozen,
// muted, dimmed or written.
import type { AwakeEnv, Runner } from "../system";
import type { Fields } from "../power/format";
import type { HelperClient } from "../power/helper-client";
import type { RecoveryManager } from "../power/reconcile";

/** In the order they are applied; undo runs in the reverse order (the journal is walked newest first). */
export const ACTION_IDS = [
  "app_nap",
  "freeze_apps",
  "docker_freeze",
  "mute",
  "low_power",
  "display",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

/** Marks every journal entry this module writes, so undo never touches another module's entries. */
export const LID_MARK = "lid_actions";

/** One process as the process table shows it. `start` is `ps -o lstart=`, the proof of identity. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  /** The owning user id (`ps -o uid=`). Only processes of Phoenix's own user are ever signalled. */
  uid: number;
  /** The `ps` state column; a state starting with `T` is already stopped. */
  state: string;
  start: string;
  /** The executable path as `ps -o comm=` prints it. */
  command: string;
}

/** Lists every process. Throws when the table cannot be read (then nothing is signalled). */
export type ProcessLister = () => Promise<ProcInfo[]>;

export type Signal = "SIGSTOP" | "SIGCONT";

/**
 * The only way a signal is ever sent. `gone`: the process no longer exists. `denied`: the system
 * refused (EPERM: the process is not Phoenix's to signal). Throws on any other failure. The real
 * one (real.ts) is the only code in this module that calls `process.kill`.
 */
export type Signaler = (pid: number, signal: Signal) => "sent" | "gone" | "denied";

export interface AudioDevice {
  /** Stable id of the output device. */
  id: string;
  /** null: the mute state could not be read, so the device is never touched. */
  muted: boolean | null;
  /**
   * The device's name, the proof of which output this is. Absent or null: the adapter could not
   * learn it (the record is then marked `identity: unknown` and undone by id alone).
   */
  name?: string | null;
}

export interface AudioControl {
  listOutputs(): Promise<AudioDevice[]>;
  /** The id of the current default output, or null when there is none. */
  defaultOutputId(): Promise<string | null>;
  /**
   * How `setMuted` finds its device. `default_only`: whatever the current default output is at the
   * moment of the call (the id is only a placeholder), so the default's NAME is the identity check.
   */
  readonly addressing: "default_only" | "by_id";
  setMuted(id: string, muted: boolean): Promise<void>;
}

/** Docker's view, from Phoenix's Docker capability. Unknown means "do not freeze". */
export type DockerIdleState = "idle" | "busy" | "unknown";
export type DockerIdle = () => Promise<DockerIdleState>;

/** Whether the user is in a meeting, recording or dictating. Unknown means "do not freeze". */
export type ProtectedActivity = "idle" | "active" | "unknown";
export type ProtectedState = () => ProtectedActivity;

/** Process ids of the coding agents Phoenix tracks right now. */
export type AgentPids = () => readonly number[];

/** Owner and permission bits of a file (read-only), or null when it cannot be read. */
export type FileStat = (path: string) => Promise<{ uid: number; mode: number } | null>;

export interface LidSeams {
  platform: AwakeEnv["platform"];
  run: Runner;
  processes: ProcessLister;
  signal: Signaler;
  audio: AudioControl;
  dockerIdle: DockerIdle;
  protectedState: ProtectedState;
  agentPids: AgentPids;
  /** Phoenix's own pid; it and its process tree are never signalled. */
  selfPid: number;
  /** Phoenix's own user id; processes of other users are never targets. -1: unknown, so none. */
  uid: number;
  stat: FileStat;
  helper: HelperClient;
  /** Journal kinds that still need undoing (so Low Power Mode is not journalled twice). */
  pendingKinds: () => readonly string[];
}

export type SkipReason =
  | "unsupported_platform"
  | "helper_unavailable"
  | "tool_missing"
  | "already_on"
  | "state_unknown"
  | "protected_state"
  | "docker_busy"
  | "docker_unknown"
  | "process_list_unavailable"
  | "assertions_unknown"
  | "holds_assertion"
  | "audio_unavailable"
  | "no_targets"
  | "nothing_to_do";

/** Skips that are routine; every other skip is announced with an `awake.lid_action.failed` event. */
export const QUIET_SKIPS: Readonly<Partial<Record<SkipReason, true>>> = {
  already_on: true,
  protected_state: true,
  holds_assertion: true,
  docker_busy: true,
  no_targets: true,
  nothing_to_do: true,
};

export interface PlanContext {
  session: string;
  /** The process table, read once per lid close. Null when it could not be read. */
  procs(): Promise<ProcInfo[] | null>;
  /** Records why `plan` returns null, and returns null (`return ctx.skip("no_targets")`). */
  skip(reason: SkipReason): null;
}

export interface Planned {
  /** What is written down as "apply" (also what `apply` reads). */
  apply: Fields;
  /** Everything needed to undo it, with nothing kept in memory. */
  undo: Fields;
  /** How many things it changes (processes, devices, apps). */
  count: number;
  /** Table keys of what is affected (never process names). */
  targets?: string[];
  /** Plain facts for the user, for example `brightness_tool_missing`. */
  notes?: string[];
}

/**
 * The error message of an undo that found a process with the recorded command but another start
 * time: it may be the same app relaunched (or a changed time zone), so the entry stays pending and
 * the user is told, instead of being dropped as "not ours".
 */
export const RETRY_OR_ALERT = "retry_or_alert";

/**
 * An undo note: the default sound output is not the one that was muted. The new default is NOT
 * unmuted (it is not Phoenix's change), the old output stays as it is, and the user is told.
 */
export const OUTPUT_CHANGED = "output_changed";

/** A note: the output's name could not be read, so it was restored by id alone. */
export const OUTPUT_IDENTITY_UNKNOWN = "output_identity_unknown";

/**
 * Undo errors that trying again at once cannot fix (the world has to change first): the entry
 * stays pending and the user is told, but the engine does not retry them in a loop.
 */
export function isSettledUndoError(message: string | undefined): boolean {
  return message === RETRY_OR_ALERT || message === OUTPUT_CHANGED;
}

export interface ActionUndone {
  count: number;
  /** Processes whose identity no longer matched: reported, never signalled. */
  mismatched?: number;
  gone?: number;
  /** Processes Phoenix may not signal (another user's, or EPERM): reported, never retried, never left pending. */
  notOurs?: number;
  /** Plain facts for the user (fixed codes), for example `output_changed`. */
  notes?: string[];
}

export interface ActionSupport {
  supported: boolean;
  /** Parts of the action this machine cannot do although the rest works (fixed codes). */
  limits?: string[];
  /** Why not: a fixed code the web UI has text for. */
  reason?: SkipReason;
}

export interface LidAction {
  id: ActionId;
  /** The journal kind. */
  kind: string;
  /** Decides what to do and what undoes it. Reads only; null means do nothing (see `ctx.skip`). */
  plan(ctx: PlanContext): Promise<Planned | null>;
  /** Makes the change. Runs only after the journal holds `planned`. */
  apply(planned: Planned): Promise<void>;
  /**
   * Undoes it from the recorded `undo` data alone (everything needed is IN the journal entry).
   * Idempotent; throws if it could not. Absent when the Recovery module already registers how this
   * kind is undone (Low Power Mode: `pmset.lowpowermode`).
   */
  undo?(undo: Fields): Promise<ActionUndone>;
  /** Whether this machine can do it, by reading only (never changing anything). */
  support(): Promise<ActionSupport>;
}

/** The part of Recovery's manager the engine uses (a test or another host may supply its own). */
export type RecoveryPort = Pick<
  RecoveryManager,
  "change" | "undo" | "markSessionEnded" | "canQuit"
>;

export type ReleaseWhy =
  "lid_opened" | "session_ended" | "disabled" | "kill_switch" | "shutdown" | "simulated";

export type ActionOutcome = "applied" | "skipped" | "failed" | "undone" | "undo_failed";

/** What one action did in one lid event. Fixed codes and counts only: no names, no paths. */
export interface ActionResult {
  action: ActionId;
  outcome: ActionOutcome;
  reason?: string;
  count?: number;
  mismatched?: number;
  gone?: number;
  notOurs?: number;
  notes?: string[];
}

export interface LidRun {
  event: "closed" | "opened";
  at: number;
  session_id: string | null;
  why?: ReleaseWhy;
  results: ActionResult[];
}
