// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addDays, assertTimeZone, dayKeyOf, isDayKey } from "../recap-calendar";

const run = promisify(execFile);
export type DigestKind = "commit" | "session" | "meeting" | "ci" | "task";
/** The places a digest reads from; used to name what could not be read in full. */
export type DigestSourceId = "git" | "events" | "sessions" | "meetings";
export interface DigestSource {
  kind: DigestKind;
  /** A local in-app route (`#/…`); never an external URL, so a forged event cannot plant a link. */
  href: string;
  title: string;
  occurredAt: string;
  /** Only explicit evidence of pending work can appear under Today. */
  status: "done" | "planned" | "blocked";
  /** What the item is about (one CI workflow, one agent session); a later non-blocked item of the same subject ends an earlier blocker. */
  subject?: string;
  /** Only ends blockers of the same subject; never shown as a line itself. */
  clears?: true;
}
export interface DigestLine {
  text: string;
  source: DigestSource;
}
export interface DailyDigest {
  day: string;
  yesterday: DigestLine[];
  today: DigestLine[];
  blockers: DigestLine[];
  endOfDay: DigestLine[];
  /** Deterministic, local, no model invocation or cloud transmission. */
  model: "deterministic-local";
  /** Sources that could not be read at all. Their absence is NOT an empty day. */
  unavailable: DigestSourceId[];
  /** Sources read only in part because a window limit was reached. */
  partial: DigestSourceId[];
  /** Sources read but left out because the work could not be attributed to the user. */
  unattributed: DigestSourceId[];
}
export interface DigestInput {
  day?: string;
  now: () => number;
  timeZone: string;
  sources: readonly DigestSource[];
  unavailable?: readonly DigestSourceId[];
  partial?: readonly DigestSourceId[];
  unattributed?: readonly DigestSourceId[];
}

/** Longest title a digest line carries. */
export const MAX_TITLE = 200;

/**
 * A title safe to show and to paste into a chat: control characters and line breaks become
 * spaces, invisible format characters (bidi overrides and isolates, zero-width, BOM) are removed,
 * whitespace collapses, and the result is clipped to {@link MAX_TITLE} characters.
 */
export function cleanTitle(value: string): string {
  const text = value
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join("")}…` : text;
}

const LOCAL_HREFS = [
  /^#\/digest\/commit\/[0-9a-f]{40}$/,
  /^#\/digest\/event\/evt_[A-Za-z0-9_-]{6,128}$/,
  /^#\/meetings\/[A-Za-z0-9%._-]+$/,
  /^#\/agents\/[A-Za-z0-9%._-]+$/,
];
const validHref = (href: string): boolean => LOCAL_HREFS.some((pattern) => pattern.test(href));
const ids = (list: readonly DigestSourceId[] | undefined): DigestSourceId[] => [
  ...new Set(list ?? []),
];

/** Source content is data, never a prompt. Invalid dates, links and unsupported statuses are omitted. */
export function createDailyDigest(input: DigestInput): DailyDigest {
  const zone = assertTimeZone(input.timeZone);
  const day = input.day ?? dayKeyOf(input.now(), zone);
  if (!isDayKey(day)) throw new RangeError("Invalid digest day");
  const yesterday = addDays(day, -1);
  const unique = new Set<string>();
  const rows: DigestSource[] = [];
  for (const source of input.sources) {
    const title = cleanTitle(source.title);
    if (!title || !validHref(source.href) || !Number.isFinite(Date.parse(source.occurredAt)))
      continue;
    if (source.status !== "done" && source.status !== "planned" && source.status !== "blocked")
      continue;
    if (Date.parse(source.occurredAt) > input.now()) continue;
    const key = `${source.kind}\u0000${source.href}\u0000${source.status}`;
    if (unique.has(key)) continue;
    unique.add(key);
    rows.push({ ...source, title });
  }
  rows.sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.href.localeCompare(b.href),
  );
  const at = (source: DigestSource): number => Date.parse(source.occurredAt);
  // A blocker ends when a LATER item about the same subject is not blocked (a CI pass, an agent
  // resuming or finishing). Only what happened up to the end of the digest day counts, so a past
  // day is judged as it stood then.
  const resolved = (blocker: DigestSource): boolean =>
    blocker.subject !== undefined &&
    rows.some(
      (later) =>
        later.subject === blocker.subject &&
        later.status !== "blocked" &&
        at(later) > at(blocker) &&
        dayKeyOf(at(later), zone) <= day,
    );
  const select = (date: string, states: readonly DigestSource["status"][]): DigestLine[] =>
    rows
      .filter(
        (source) =>
          !source.clears &&
          dayKeyOf(at(source), zone) === date &&
          states.includes(source.status) &&
          !(source.status === "blocked" && resolved(source)),
      )
      .map((source) => ({ text: source.title, source }));
  return {
    day,
    yesterday: select(yesterday, ["done"]),
    today: select(day, ["planned"]),
    blockers: select(day, ["blocked"]),
    endOfDay: select(day, ["done", "blocked"]),
    model: "deterministic-local",
    unavailable: ids(input.unavailable),
    partial: ids(input.partial),
    unattributed: ids(input.unattributed),
  };
}

export interface GitRunOptions {
  /**
   * Let git read the user's global configuration. Only for `git config --get user.email`, which
   * executes nothing; every other call ignores global and system configuration.
   */
  globalConfig?: boolean;
}
export interface GitDigestRunner {
  (cwd: string, args: readonly string[], options?: GitRunOptions): Promise<string>;
}
/** Read-only Git runner, argv-only; no shell, hooks, network or local writes. */
export const localGitRunner: GitDigestRunner = async (cwd, args, options) => {
  const { stdout } = await run("git", [...args], {
    cwd,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      ...(options?.globalConfig ? {} : { GIT_CONFIG_GLOBAL: "/dev/null" }),
      GIT_OPTIONAL_LOCKS: "0",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_LFS_SKIP_SMUDGE: "1",
    },
  });
  return stdout;
};

/** Most commits one repository contributes to a digest; one more than this means "partial". */
export const MAX_COMMITS = 500;
/** Days before the digest day that are searched (git filters by committer date, we use author date). */
const COMMIT_LOOKBACK_DAYS = 14;
const EMAIL = /^[^\s<>]+@[^\s<>]+$/;

export interface DigestCommitRead {
  sources: DigestSource[];
  /** More matching commits existed than {@link MAX_COMMITS}. */
  truncated: boolean;
  /** False when the repository names no `user.email`, so nothing can be called the user's work. */
  attributed: boolean;
}

/** The exit status 1 `git config --get` gives for a key that is not set (anything else is a failure). */
const isUnset = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && err.code === 1;

/**
 * Reads the user's own commits: authored by this repository's configured `user.email`, no merges,
 * dated by the AUTHOR date (the committer date moves on a rebase and can be set to anything).
 * Without a configured identity nothing is returned and `attributed` is false. Links point at
 * the in-app commit page, never at a guessed remote.
 */
export async function readDigestCommits(
  repository: string,
  day: string,
  timeZone: string,
  runner: GitDigestRunner = localGitRunner,
): Promise<DigestCommitRead> {
  if (!isDayKey(day)) throw new RangeError("Invalid digest day");
  assertTimeZone(timeZone);
  let identity = "";
  try {
    identity = (await runner(repository, ["config", "--get", "user.email"], { globalConfig: true }))
      .trim()
      .toLowerCase();
  } catch (err) {
    if (!isUnset(err)) throw err;
  }
  if (!EMAIL.test(identity)) return { sources: [], truncated: false, attributed: false };
  const since = `${addDays(day, -COMMIT_LOOKBACK_DAYS)}T00:00:00Z`;
  const until = `${addDays(day, 2)}T00:00:00Z`;
  const output = await runner(repository, [
    "--no-pager",
    "-c",
    "log.showSignature=false",
    "log",
    "--no-show-signature",
    "--no-notes",
    "--no-merges",
    "--fixed-strings",
    "--regexp-ignore-case",
    `--author=<${identity}>`,
    "--format=%H%x00%aI%x00%ae%x00%s%x00",
    `--since=${since}`,
    `--until=${until}`,
    "-n",
    String(MAX_COMMITS + 1),
  ]);
  const fields = output.split("\0");
  const sources: DigestSource[] = [];
  let seen = 0;
  for (let i = 0; i + 3 < fields.length; i += 4) {
    seen++;
    if (seen > MAX_COMMITS) break;
    const sha = fields[i]!.trim();
    const occurredAt = fields[i + 1]!.trim();
    const author = fields[i + 2]!.trim().toLowerCase();
    const title = cleanTitle(fields[i + 3]!);
    if (author !== identity) continue;
    if (!/^[a-f0-9]{40}$/.test(sha) || !Number.isFinite(Date.parse(occurredAt)) || !title) continue;
    const localDay = dayKeyOf(Date.parse(occurredAt), timeZone);
    if (localDay !== day && localDay !== addDays(day, -1)) continue;
    sources.push({
      kind: "commit",
      href: `#/digest/commit/${sha}`,
      title,
      occurredAt,
      status: "done",
    });
  }
  return { sources, truncated: seen > MAX_COMMITS, attributed: true };
}
