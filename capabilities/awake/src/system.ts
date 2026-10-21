// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared seams for every Awake module (Phases 72-75). Every OS effect goes through these
// interfaces, so tests use recording fakes and no unit test can touch the real machine.
// Owned by Awake72: other modules import from here and must not change it.
import { execFile, spawn } from "node:child_process";
import type {
  CapabilityContext,
  CapabilityManifest,
  CommandHandler,
  CommandSpec,
  Permission,
} from "@phoenix/sdk";

export type Platform = "darwin" | "linux" | "win32";

export interface RunOptions {
  timeoutMs?: number;
  stdin?: string;
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

/** A long-lived child process (for example `caffeinate`). */
export interface SpawnedChild {
  readonly pid: number | undefined;
  /** Resolves once the process has exited or failed to start, with its exit code (null if none). */
  readonly exited: Promise<number | null>;
  /** Terminates the process. Idempotent; a no-op once it has exited. */
  kill(): void;
}

/** Starts a long-lived child. argv array only, never a shell string. Throws if it cannot start. */
export type Spawner = (file: string, args: readonly string[]) => SpawnedChild;

export type TimerHandle = NodeJS.Timeout | number;

export interface AwakeClock {
  /** Epoch milliseconds. */
  now(): number;
  setTimer(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

/** Everything an Awake module needs from the host machine. */
export interface AwakeEnv {
  platform: Platform;
  /** Core's own pid: a macOS hold is tied to it (`caffeinate -w`), so a killed Core frees the machine. */
  pid: number;
  run: Runner;
  spawn: Spawner;
  clock: AwakeClock;
}

const OUTPUT_LIMIT_BYTES = 1 << 20;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Maps an execFile callback to a RunResult. Node's error message is NEVER passed on: it begins
 * with `Command failed: <file> <argv>` (a hotspot password can sit in argv) or `spawn <file>
 * ENOENT`. A failure with no stderr of its own gets the fixed text `exec_failed`.
 */
export function runResultFromExec(
  err: (Error & { code?: unknown }) | null,
  stdout: string,
  stderr: string,
): RunResult {
  if (err === null) return { code: 0, stdout, stderr };
  const code = typeof err.code === "number" ? err.code : null;
  return { code, stdout, stderr: stderr || "exec_failed" };
}

export const realRunner: Runner = (file, args, opts = {}) => {
  const done = Promise.withResolvers<RunResult>();
  const child = execFile(
    file,
    [...args],
    {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: OUTPUT_LIMIT_BYTES,
      windowsHide: true,
      encoding: "utf8",
    },
    (err, stdout, stderr) => done.resolve(runResultFromExec(err, stdout, stderr)),
  );
  if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
  return done.promise;
};

export const realSpawner: Spawner = (file, args) => {
  const exited = Promise.withResolvers<number | null>();
  const child = spawn(file, [...args], { stdio: "ignore", windowsHide: true });
  // Last resort when Core exits without running shutdown(); the child's own timer covers a crash.
  const killOnExit = () => child.kill("SIGTERM");
  process.once("exit", killOnExit);
  child.once("exit", (code) => {
    process.off("exit", killOnExit);
    exited.resolve(code);
  });
  child.once("error", () => {
    process.off("exit", killOnExit);
    exited.resolve(null);
  });
  return {
    pid: child.pid,
    exited: exited.promise,
    kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    },
  };
};

export const realClock: AwakeClock = {
  now: () => Date.now(),
  setTimer(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  clearTimer: (handle) => clearTimeout(handle),
};

export function isPlatform(value: string): value is Platform {
  return value === "darwin" || value === "linux" || value === "win32";
}

/** The real machine. Other platforms fall back to "linux": `systemd-inhibit` then fails to start and the session is refused. */
export function realEnv(): AwakeEnv {
  return {
    platform: isPlatform(process.platform) ? process.platform : "linux",
    pid: process.pid,
    run: realRunner,
    spawn: realSpawner,
    clock: realClock,
  };
}

// ── Registration seam (Phases 72-75) ─────────────────────────────────────────

/** Why an Awake command was refused. Messages never contain secrets or remote text. */
export type AwakeErrorKind =
  "invalid" | "conflict" | "no_session" | "limit" | "battery_low" | "unavailable" | "cancelled";

export class AwakeError extends Error {
  constructor(
    readonly kind: AwakeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AwakeError";
  }
}

/** The part of a bus event the Awake modules read. */
export interface FeedEvent {
  event_type: string;
  /** The publishing capability's id (the bus envelope's `source`). Core's own events say "core". */
  source?: string;
  payload?: Record<string, unknown>;
}

/** Read access to Core's event bus; structurally an `EventBus`. Absent in a bare harness. */
export interface AgentEventFeed {
  subscribe(
    id: string,
    patterns: string | readonly string[],
    handler: (event: FeedEvent) => void | Promise<void>,
  ): () => void;
}

/** What every module receives when the capability starts. */
export interface AwakeDeps {
  env: AwakeEnv;
  /** The one keep-awake session; modules end it or read it through this port. */
  session: SessionPort;
  /** Current battery reading (platform source or an injected fake). */
  battery: () => Promise<BatteryReading>;
  /** Bus access, when Core supplied it. */
  feed: AgentEventFeed | undefined;
  /** Milliseconds between battery reads while a session runs. */
  batteryPollMs: number;
}

export type BatteryReading =
  { kind: "battery"; percent: number; onBattery: boolean } | { kind: "none" } | { kind: "unknown" };

/**
 * One phase's contribution to the single `awake` capability. `composeAwake` (index.ts) merges
 * the commands, specs, events, state rules and lifecycle of every module in its list.
 */
export interface AwakeModule {
  commands: Record<string, CommandHandler>;
  commandSpecs: CommandSpec[];
  events: string[];
  stateRules: NonNullable<CapabilityManifest["state_rules"]>;
  /** JSON-Schema `properties` this module adds to the capability's config schema. */
  configProperties?: Record<string, unknown>;
  /** Manifest permissions this module needs beyond `shell_command` (deduped by composeAwake). */
  permissions?: Permission[];
  /** Credentials this module needs; merged into the manifest's `secrets`. */
  secrets?: { name: string; description: string }[];
  init?(ctx: CapabilityContext, deps: AwakeDeps): void;
  /** Must release every OS effect synchronously. Called on disable and on Core exit. */
  shutdown?(): void;
}

/** Why a session ended; this is the `reason` of `awake.session.ended`. "thermal" is for Phase 73 floors. */
export type SessionEndReason =
  | "expired"
  | "cancelled"
  | "battery"
  | "thermal"
  | "shutdown"
  | "disabled"
  | "kill_switch"
  | "agents_done"
  /** The hold process died or could not be renewed while the session was still running. */
  | "inhibitor_lost";

export interface ActiveSession {
  /** Same value as `session_id` in the awake.session.* event payloads. */
  id: string;
  mode: "timed" | "agents_grace";
  startedAt: number;
  /** Epoch ms the session ends. null while an agents_grace session is held by working agents. */
  endsAt: number | null;
}

export interface SessionPort {
  /** The running session, or null. */
  active(): ActiveSession | null;
  /** Ends the running session and releases the hold. Idempotent; no-op when none. */
  end(reason: SessionEndReason): void;
}
