// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Launchers: the ONLY way Phoenix starts a coding agent. A launcher is written by the user in the
// capability's config: an absolute executable with fixed arguments and the folders it may work in.
// Nothing about what runs comes from an event, a task text or a prompt. Prompts reach the agent on
// stdin, never in argv, and no shell is involved, so quoting tricks have nothing to act on.
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { isRecord } from "./guards";
import { AGENT_PATTERN } from "./report";

export const MAX_LAUNCHERS = 8;
export const MAX_ARGV = 32;
export const MAX_ARG_CHARS = 1_000;
export const MAX_CWD_ROOTS = 8;
export const MAX_ENV_ALLOW = 16;
export const MAX_WAITING_PROMPTS = 8;
export const MAX_WAITING_PROMPT_CHARS = 100;

/** What the agent process may see of Phoenix's own environment unless the launcher adds names. */
export const BASE_ENV: readonly string[] = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR"];

const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const CONTROL = /\p{Cc}/u;

/**
 * Interpreters that would run a prompt as a script when the launcher is mistyped (`/bin/sh` reads
 * its stdin as commands). A guard against mistakes, not a boundary: any interpreter can run
 * a script; the user owns what they put in a launcher.
 */
const SHELLS: Readonly<Record<string, true>> = {
  sh: true,
  bash: true,
  zsh: true,
  dash: true,
  fish: true,
  ksh: true,
  csh: true,
  tcsh: true,
};

export interface LauncherSpec {
  /** Absolute executable followed by fixed arguments. */
  command: string[];
  /** The agent may only be started in a folder inside one of these (absolute, never `/`). */
  cwd_roots: string[];
  /** Names copied from Phoenix's environment on top of BASE_ENV. */
  env_allow?: string[];
  /** Literal text: an output line containing one of these means the agent is waiting for you. */
  waiting_prompts?: string[];
  /** `keep_open` (default) allows `session.send`; `close_after_prompt` ends stdin after the prompt. */
  stdin?: "keep_open" | "close_after_prompt";
}

export type LauncherTable = Record<string, LauncherSpec>;

export interface LauncherConfigResult {
  launchers: LauncherTable;
  /** One line per problem; a launcher with a problem is not usable. */
  problems: string[];
}

const LAUNCHER_KEYS: readonly string[] = [
  "command",
  "cwd_roots",
  "env_allow",
  "waiting_prompts",
  "stdin",
];

/** True for a normalised absolute POSIX path: no `..`, `.`, double or trailing slashes. */
export function isCleanAbsolute(path: string): boolean {
  return isAbsolute(path) && resolve(path) === path && !CONTROL.test(path);
}

function cleanStrings(
  value: unknown,
  label: string,
  limits: { max: number; maxChars: number; min?: number },
  problems: string[],
): string[] | undefined {
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array`);
    return undefined;
  }
  if (value.length > limits.max || value.length < (limits.min ?? 0)) {
    problems.push(`${label} must have ${limits.min ?? 0} to ${limits.max} entries`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > limits.maxChars) {
      problems.push(`${label} entries must be strings of 1 to ${limits.maxChars} characters`);
      return undefined;
    }
    if (CONTROL.test(item)) {
      problems.push(`${label} entries must not contain control characters`);
      return undefined;
    }
    out.push(item);
  }
  return out;
}

function checkLauncher(name: string, raw: unknown, problems: string[]): LauncherSpec | undefined {
  const at = `launcher "${name}"`;
  if (!AGENT_PATTERN.test(name)) {
    problems.push(`${at}: the name must be a short slug (letters, digits, . _ -)`);
    return undefined;
  }
  if (!isRecord(raw)) {
    problems.push(`${at} must be an object`);
    return undefined;
  }
  const before = problems.length;
  for (const key of Object.keys(raw)) {
    if (!LAUNCHER_KEYS.includes(key)) problems.push(`${at}: unknown field "${key}"`);
  }
  const command = cleanStrings(
    raw.command,
    `${at}: command`,
    { max: MAX_ARGV, maxChars: MAX_ARG_CHARS, min: 1 },
    problems,
  );
  if (command) {
    const exe = command[0]!;
    if (!isCleanAbsolute(exe)) {
      problems.push(`${at}: the executable must be a normalised absolute path`);
    } else if (SHELLS[basename(exe)]) {
      problems.push(`${at}: a shell cannot be a launcher (it would run prompts as commands)`);
    }
  }
  const roots = cleanStrings(
    raw.cwd_roots,
    `${at}: cwd_roots`,
    { max: MAX_CWD_ROOTS, maxChars: MAX_ARG_CHARS, min: 1 },
    problems,
  );
  for (const root of roots ?? []) {
    if (!isCleanAbsolute(root)) problems.push(`${at}: cwd_roots must be normalised absolute paths`);
    else if (root === dirname(root))
      problems.push(`${at}: cwd_roots must not be the filesystem root`);
    else if (root.includes("*")) problems.push(`${at}: cwd_roots must not contain "*"`);
  }
  let envAllow: string[] | undefined;
  if (raw.env_allow !== undefined) {
    envAllow = cleanStrings(
      raw.env_allow,
      `${at}: env_allow`,
      { max: MAX_ENV_ALLOW, maxChars: 64 },
      problems,
    );
    for (const n of envAllow ?? []) {
      if (!ENV_NAME.test(n) || n.startsWith("PHOENIX_"))
        problems.push(`${at}: env_allow "${n}" is not an allowed variable name`);
    }
  }
  let waiting: string[] | undefined;
  if (raw.waiting_prompts !== undefined) {
    waiting = cleanStrings(
      raw.waiting_prompts,
      `${at}: waiting_prompts`,
      { max: MAX_WAITING_PROMPTS, maxChars: MAX_WAITING_PROMPT_CHARS },
      problems,
    );
  }
  if (raw.stdin !== undefined && raw.stdin !== "keep_open" && raw.stdin !== "close_after_prompt")
    problems.push(`${at}: stdin must be "keep_open" or "close_after_prompt"`);

  if (problems.length > before || !command || !roots) return undefined;
  return {
    command,
    cwd_roots: roots,
    ...(envAllow ? { env_allow: envAllow } : {}),
    ...(waiting ? { waiting_prompts: waiting } : {}),
    ...(raw.stdin === "close_after_prompt" ? { stdin: "close_after_prompt" as const } : {}),
  };
}

/** Validates the `launchers` config value. Never throws; usable launchers come back, problems listed. */
export function parseLaunchers(value: unknown): LauncherConfigResult {
  const problems: string[] = [];
  const launchers: LauncherTable = Object.create(null) as LauncherTable;
  if (value === undefined) return { launchers, problems };
  if (!isRecord(value)) return { launchers, problems: ["launchers must be an object"] };
  const names = Object.keys(value);
  if (names.length > MAX_LAUNCHERS) {
    return { launchers, problems: [`at most ${MAX_LAUNCHERS} launchers may be configured`] };
  }
  for (const name of names) {
    const spec = checkLauncher(name, value[name], problems);
    if (spec) launchers[name] = spec;
  }
  return { launchers, problems };
}

/** Files and folders the launcher resolved to, checked at the moment of the start. */
export interface ResolvedLaunch {
  /** realpath of the executable; this, not the configured path, is executed. */
  executable: string;
  /** realpath of the workspace. */
  workspace: string;
}

export class LauncherRefusal extends Error {
  override name = "LauncherRefusal";
}

/**
 * Looks at the real files NOW (they may have changed since the config was written) and refuses
 * anything unsafe: an executable that is missing, not a regular executable file, or writable by
 * everyone (or sitting in such a folder without the sticky bit), and a workspace that is missing,
 * not a folder, contains "*" or resolves (after following symlinks) outside every cwd root.
 */
export function resolveLaunch(spec: LauncherSpec, workspace: string): ResolvedLaunch {
  if (!isCleanAbsolute(workspace) || workspace.includes("*")) {
    throw new LauncherRefusal("The workspace must be a normalised absolute path without wildcards");
  }
  let executable: string;
  try {
    executable = realpathSync(spec.command[0]!);
    const st = statSync(executable);
    if (!st.isFile() || (st.mode & 0o111) === 0)
      throw new LauncherRefusal("The launcher's executable is not an executable file");
    if ((st.mode & 0o002) !== 0)
      throw new LauncherRefusal("The launcher's executable is writable by everyone");
    const dir = statSync(dirname(executable));
    if ((dir.mode & 0o002) !== 0 && (dir.mode & 0o1000) === 0)
      throw new LauncherRefusal("The launcher's folder is writable by everyone");
  } catch (err) {
    if (err instanceof LauncherRefusal) throw err;
    throw new LauncherRefusal("The launcher's executable does not exist");
  }
  let real: string;
  try {
    real = realpathSync(workspace);
    if (!statSync(real).isDirectory()) throw new LauncherRefusal("The workspace is not a folder");
  } catch (err) {
    if (err instanceof LauncherRefusal) throw err;
    throw new LauncherRefusal("The workspace does not exist");
  }
  const inside = spec.cwd_roots.some((root) => {
    let rootReal: string;
    try {
      rootReal = realpathSync(root);
    } catch {
      return false;
    }
    const rel = relative(rootReal, real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!inside)
    throw new LauncherRefusal("The workspace is outside this launcher's allowed folders");
  return { executable, workspace: real };
}

/** The environment the agent gets: BASE_ENV and the launcher's names, nothing else. */
export function buildEnv(
  spec: LauncherSpec,
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = { TERM: "dumb", NO_COLOR: "1" };
  for (const name of [...BASE_ENV, ...(spec.env_allow ?? [])]) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
