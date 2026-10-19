// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one place this capability starts a process: `osascript -e <FIXED SCRIPT> <args...>`, no
// shell. `script` is always one of the constants in scripts.ts; the only variable parts are
// `args`, which AppleScript reads as data (`on run argv`) and never parses as code.
import { execFile } from "node:child_process";
import { PlayerError } from "./errors";

/** Runs a fixed script with data arguments and resolves with its trimmed output. */
export type OsaRunner = (script: string, args: readonly string[]) => Promise<string>;

export const OSASCRIPT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
/** AppleScript error number for "not authorised to send Apple events". */
const NOT_AUTHORISED = /-1743/;

export const osascriptRunner: OsaRunner = (script, args) => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(
    "osascript",
    ["-e", script, ...args],
    { timeout: OSASCRIPT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
    (error, stdout, stderr) => {
      if (!error) return resolve(stdout.trim());
      if (NOT_AUTHORISED.test(stderr)) {
        return reject(
          new PlayerError(
            "permission",
            "macOS has not allowed Phoenix to control this app: enable it under System Settings > Privacy & Security > Automation",
          ),
        );
      }
      // stderr is not forwarded: it can carry track names or paths.
      reject(new PlayerError("player", "The player did not answer"));
    },
  );
  return promise;
};
