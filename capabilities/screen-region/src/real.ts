// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real runner: a thin execFile adapter. argv only, no shell. Nothing in this file runs in a
// normal test (tests inject a fake Runner).
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import type { RegionCaptureEnv, Runner } from "./capture";

export const realRunner: Runner = (file, args, { timeoutMs, signal }) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve({ code: null, timedOut: false, aborted: true });
    execFile(
      file,
      [...args],
      {
        timeout: timeoutMs,
        // A hard kill: the timeout must end the program, not ask it to.
        killSignal: "SIGKILL",
        signal,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
      (err) => {
        if (err === null) return resolve({ code: 0, timedOut: false, aborted: false });
        // Node's message begins with the command line; it is never passed on.
        const failure = err as Error & { code?: unknown; killed?: boolean };
        if (signal.aborted) return resolve({ code: null, timedOut: false, aborted: true });
        if (failure.killed) return resolve({ code: null, timedOut: true, aborted: false });
        resolve({
          code: typeof failure.code === "number" ? failure.code : null,
          timedOut: false,
          aborted: false,
        });
      },
    );
  });

/** The real machine: this platform, the OS temp directory, the real `execFile` runner. */
export function realEnv(): RegionCaptureEnv {
  return { platform: process.platform, tmpRoot: tmpdir(), run: realRunner };
}
