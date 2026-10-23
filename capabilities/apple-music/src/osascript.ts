// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one place this capability starts a process: `osascript -e <FIXED SCRIPT> <args...>`, no
// shell. `script` is always one of the constants in scripts.ts; the only variable parts are
// `args`, which AppleScript reads as data (`on run argv`) and never parses as code.
import { execFile } from "node:child_process";
import { PlayerError } from "./errors";

export interface OsaLimits {
  /** Output cap in bytes (default 256 KB, never above 1 MB); more rejects with kind `too_large`. */
  maxOutputBytes?: number;
}

/** Runs a fixed script with data arguments and resolves with its trimmed output. */
export type OsaRunner = (
  script: string,
  args: readonly string[],
  limits?: OsaLimits,
) => Promise<string>;

export const OSASCRIPT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const HARD_MAX_OUTPUT_BYTES = 1024 * 1024;
/** AppleScript error number for "not authorised to send Apple events". */
const NOT_AUTHORISED = /-1743/;

export const osascriptRunner: OsaRunner = (script, args, limits) => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const maxBuffer = Math.min(limits?.maxOutputBytes ?? MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES);
  execFile(
    "osascript",
    ["-e", script, ...args],
    { timeout: OSASCRIPT_TIMEOUT_MS, maxBuffer, windowsHide: true },
    (error, stdout, stderr) => {
      if (!error) return resolve(stdout.trim());
      if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return reject(new PlayerError("too_large", "The player's answer was too large"));
      }
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
