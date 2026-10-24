// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real implementations of the seams. Thin adapters: the logic that decides WHAT to read or
// signal lives elsewhere and is tested with fakes. Nothing in this file runs in a normal test.
//
// This is the ONLY file in the package that calls `process.kill` or starts a restarted program (`realSpawner`).
import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import type {
  Inspect,
  PortsEnv,
  PortsFs,
  Runner,
  RunResult,
  Signaler,
  Sleep,
  Spawner,
} from "./types";

const OUTPUT_LIMIT_BYTES = 4 << 20;
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Maps an execFile callback to a RunResult. Node's error message is NEVER passed on: it begins with
 * `Command failed: <file> <argv>`. A failure with no stderr of its own gets the fixed text
 * `exec_failed`.
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
  execFile(
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
  return done.promise;
};

/**
 * `process.kill` for one pid and one of two signals. Refuses pids that could mean "a group" or
 * "everything" (< 2, or not a safe integer) and Phoenix's own pid, whatever the caller decided.
 */
export const realSignaler: Signaler = (pid, signal) => {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid) {
    throw new Error("refused to signal that process id");
  }
  try {
    process.kill(pid, signal);
    return "sent";
  } catch (err) {
    const code = err instanceof Error ? Reflect.get(err, "code") : undefined;
    if (code === "ESRCH") return "gone";
    if (code === "EPERM") return "denied";
    throw err;
  }
};

export const realFs: PortsFs = {
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
};

export const realSleep: Sleep = (ms, signal) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) {
    resolve();
    return promise;
  }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  return promise;
};

/** realpath, then stat of the real path: symlinks are followed, so the facts are about what would run. */
export const realInspect: Inspect = async (path) => {
  try {
    const real = await realpath(path);
    const st = await stat(real);
    return {
      real,
      kind: st.isFile() ? "file" : st.isDirectory() ? "directory" : "other",
      mode: st.mode & 0o7777,
    };
  } catch {
    return undefined;
  }
};

/**
 * Starts one detached process: argv array, no shell, no stdin or output, the given working folder
 * and exactly the given environment. Rejects with the fixed text `spawn_failed`, never Node's message
 * (it contains the command line).
 */
export const realSpawner: Spawner = (request) => {
  const done = Promise.withResolvers<{ pid: number }>();
  try {
    const child = spawn(request.file, [...request.args], {
      cwd: request.cwd,
      env: { ...request.env },
      stdio: "ignore",
      detached: true,
      shell: false,
      windowsHide: true,
    });
    child.once("error", () => done.reject(new Error("spawn_failed")));
    child.once("spawn", () => {
      child.unref();
      if (child.pid === undefined) done.reject(new Error("spawn_failed"));
      else done.resolve({ pid: child.pid });
    });
  } catch {
    done.reject(new Error("spawn_failed"));
  }
  return done.promise;
};

/** The real machine. */
export function realEnv(): PortsEnv {
  const platform =
    process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
  return {
    platform,
    uid: typeof process.getuid === "function" ? process.getuid() : -1,
    pid: process.pid,
    ppid: process.ppid,
    home: homedir(),
    vars: { SystemRoot: process.env.SystemRoot },
    run: realRunner,
    kill: realSignaler,
    fs: realFs,
    now: () => Date.now(),
    sleep: realSleep,
    environ: process.env,
    inspect: realInspect,
    spawn: realSpawner,
  };
}
