// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one place the git capability starts a process: `git` itself, no shell, an argument list
// built by code.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitOptions {
  timeoutMs?: number;
  /** Extra environment variables (e.g. LC_ALL=C when stderr is matched). */
  env?: Record<string, string>;
}

export async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], {
    timeout: options.timeoutMs ?? 5_000,
    maxBuffer: 4 * 1024 * 1024,
    // Never take the index lock: Phoenix must not get in the way of the user's own git commands.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...options.env },
  });
  return stdout;
}
