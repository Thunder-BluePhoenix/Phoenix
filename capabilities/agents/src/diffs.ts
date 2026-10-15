// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 live diffs. Two separate things:
//  - `FileTallies`: per-session {path, added, removed, edits}, summed from the Edit/Write steps.
//    Counts only; no file content is ever stored.
//  - `readDiff`: the FULL diff of one file, computed on demand from `git diff` in the session's
//    project directory, never stored. Rules held here (each has a test):
//      * git is run with a fixed argv through execFile (no shell); the path is one argv element
//        after `--`, so it can be neither an option nor a command;
//      * a path is refused if it contains `..`, a control character, resolves (symlinks included)
//        outside the project, or the project itself cannot be resolved;
//      * output is capped and stripped of terminal escapes.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { LinkView } from "./links";
import { MAX_FILE_PATH } from "./steps";

export const MAX_TRACKED_FILES = 200;
export const MAX_DIFF_CHARS = 200_000;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 2_000_000;

export interface FileTally {
  path: string;
  added: number;
  removed: number;
  edits: number;
  last_at: string;
}

/** Per-session changed files, bounded; the least recently changed is dropped first. */
export class FileTallies {
  private files = new Map<string, FileTally>();

  /** Adds one change and returns the cumulative totals for that file. */
  apply(change: { path: string; added: number; removed: number }, at: string): FileTally {
    const prev = this.files.get(change.path);
    const next: FileTally = {
      path: change.path,
      added: (prev?.added ?? 0) + change.added,
      removed: (prev?.removed ?? 0) + change.removed,
      edits: (prev?.edits ?? 0) + 1,
      last_at: at,
    };
    this.files.delete(change.path);
    this.files.set(change.path, next);
    if (this.files.size > MAX_TRACKED_FILES) {
      const oldest = this.files.keys().next().value;
      if (oldest !== undefined) this.files.delete(oldest);
    }
    return next;
  }

  /** Newest change first. */
  list(): FileTally[] {
    return [...this.files.values()].reverse();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }
}

const refuse = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

export interface ProjectFile {
  /** Real, absolute path. */
  abs: string;
  /** Path relative to the real project directory, with `/` separators. */
  rel: string;
  /** Real project directory (git's working directory). */
  root: string;
}

/** Real path of `path`, or of its nearest existing ancestor plus the rest (for a new file). */
function realpathLoose(path: string): string {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync(current), ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) throw refuse("The path cannot be resolved");
      rest.push(current.slice(parent.length).replace(/^[\\/]+/, ""));
      current = parent;
    }
  }
}

/**
 * Resolves `input` (absolute, or relative to `project`) and proves it lies inside the project's
 * real directory. Throws INVALID_REQUEST (path outside the project, `..`, control characters).
 */
export function resolveProjectFile(project: string, input: string): ProjectFile {
  if (input.length === 0 || input.length > MAX_FILE_PATH)
    throw refuse("The path is empty or too long");
  if (/\p{Cc}/u.test(input)) throw refuse("The path contains control characters");
  if (input.split(/[\\/]/).includes("..")) throw refuse("The path must not contain '..'");
  if (!isAbsolute(project)) throw refuse("The session's project is not an absolute path");
  let root: string;
  try {
    root = realpathSync(project);
  } catch {
    throw refuse("The session's project directory is not available");
  }
  const abs = realpathLoose(isAbsolute(input) ? input : resolve(project, input));
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw refuse("The path is outside the session's project");
  }
  return { abs, rel: rel.split(sep).join("/"), root };
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `git <argv>` in `cwd` without a shell. Tests inject a fake. */
export type GitExec = (argv: readonly string[], cwd: string) => Promise<ExecResult>;

export const execGit: GitExec = (argv, cwd) => {
  const done = Promise.withResolvers<ExecResult>();
  execFile(
    "git",
    [...argv],
    {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      // Nothing from the user's environment that could change what git runs (GIT_EXTERNAL_DIFF, …).
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
    (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
      done.resolve({ code, stdout, stderr });
    },
  );
  return done.promise;
};

/** The options every git call starts with. */
const GIT_BASE = [
  "--no-pager",
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false",
] as const;
const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"] as const;

/** The argv for a diff of one tracked file against HEAD. */
export const diffHeadArgv = (rel: string): string[] => [
  ...GIT_BASE,
  "diff",
  ...DIFF_FLAGS,
  "HEAD",
  "--",
  rel,
];
const untrackedArgv = (rel: string): string[] => [
  ...GIT_BASE,
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  rel,
];
/** Diff of an untracked file as an addition (`git diff --no-index` exits 1 when there is a diff). */
const noIndexArgv = (rel: string): string[] => [
  ...GIT_BASE,
  "diff",
  ...DIFF_FLAGS,
  "--no-index",
  "--",
  "/dev/null",
  rel,
];

// eslint-disable-next-line no-control-regex
const UNSAFE = /\u001b\[[0-?]*[ -/]*[@-~]|[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Terminal escapes and control characters out; tabs and newlines stay. Cut to the limit. */
export function boundDiff(text: string): { diff: string; truncated: boolean } {
  const clean = text.replace(/\r\n/g, "\n").replace(UNSAFE, "");
  if (clean.length <= MAX_DIFF_CHARS) return { diff: clean, truncated: false };
  const cut = clean.slice(0, MAX_DIFF_CHARS);
  return { diff: cut.slice(0, cut.lastIndexOf("\n") + 1 || MAX_DIFF_CHARS), truncated: true };
}

export interface FileDiff {
  path: string;
  diff: string;
  truncated: boolean;
  source: "git diff HEAD" | "untracked file";
}

/** The full diff of one file in `project`. Throws INVALID_REQUEST for a refused path. */
export async function readDiff(
  project: string,
  input: string,
  exec: GitExec = execGit,
): Promise<FileDiff> {
  const file = resolveProjectFile(project, input);
  const tracked = await exec(diffHeadArgv(file.rel), file.root);
  if (tracked.code === 0 && tracked.stdout.length > 0) {
    return { path: file.rel, ...boundDiff(tracked.stdout), source: "git diff HEAD" };
  }
  const untracked = await exec(untrackedArgv(file.rel), file.root);
  if (untracked.code === 0 && untracked.stdout.trim().length > 0) {
    const added = await exec(noIndexArgv(file.rel), file.root);
    if ((added.code === 0 || added.code === 1) && added.stdout.length > 0) {
      return { path: file.rel, ...boundDiff(added.stdout), source: "untracked file" };
    }
  }
  if (tracked.code !== 0 && untracked.code !== 0) {
    throw new PhoenixError(
      ErrorCode.INVALID_REQUEST,
      "git could not diff this file (is the project a git repository?)",
    );
  }
  return { path: file.rel, diff: "", truncated: false, source: "git diff HEAD" };
}

export interface DiffLink {
  ref: string;
  repo: string;
  confidence: string;
  created_at: string;
  conclusion?: string;
}

/**
 * The commits and CI runs Phoenix's link store already associates with the session. Nothing is
 * inferred here: a link says "it appeared while the session was active", not "this file is in it".
 */
export function diffLinks(links: readonly LinkView[]): {
  commits: DiffLink[];
  ci_runs: DiffLink[];
} {
  const view = (l: LinkView): DiffLink => ({
    ref: l.ref,
    repo: l.repo,
    confidence: l.confidence,
    created_at: l.created_at,
    ...(typeof l.detail?.conclusion === "string" ? { conclusion: l.detail.conclusion } : {}),
  });
  return {
    commits: links.filter((l) => l.kind === "commit").map(view),
    ci_runs: links.filter((l) => l.kind === "ci_run").map(view),
  };
}
