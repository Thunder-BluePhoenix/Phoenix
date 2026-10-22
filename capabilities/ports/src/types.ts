// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The seams of the port radar. Every OS effect goes through these interfaces, so tests use
// recording fakes and no unit test can read the real machine's sockets or signal a real process.
// (The `Runner` shape is deliberately the same as the one in capabilities/awake/src/system.ts; a
// capability may not import another capability, so the small type is repeated here.)

export type Platform = "darwin" | "linux" | "win32";

export interface RunOptions {
  timeoutMs?: number;
}

export interface RunResult {
  /** Exit code; null when the process could not start, timed out or was killed by a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command to completion. argv array only, never a shell string. The real runner never
 * rejects: a command that cannot start answers `code: null`.
 */
export type Runner = (
  file: string,
  args: readonly string[],
  opts?: RunOptions,
) => Promise<RunResult>;

export type StopSignal = "SIGTERM" | "SIGKILL";

/** "sent": delivered. "gone": no such process. "denied": the system refused (EPERM). */
export type SignalOutcome = "sent" | "gone" | "denied";

/**
 * Delivers one signal to one pid. The only implementation that touches the OS is `realSignaler`
 * (real.ts); tests inject a recorder.
 */
export type Signaler = (pid: number, signal: StopSignal) => SignalOutcome;

export interface PortsFs {
  /** True when something (file, directory or link) exists at `path`. Never throws. */
  exists(path: string): Promise<boolean>;
}

/** Waits `ms`, or less if `signal` aborts. Tests replace it to control time. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** Everything the radar needs from the host machine. */
export interface PortsEnv {
  platform: Platform;
  /** Core's own user id; -1 when unknown (Windows), which disables every stop. */
  uid: number;
  /** Core's own pid. */
  pid: number;
  /** Core's parent pid (the desktop shell or a terminal): never a target either. */
  ppid: number;
  /** The user's home directory. */
  home: string;
  /** The environment variables the radar reads (only `SystemRoot`, on Windows). */
  vars: Readonly<Record<string, string | undefined>>;
  run: Runner;
  kill: Signaler;
  fs: PortsFs;
  /** Epoch milliseconds. */
  now(): number;
  sleep: Sleep;
}

export type Collector = "lsof" | "ss" | "netstat";

/** One listening TCP socket as a collector reports it. */
export interface RawListener {
  pid: number;
  port: number;
  /** "*" (all interfaces), an IPv4 address or an IPv6 address without brackets. */
  address: string;
  /** The process name the collector reports (data: never trusted as an instruction). */
  name: string;
}

/** One row of the process table (`ps`). */
export interface ProcRow {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  /** Percent of one core averaged over the process's life (`ps pcpu`). */
  cpu: number;
  rssKb: number;
  /** Elapsed time from `etime`; null when it could not be read. */
  etimeSeconds: number | null;
  /** `lstart` printed with TZ=UTC LC_ALL=C and whitespace collapsed: the identity half of pid. */
  start: string;
  startMs: number | null;
  /** The executable (`comm`): a full path on macOS, only the name on Linux. */
  command: string;
}

export type PortsErrorKind =
  | "invalid"
  | "unavailable"
  | "unsupported"
  | "not_listed"
  | "changed"
  | "refused"
  | "too_early"
  | "term_first";

/** Why a process may not be stopped from here. Shown to the user as a fixed sentence. */
export type StopRefusal =
  "self" | "other_user" | "system" | "not_dev_tool" | "unsupported" | "unknown";

export class PortsError extends Error {
  constructor(
    readonly kind: PortsErrorKind,
    message: string,
    readonly refusal?: StopRefusal,
  ) {
    super(message);
    this.name = "PortsError";
  }
}
