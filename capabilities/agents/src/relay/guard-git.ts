// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 79 secret guard, the git half: decides whether a shell command is a `git commit` or
// `git push` and, if so, gathers what is about to be committed or pushed. Everything runs through
// the same hardened `execGit` the live diffs use (fixed argv, no shell, no repository-defined
// program), and every read is bounded.
//
// What a PreToolUse hook can know: it runs BEFORE the command. A `git add -A && git commit` therefore
// has nothing staged yet, so when the command itself adds files (or commits with -a) the guard scans
// the working tree instead (`git diff HEAD` plus untracked files). That is a superset of what the
// commit can contain; a secret in a file the commit will not include can still block it.
import { lstatSync, openSync, readSync, closeSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { execGit, type GitExec } from "../diffs";

export type GitVerb = "commit" | "push";

export interface GitIntent {
  verb: GitVerb;
  /** `git -C <dir>` when the command names one (resolved by the caller against the hook's cwd). */
  dir: string | undefined;
  /** The command stages files itself (`git add`) or commits with -a: scan the working tree. */
  worktree: boolean;
}

/** Options between `git` and its subcommand that take a value. */
const GIT_VALUE_OPTIONS: Record<string, true> = {
  "-C": true,
  "-c": true,
  "--git-dir": true,
  "--work-tree": true,
  "--namespace": true,
};

/**
 * `git` at the start of a shell word: after whitespace, a shell operator, an opening quote
 * (`bash -c "git commit"`, `eval 'git push'`), a backslash, or a path separator (`/usr/bin/git`).
 * `digit commit` and `legit push` do not match: the letter before `git` is not a boundary.
 */
const GIT_WORD = /(?:^|[\s;&|(`{"'\\/])git(?=\s)/g;

/** Characters looked at after each `git`: the verb is always within the first few words. */
const WORD_WINDOW = 400;

/**
 * The first `git commit` or `git push` in a shell command line, or null. Shell syntax is NOT parsed:
 * the command is searched for `git` words and split on whitespace, which is enough for what an agent
 * writes (including `bash -c "git commit ..."` and `/usr/bin/git commit`) and errs towards scanning
 * (an echo of the words "git commit" is scanned too, harmlessly). NOT recognised, by design: an
 * alias (`git ci`), a script (`./release.sh`) or a task runner (`make push`) that commits or pushes
 * for the agent; the tool input is still scanned for those, but no diff is gathered.
 * Linear in the length of `command`: each `git` looks at a fixed window only.
 */
export function gitIntent(command: string): GitIntent | null {
  let adds = false;
  let found: { verb: GitVerb; dir: string | undefined; commitAll: boolean } | null = null;
  for (const m of command.matchAll(GIT_WORD)) {
    const start = m.index! + m[0].length;
    const segment = command.slice(start, start + WORD_WINDOW).split(/[;&|\n]/)[0] ?? "";
    const words = segment
      .split(/\s+/)
      .map((w) => w.replace(/^["']+|["']+$/g, ""))
      .filter((w) => w !== "");
    let dir: string | undefined;
    let i = 0;
    for (; i < words.length; i++) {
      const word = words[i]!;
      if (Object.hasOwn(GIT_VALUE_OPTIONS, word)) {
        if (word === "-C") dir = words[i + 1];
        i++;
      } else if (!word.startsWith("-")) break;
    }
    const verb = words[i];
    if (verb === "add") adds = true;
    if (found !== null || (verb !== "commit" && verb !== "push")) continue;
    const flags = words.slice(i + 1);
    found = {
      verb,
      dir,
      commitAll:
        verb === "commit" &&
        flags.some((w) => w === "--all" || (/^-[A-Za-z]+$/.test(w) && w.slice(1).includes("a"))),
    };
  }
  if (found === null) return null;
  return {
    verb: found.verb,
    dir: found.dir,
    worktree: found.verb === "commit" && (adds || found.commitAll),
  };
}

const GIT_BASE = [
  "--no-pager",
  "--literal-pathspecs",
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
] as const;
const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "-U0"] as const;

const diffArgv = (...range: string[]): string[] => [...GIT_BASE, "diff", ...DIFF_FLAGS, ...range];

/** Untracked files read in the working-tree scan, and how much of each. */
export const MAX_UNTRACKED_FILES = 50;
export const MAX_UNTRACKED_BYTES = 100_000;

export interface Gathered {
  /** A unified diff (added lines are scanned) and, for untracked files, the same shape synthesised. */
  diff: string;
  /** What was gathered, for the user: `staged changes`, `working tree`, `unpushed commits`. */
  scope: string;
  /** git or a limit cut the text short. */
  truncated: boolean;
  /** Something the caller should say on stderr: a range that could not be resolved. */
  note?: string;
}

/** Commits read by the push fallback (`git log -p`), newest first. */
export const MAX_PUSH_COMMITS = 200;

/** Text of an untracked file as a diff of all-added lines; null for a link, binary, or unreadable file. */
function untrackedAsDiff(root: string, rel: string): string | null {
  const abs = resolve(root, rel);
  const inside = relative(root, abs);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return null;
  try {
    const stat = lstatSync(abs);
    if (!stat.isFile()) return null;
    const fd = openSync(abs, "r");
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_UNTRACKED_BYTES));
      const n = readSync(fd, buf, 0, buf.length, 0);
      const text = buf.subarray(0, n);
      if (text.includes(0)) return null;
      const lines = text.toString("utf8").split("\n");
      return `+++ b/${join(inside)}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * What the command is about to commit or push. Never throws; a git failure yields an empty diff
 * (the caller fails open for the diff part: the tool input itself was already scanned).
 */
export async function gatherChanges(
  intent: GitIntent,
  cwd: string,
  exec: GitExec = execGit,
): Promise<Gathered> {
  const root = intent.dir === undefined ? cwd : resolve(cwd, intent.dir);
  const got = (r: { code: number | null; stdout: string; truncated?: boolean }) =>
    r.code === 0 || r.truncated === true ? r : null;
  if (intent.verb === "push") {
    let out = got(await exec(diffArgv("@{u}..HEAD"), root));
    let note: string | undefined;
    if (out === null) {
      // No upstream (a first push, `git push -u origin x`): everything reachable from HEAD that no
      // remote-tracking ref has. `--not` negates every revision after it, so HEAD comes first.
      out = got(
        await exec(
          [
            ...GIT_BASE,
            "log",
            "-p",
            "--format=",
            `--max-count=${MAX_PUSH_COMMITS}`,
            ...DIFF_FLAGS,
            "HEAD",
            "--not",
            "--remotes",
          ],
          root,
        ),
      );
      if (out === null)
        note = "could not resolve what the push would send (no upstream, no commits?)";
    }
    const staged = got(await exec(diffArgv("--cached"), root));
    return {
      diff: [out?.stdout ?? "", staged?.stdout ?? ""].join("\n"),
      scope: "unpushed commits and staged changes",
      truncated: out?.truncated === true || staged?.truncated === true,
      ...(note === undefined ? {} : { note }),
    };
  }
  if (!intent.worktree) {
    const staged = got(await exec(diffArgv("--cached"), root));
    return {
      diff: staged?.stdout ?? "",
      scope: "staged changes",
      truncated: staged?.truncated === true,
    };
  }
  const head =
    got(await exec(diffArgv("HEAD"), root)) ?? got(await exec(diffArgv("--cached"), root));
  const listed = await exec(
    [...GIT_BASE, "ls-files", "--others", "--exclude-standard", "-z"],
    root,
  );
  const names = listed.code === 0 ? listed.stdout.split("\0").filter((n) => n !== "") : [];
  const files = names.slice(0, MAX_UNTRACKED_FILES).map((n) => untrackedAsDiff(root, n));
  return {
    diff: [head?.stdout ?? "", ...files.filter((f): f is string => f !== null)].join("\n"),
    scope: "working tree",
    truncated: head?.truncated === true || names.length > MAX_UNTRACKED_FILES,
  };
}
