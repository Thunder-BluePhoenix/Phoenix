// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one place the safety net starts git. Always `execFile` with an argv array (no shell), from a
// neutral working directory with the repository chosen by `-C`, with no system or global config,
// no hooks, no fsmonitor and every clean/smudge/process filter the repository defines switched off
// (a filter is a command the repository's own config would otherwise run during `git add`).
import { execFile } from "node:child_process";
import { devNull, tmpdir } from "node:os";

export interface SafetyGitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SafetyGitOptions {
  /** Extra environment (GIT_INDEX_FILE, author and committer). */
  env?: Readonly<Record<string, string>>;
  /** Written to git's stdin, then closed. */
  input?: string;
}

/** Runs `git <argv>` against the repository at `root`. Never throws; a spawn failure has `code` null. */
export type SafetyGit = (
  root: string,
  argv: readonly string[],
  options?: SafetyGitOptions,
) => Promise<SafetyGitResult>;

const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

const SAFE_CONFIG = [
  "--no-pager",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.pager=cat",
  "-c",
  "protocol.allow=never",
  "-c",
  "core.quotepath=false",
  "-c",
  "commit.gpgsign=false",
] as const;

const FILTER_OFF: readonly (readonly [string, string])[] = [
  ["clean", ""],
  ["smudge", ""],
  ["process", ""],
  ["required", "false"],
];

function baseEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_ATTR_NOSYSTEM: "1",
    ...extra,
  };
  for (const name of ["SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]) {
    const value = process.env[name];
    if (value !== undefined && env[name] === undefined) env[name] = value;
  }
  return env;
}

function spawn(
  argv: readonly string[],
  env: Record<string, string>,
  input: string | undefined,
): Promise<SafetyGitResult> {
  const done = Promise.withResolvers<SafetyGitResult>();
  const child = execFile(
    "git",
    [...argv],
    // Neutral cwd: on Windows a planted git.exe in the current directory would win over PATH.
    { cwd: tmpdir(), timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, env },
    (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
      done.resolve({ code, stdout, stderr });
    },
  );
  if (input !== undefined) {
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  }
  return done.promise;
}

/** `filter.<name>` of every driver the repository's config names (reading config runs nothing). */
async function filterDrivers(root: string, env: Record<string, string>): Promise<string[]> {
  const listed = await spawn(
    [
      "-C",
      root,
      ...SAFE_CONFIG,
      "config",
      "-z",
      "--name-only",
      "--get-regexp",
      String.raw`^filter\.`,
    ],
    env,
    undefined,
  );
  if (listed.code !== 0) return [];
  const drivers = new Set<string>();
  for (const key of listed.stdout.split("\0")) {
    const dot = key.lastIndexOf(".");
    if (dot > "filter.".length) drivers.add(key.slice(0, dot));
  }
  return [...drivers];
}

export const safetyGit: SafetyGit = async (root, argv, options = {}) => {
  const drivers = await filterDrivers(root, baseEnv());
  const overrides = drivers.flatMap((driver) =>
    FILTER_OFF.map(([key, value]) => [`${driver}.${key}`, value] as const),
  );
  const env = baseEnv({
    ...options.env,
    GIT_CONFIG_COUNT: String(overrides.length),
    ...Object.fromEntries(
      overrides.flatMap(([key, value], i) => [
        [`GIT_CONFIG_KEY_${i}`, key],
        [`GIT_CONFIG_VALUE_${i}`, value],
      ]),
    ),
  });
  return spawn(["-C", root, ...SAFE_CONFIG, ...argv], env, options.input);
};
