// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Stopping a process the user saw in the radar. The rules, each pinned by a test:
//   - nothing is signalled from a name, a port or a pid alone: the caller must present the
//     {pid, start time, command, uid} the user saw, and every one of them must equal what a FRESH
//     read of the process table says right before the signal (a reused pid has another start time);
//   - the port named in the prompt must still be listened on by that pid (the prompt told the user
//     which port is being freed);
//   - `stopRefusal` (policy.ts) is evaluated on the fresh row: same user only, never pid <= 1,
//     never Core, its parent, ancestors or process group, never a protected or system process;
//   - `stop_process` sends SIGTERM only. SIGKILL exists only in `force_stop`, a SECOND command with
//     its own confirmation, and only for a process this capability sent SIGTERM to, at least
//     FORCE_AFTER_MS ago, that is still the same process;
//   - all signals go through the injected `Signaler`; the real one refuses pid < 2 and Core's pid.
//   - there is no restart: restarting needs the original command line, which Phoenix cannot rebuild
//     safely from `ps`.
import { collectListeners, readOneProcess, readProcessTable } from "./collect";
import { LSTART_PATTERN } from "./parse";
import { stopRefusal } from "./policy";
import { PortsError, type PortsEnv, type ProcRow, type StopSignal } from "./types";

/** How long `stop_process` watches for the process to exit after SIGTERM. */
export const TERM_WAIT_MS = 3_000;
export const TERM_POLL_MS = 250;
/** `force_stop` is refused until this long after the SIGTERM it follows. */
export const FORCE_AFTER_MS = 5_000;
/** SIGTERM records older than this are forgotten (the process may long be gone or replaced). */
export const TERM_RECORD_TTL_MS = 10 * 60_000;
const MAX_TERM_RECORDS = 50;
const KILL_WAIT_MS = 500;

export interface StopTarget {
  pid: number;
  port: number;
  start: string;
  command: string;
  uid: number;
}

export interface StopResult {
  pid: number;
  port: number;
  /** Executable file name only. */
  name: string;
  signal: StopSignal;
  /** "sent", or "gone" when the process had already ended. */
  outcome: "sent" | "gone";
  /** Whether the process was gone when the wait ended. */
  exited: boolean;
  /** True when SIGTERM did not end it and `force_stop` is the next explicit step. */
  can_force: boolean;
}

const hasControl = (text: string) => /[\p{Cc}\p{Cf}]/u.test(text);

/** The input of both commands, validated field by field; anything else is `invalid`. */
export function parseTarget(input: unknown): StopTarget {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new PortsError("invalid", "input must be an object");
  }
  const allowed = new Set(["pid", "port", "start", "command", "uid"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new PortsError("invalid", `unknown field "${key}"`);
  }
  const pid: unknown = Reflect.get(input, "pid");
  const port: unknown = Reflect.get(input, "port");
  const start: unknown = Reflect.get(input, "start");
  const command: unknown = Reflect.get(input, "command");
  const uid: unknown = Reflect.get(input, "uid");
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 2) {
    throw new PortsError("invalid", "pid must be an integer of at least 2");
  }
  if (typeof port !== "number" || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new PortsError("invalid", "port must be 1 to 65535");
  }
  if (typeof start !== "string" || !LSTART_PATTERN.test(start)) {
    throw new PortsError("invalid", "start must be the process start time shown by the radar");
  }
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    command.length > 1024 ||
    hasControl(command)
  ) {
    throw new PortsError("invalid", "command must be the executable shown by the radar");
  }
  if (typeof uid !== "number" || !Number.isSafeInteger(uid) || uid < 0) {
    throw new PortsError("invalid", "uid must be a non-negative integer");
  }
  return { pid, port, start, command, uid };
}

const fileName = (command: string): string => command.slice(command.lastIndexOf("/") + 1);

export interface Stopper {
  stop(target: StopTarget, signal: AbortSignal): Promise<StopResult>;
  force(target: StopTarget, signal: AbortSignal): Promise<StopResult>;
  /** Forgets every SIGTERM record (capability disabled). */
  reset(): void;
}

export function createStopper(env: PortsEnv, onSignalled: (r: StopResult) => void): Stopper {
  /** `pid\0start` -> when SIGTERM was sent. In memory only: a restart forgets it, and `force_stop` then refuses. */
  const termed = new Map<string, number>();
  const keyOf = (t: StopTarget) => `${t.pid}\0${t.start}`;

  /**
   * The fresh row, proven equal to what the user saw and allowed by the stop rules. Order matters:
   * the listeners are collected FIRST (the slow read), the process table next (only for the
   * ancestry rules), and the identity of the one target is read LAST, with `ps -p <pid>`,
   * immediately before the caller signals. The time between that read and the signal is one
   * function return and one `kill` call, not a listener scan. It cannot be zero: see the docs.
   */
  async function prove(target: StopTarget): Promise<ProcRow | undefined> {
    const { listeners } = await collectListeners(env);
    const listening = listeners.some((l) => l.pid === target.pid && l.port === target.port);
    const { rows } = await readProcessTable(env.run);
    const table = new Map(rows.map((r) => [r.pid, r]));
    const { row, ambiguous } = await readOneProcess(env.run, target.pid);
    if (ambiguous) {
      throw new PortsError(
        "changed",
        "The process list for that process was not a single clear row. Refresh and look again.",
      );
    }
    if (row === undefined) return undefined;
    if (row.start !== target.start || row.command !== target.command || row.uid !== target.uid) {
      throw new PortsError(
        "changed",
        "That process is no longer the one the radar showed. Refresh and look again.",
      );
    }
    table.set(row.pid, row);
    const refusal = stopRefusal(row, {
      platform: env.platform,
      uid: env.uid,
      pid: env.pid,
      ppid: env.ppid,
      home: env.home,
      table,
    });
    if (refusal !== undefined) {
      throw new PortsError("refused", "Phoenix will not stop that process", refusal);
    }
    if (!listening) {
      throw new PortsError("changed", "That process no longer listens on that port.");
    }
    return row;
  }

  /** True when the process with this pid AND start time is no longer there. */
  async function exitedNow(target: StopTarget): Promise<boolean> {
    const { row, ambiguous } = await readOneProcess(env.run, target.pid);
    return !ambiguous && (row === undefined || row.start !== target.start);
  }

  async function waitForExit(target: StopTarget, totalMs: number, signal: AbortSignal) {
    for (let waited = 0; waited < totalMs && !signal.aborted; waited += TERM_POLL_MS) {
      await env.sleep(TERM_POLL_MS, signal);
      if (await exitedNow(target)) return true;
    }
    return signal.aborted ? false : await exitedNow(target);
  }

  function forget(now: number): void {
    for (const [key, at] of termed) if (now - at > TERM_RECORD_TTL_MS) termed.delete(key);
    while (termed.size > MAX_TERM_RECORDS) termed.delete(termed.keys().next().value as string);
  }

  function send(target: StopTarget, signal: StopSignal): "sent" | "gone" {
    let outcome;
    try {
      outcome = env.kill(target.pid, signal);
    } catch {
      throw new PortsError("unavailable", "The signal could not be sent");
    }
    if (outcome === "denied") {
      throw new PortsError("refused", "The system refused to signal that process", "other_user");
    }
    return outcome;
  }

  function resultOf(
    target: StopTarget,
    signal: StopSignal,
    outcome: "sent" | "gone",
    exited: boolean,
  ): StopResult {
    return {
      pid: target.pid,
      port: target.port,
      name: fileName(target.command),
      signal,
      outcome,
      exited,
      can_force: signal === "SIGTERM" && !exited,
    };
  }

  return {
    async stop(target, abort) {
      forget(env.now());
      const row = await prove(target);
      if (row === undefined) {
        throw new PortsError("not_listed", "That process has already ended.");
      }
      const outcome = send(target, "SIGTERM");
      if (outcome === "gone") {
        const result = resultOf(target, "SIGTERM", "gone", true);
        onSignalled(result);
        return result;
      }
      termed.set(keyOf(target), env.now());
      const exited = await waitForExit(target, TERM_WAIT_MS, abort);
      const result = resultOf(target, "SIGTERM", "sent", exited);
      onSignalled(result);
      return result;
    },

    async force(target, abort) {
      const now = env.now();
      forget(now);
      const termAt = termed.get(keyOf(target));
      if (termAt === undefined) {
        throw new PortsError(
          "term_first",
          "Stop the process normally first. Force stop only follows a stop that did not end it.",
        );
      }
      const waitLeft = FORCE_AFTER_MS - (now - termAt);
      if (waitLeft > 0) {
        throw new PortsError(
          "too_early",
          `Give the process a moment to finish. Try again in ${Math.ceil(waitLeft / 1000)} seconds.`,
        );
      }
      const row = await prove(target);
      if (row === undefined) {
        termed.delete(keyOf(target));
        throw new PortsError("not_listed", "That process has already ended.");
      }
      const outcome = send(target, "SIGKILL");
      termed.delete(keyOf(target));
      const exited = outcome === "gone" || (await waitForExit(target, KILL_WAIT_MS, abort));
      const result = resultOf(target, "SIGKILL", outcome, exited);
      onSignalled(result);
      return result;
    },

    reset() {
      termed.clear();
    },
  };
}
