// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The only privileged operations Phoenix ever asks for, and the only way it asks (Phase 73).
//
// There is no helper process and Phoenix never holds root. The "helper" is a sudoers.d rule the
// user installs from a script they have read (scripts/awake/install-helper.sh). The rule lets the
// user run EXACTLY the four command lines below without a password, and nothing else:
//
//   /usr/bin/pmset -a disablesleep 1      keep the Mac awake with the lid closed
//   /usr/bin/pmset -a disablesleep 0      undo that
//   /usr/bin/pmset -a lowpowermode 1      Low Power Mode (battery / heat floors)
//   /usr/bin/pmset -a lowpowermode 0      undo that
//
// Why lowpowermode too: `pmset -a lowpowermode` writes the system power settings, so it needs root
// like disablesleep. The floors rule ("Low Power Mode below 40 %") would otherwise be unavailable.
// Both are literal lines with no wildcard: sudoers matches a command line argument by argument, so
// `pmset -a disablesleep 1 extra` or `pmset -a displaysleep 0` do not match.
//
// `validateHelperCommand` is the single allow-list: the client checks every argv with it before
// it runs `sudo -n`, the sudoers text is generated from the same list (install.ts), and the
// backstop script carries a copy that test/power/backstop.test.ts keeps identical.
import type { Runner } from "../system";
import { NotAppliedError } from "./journal";

export const PMSET = "/usr/bin/pmset";
export const SUDO = "/usr/bin/sudo";

/** The literal command lines the sudoers rule allows, as argv. This is the allow-list. */
export const ALLOWED_HELPER_ARGV: readonly (readonly string[])[] = [
  [PMSET, "-a", "disablesleep", "1"],
  [PMSET, "-a", "disablesleep", "0"],
  [PMSET, "-a", "lowpowermode", "1"],
  [PMSET, "-a", "lowpowermode", "0"],
];

/** The same lines as the text a sudoers rule needs (single spaces, no wildcard). */
export const ALLOWED_HELPER_LINES: readonly string[] = ALLOWED_HELPER_ARGV.map((a) => a.join(" "));

export type HelperSetting = "disablesleep" | "lowpowermode";

export interface HelperCommand {
  setting: HelperSetting;
  value: 0 | 1;
  /** The exact argv, taken from the allow-list (never from the input). */
  argv: readonly string[];
}

export type HelperValidation = { ok: true; command: HelperCommand } | { ok: false; reason: string };

/**
 * Accepts only a literal allowed command: the argv array, or the one command line as a string with
 * single spaces. Everything else is rejected: extra or missing arguments, other values, other
 * paths (relative, `..`, symlink names), upper case, surrounding or trailing spaces, tabs, newlines,
 * shell metacharacters. There is no normalisation: what is checked is what would be run.
 */
export function validateHelperCommand(input: unknown): HelperValidation {
  let argv: readonly unknown[];
  if (typeof input === "string") {
    const hit = ALLOWED_HELPER_LINES.indexOf(input);
    if (hit < 0) return { ok: false, reason: "not an allowed command line" };
    argv = ALLOWED_HELPER_ARGV[hit] ?? [];
  } else if (Array.isArray(input)) {
    argv = input;
  } else {
    return { ok: false, reason: "a command is an argv array or one command line" };
  }
  for (const allowed of ALLOWED_HELPER_ARGV) {
    if (allowed.length === argv.length && allowed.every((part, i) => part === argv[i])) {
      const setting = allowed[2] === "disablesleep" ? "disablesleep" : "lowpowermode";
      return { ok: true, command: { setting, value: allowed[3] === "1" ? 1 : 0, argv: allowed } };
    }
  }
  return { ok: false, reason: "not an allowed command" };
}

/** The helper cannot be used: not installed (sudo wanted a password), sudo missing, or it refused. Nothing ran. */
export class HelperUnavailableError extends NotAppliedError {
  constructor(message: string) {
    super(message);
    this.name = "HelperUnavailableError";
  }
}

const HELPER_TIMEOUT_MS = 15_000;

export interface HelperClient {
  /** Runs one allowed command through `sudo -n`. Throws HelperUnavailableError on a non-zero exit. */
  run(argv: readonly string[]): Promise<void>;
  /**
   * Asks sudo, without running anything, whether the rule is installed (`sudo -n -l <command>`).
   * `true` when sudo lists the command, `false` when it refuses, `null` when sudo could not run.
   */
  probe(): Promise<boolean | null>;
}

/** The client behind an injected Runner. Nothing here can run a command that is not on the allow-list. */
export function createHelperClient(run: Runner): HelperClient {
  return {
    async run(argv) {
      const checked = validateHelperCommand(argv);
      if (!checked.ok) throw new HelperUnavailableError(`refused: ${checked.reason}`);
      // `-n`: never prompt. A missing rule is an immediate non-zero exit, not a hang.
      const result = await run(SUDO, ["-n", ...checked.command.argv], {
        timeoutMs: HELPER_TIMEOUT_MS,
      });
      // A timeout or a signal (code null) may have happened after pmset ran: that is NOT "not
      // applied", so it stays an ordinary error and the journal keeps the entry pending.
      if (result.code === null) throw new Error("The privileged command did not finish");
      if (result.code !== 0) {
        throw new HelperUnavailableError(
          "The privileged helper is not installed (see docs/awake-helper.md), or it refused the command",
        );
      }
    },
    async probe() {
      // `-l` lists what sudo would allow; it does not execute the command.
      const result = await run(SUDO, ["-n", "-l", ...(ALLOWED_HELPER_ARGV[1] ?? [])], {
        timeoutMs: HELPER_TIMEOUT_MS,
      });
      return result.code === null ? null : result.code === 0;
    },
  };
}
