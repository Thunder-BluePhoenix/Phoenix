// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `recent_commits`: what changed lately in one watched repository. Runs `git log` and nothing
// else, with a fixed argument list; the only caller-controlled strings are the commit count
// (an integer) and the path filter, which is validated here and placed after `--`.
import { isAbsolute } from "node:path";
import { redact } from "@phoenix/logging";
import { git } from "./exec";

export const DEFAULT_COMMITS = 10;
export const MAX_COMMITS = 50;
export const MAX_FILES = 30;
export const MAX_SUBJECT = 200;
export const MAX_PATH = 200;
const GIT_LOG_TIMEOUT_MS = 15_000;

/** A header line is RS + full commit id + US + author date + US + subject. */
const HEADER = /^\u001e([0-9a-f]{40})\u001f([^\u001f]*)\u001f(.*)$/;
const FORMAT = "--format=%x1e%H%x1f%aI%x1f%s";
// The error git prints for a repository without commits (the command runs with LC_ALL=C).
const NO_COMMITS = /does not have any commits yet|bad default revision|unknown revision/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[A-Za-z]:/;

export interface CommitSummary {
  sha: string;
  short_sha: string;
  subject: string;
  /** ISO 8601 (UTC), or null if git printed something unparseable. */
  author_date: string | null;
  /** Paths changed (0 for merge commits: git log shows no diff for them). */
  files_changed: number;
  /** At most {@link MAX_FILES} paths. */
  files: string[];
}

export interface RecentCommits {
  repository: string;
  commits: CommitSummary[];
  /** True when the repository has more commits than were returned. */
  truncated: boolean;
}

export class RecentCommitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecentCommitsError";
  }
}

function clip(value: string, max: number): string {
  const text = redact(value.trim()) as string;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * A path filter is a repository-relative path, nothing more: no option-looking text, control
 * characters, absolute paths or `..` segments. It is also passed after `--` with literal
 * pathspecs, so git cannot read it as an option, a revision or pathspec magic.
 */
export function validatePathFilter(value: string): string {
  if (!value || value.length > MAX_PATH) {
    throw new RecentCommitsError(`path_filter must be 1-${MAX_PATH} characters`);
  }
  if (CONTROL.test(value)) {
    throw new RecentCommitsError("path_filter must not contain control characters");
  }
  if (value.startsWith("-")) throw new RecentCommitsError("path_filter must not start with '-'");
  if (isAbsolute(value) || value.startsWith("/") || value.startsWith("\\") || DRIVE.test(value)) {
    throw new RecentCommitsError("path_filter must be relative to the repository");
  }
  if (value.split(/[/\\]/).includes("..")) {
    throw new RecentCommitsError("path_filter must not contain '..'");
  }
  return value;
}

export function validateLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_COMMITS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_COMMITS) {
    throw new RecentCommitsError(`limit must be an integer from 1 to ${MAX_COMMITS}`);
  }
  return value;
}

/** Parses the output of the `git log` run by {@link readRecentCommits}. Pure. */
export function parseLog(stdout: string): CommitSummary[] {
  const commits: CommitSummary[] = [];
  let paths: string[] = [];
  let current: CommitSummary | undefined;
  const finish = () => {
    if (current) {
      current.files_changed = paths.length;
      current.files = paths.slice(0, MAX_FILES).map((p) => clip(p, MAX_PATH));
      commits.push(current);
    }
    paths = [];
  };
  for (const line of stdout.split("\n")) {
    const header = HEADER.exec(line);
    if (header) {
      finish();
      const time = Date.parse(header[2]!);
      current = {
        sha: header[1]!,
        short_sha: header[1]!.slice(0, 7),
        subject: clip(header[3]!, MAX_SUBJECT),
        author_date: Number.isNaN(time) ? null : new Date(time).toISOString(),
        files_changed: 0,
        files: [],
      };
    } else if (current && line) {
      paths.push(line);
    }
  }
  finish();
  return commits;
}

interface ExecFailure {
  stderr?: unknown;
  code?: unknown;
}

function isExecFailure(err: unknown): err is ExecFailure {
  return typeof err === "object" && err !== null;
}

export async function readRecentCommits(
  repoPath: string,
  repository: string,
  options: { limit?: number; pathFilter?: string },
): Promise<RecentCommits> {
  const limit = validateLimit(options.limit);
  const pathFilter =
    options.pathFilter === undefined ? [] : [validatePathFilter(options.pathFilter)];
  const args = [
    "--no-pager",
    "--literal-pathspecs",
    "-c",
    "log.showSignature=false",
    "-c",
    "core.quotePath=off",
    "log",
    "--no-color",
    "--no-renames",
    "--no-notes",
    "--encoding=UTF-8",
    "--name-only",
    FORMAT,
    // One more than asked for tells whether there is more.
    "-n",
    String(limit + 1),
    "--end-of-options",
    ...(pathFilter.length ? ["--", ...pathFilter] : []),
  ];
  let stdout: string;
  try {
    stdout = await git(repoPath, args, {
      timeoutMs: GIT_LOG_TIMEOUT_MS,
      env: { LC_ALL: "C" },
    });
  } catch (err) {
    const stderr = isExecFailure(err) && typeof err.stderr === "string" ? err.stderr : "";
    if (NO_COMMITS.test(stderr)) return { repository, commits: [], truncated: false };
    if (isExecFailure(err) && err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new RecentCommitsError(
        "git log output is too large; use a smaller limit or path_filter",
      );
    }
    const first = stderr.trim().split("\n")[0] ?? "";
    throw new RecentCommitsError(`git log failed${first ? `: ${clip(first, 200)}` : ""}`);
  }
  const commits = parseLog(stdout);
  if (stdout.trim() && !commits.length) {
    throw new RecentCommitsError("git log printed output this capability cannot read");
  }
  return { repository, commits: commits.slice(0, limit), truncated: commits.length > limit };
}
