// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What actually keeps the machine awake: one child process per hold, chosen by platform.
// Every child is bounded by its own timer (caffeinate -t, `sleep N`, the loop in the Windows
// script), so it expires by itself even if Phoenix is killed. On macOS the child is also tied to
// Core's pid (`caffeinate -w`), so a SIGKILLed Core frees the machine at once instead of at the end
// of a session that may run for days; elsewhere the session controller keeps each hold short and
// renews it (see `Inhibitor.parentBound`). Argv arrays only; no shell.
import { AwakeError, type AwakeEnv, type Platform, type SpawnedChild } from "./system";

/** Longest single hold: the longest session (7 days). */
export const MAX_HOLD_SECONDS = 7 * 24 * 3600;

/** A running hold. `release` is idempotent. */
export interface InhibitHandle {
  /** The child's pid, for tests and the real-OS smoke test only; never put it in status output. */
  readonly pid: number | undefined;
  /** Resolves when the child has exited (released, expired, crashed or failed to start). */
  readonly exited: Promise<number | null>;
  release(): void;
}

export interface Inhibitor {
  /**
   * True when a hold ends by itself as soon as Core's process is gone (macOS `caffeinate -w`), so
   * one hold may span a whole session. False: the hold only ends at its own timer, so the session
   * must run it in short pieces and renew them.
   */
  readonly parentBound: boolean;
  /** Starts a hold that ends by itself after `seconds`. Throws AwakeError if it cannot start. */
  acquire(seconds: number): InhibitHandle;
}

/** Shown by `systemd-inhibit --list`. Fixed text: nothing a user or an agent wrote. */
const LINUX_WHY = "Phoenix keep-awake session";

/**
 * Windows: SetThreadExecutionState is a native call Node cannot make, so a small PowerShell child
 * makes it in a loop for the session. The script is a constant. The only variable part is the
 * validated integer passed as a separate argv element, which PowerShell binds to `$Seconds` (a
 * [int] parameter, so anything non-numeric fails to bind instead of being evaluated).
 * 2147483651 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED, 2147483648 = ES_CONTINUOUS.
 * UNVERIFIED: never run on Windows.
 */
export const WINDOWS_SCRIPT = [
  "& { param([int]$Seconds)",
  "$sig = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
  "$api = Add-Type -MemberDefinition $sig -Name PhoenixPower -Namespace Phoenix -PassThru",
  "$end = [DateTime]::UtcNow.AddSeconds($Seconds)",
  "while ([DateTime]::UtcNow -lt $end) { [void]$api::SetThreadExecutionState([uint32]2147483651); Start-Sleep -Seconds 20 }",
  "[void]$api::SetThreadExecutionState([uint32]2147483648) }",
].join("\n");

export interface HoldCommand {
  file: string;
  args: string[];
}

/** Whether `platform`'s hold command ends by itself when `parentPid` (Core) exits. */
export function holdIsParentBound(platform: Platform): boolean {
  return platform === "darwin";
}

/**
 * The exact command for a hold; throws on anything but an integer number of seconds in range and a
 * positive integer pid. `parentPid` is Core's own pid: macOS ties the hold to it (`caffeinate -w`).
 */
export function holdCommand(platform: Platform, seconds: number, parentPid: number): HoldCommand {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_HOLD_SECONDS) {
    throw new AwakeError("invalid", "seconds must be an integer between 1 and 604800");
  }
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) {
    throw new AwakeError("invalid", "parent pid must be a positive integer");
  }
  const n = String(seconds);
  switch (platform) {
    case "darwin":
      return {
        file: "caffeinate",
        args: ["-d", "-i", "-s", "-t", n, "-w", String(parentPid)],
      };
    case "linux":
      return {
        file: "systemd-inhibit",
        args: ["--what=idle:sleep", "--who=Phoenix", `--why=${LINUX_WHY}`, "sleep", n],
      };
    case "win32":
      return {
        file: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          WINDOWS_SCRIPT,
          n,
        ],
      };
  }
}

export function createInhibitor(env: AwakeEnv): Inhibitor {
  return {
    parentBound: holdIsParentBound(env.platform),
    acquire(seconds) {
      const { file, args } = holdCommand(env.platform, seconds, env.pid);
      let child: SpawnedChild;
      try {
        child = env.spawn(file, args);
      } catch {
        throw new AwakeError("unavailable", `Could not start ${file} to keep the computer awake`);
      }
      // A process that could not start has no pid (ENOENT, EACCES): refuse instead of pretending.
      if (child.pid === undefined) {
        child.kill();
        throw new AwakeError("unavailable", `Could not start ${file} to keep the computer awake`);
      }
      let gone = false;
      let released = false;
      void child.exited.then(() => {
        gone = true;
      });
      return {
        pid: child.pid,
        exited: child.exited,
        release() {
          if (released) return;
          released = true;
          if (!gone) child.kill();
        },
      };
    },
  };
}
