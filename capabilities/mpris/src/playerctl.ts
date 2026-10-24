// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one place this capability starts a process: `playerctl <args...>`, with no shell. The program
// name is fixed here; `args` are built only by player.ts from validated values (a player name that
// matched PLAYER_NAME, whole numbers, and words from a fixed list), so nothing a player says and
// nothing a caller types can become an option or a second command.
import { execFile } from "node:child_process";
import { PlayerError } from "./errors";

export interface RunLimits {
  /** Output cap in bytes (default 64 KB, never above 256 KB); more rejects with kind `too_large`. */
  maxOutputBytes?: number;
}

/** Runs `playerctl` with these arguments and resolves with its trimmed standard output. */
export type PlayerctlRunner = (args: readonly string[], limits?: RunLimits) => Promise<string>;

export const PLAYERCTL_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const HARD_MAX_OUTPUT_BYTES = 256 * 1024;

export const playerctlRunner: PlayerctlRunner = (args, limits) => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const maxBuffer = Math.min(limits?.maxOutputBytes ?? MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES);
  execFile(
    "playerctl",
    [...args],
    { timeout: PLAYERCTL_TIMEOUT_MS, maxBuffer, windowsHide: true, encoding: "utf8" },
    (error, stdout) => {
      if (!error) return resolve(stdout.trim());
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return reject(
          new PlayerError("missing_tool", "playerctl is not installed (it provides MPRIS control)"),
        );
      }
      if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return reject(new PlayerError("too_large", "The player's answer was too large"));
      }
      // stderr and the exit code are not forwarded: they can carry track names or bus names.
      reject(new PlayerError("player", "The player did not answer"));
    },
  );
  return promise;
};
