// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Checkpoints (Phase 77): a snapshot of a project's working tree, untracked files included, kept
// as a commit under refs/phoenix/checkpoints/<id> in the project's OWN repository. Taking one
// never touches the user's branches, HEAD, index, stash or working tree:
//   1. a temporary index file (GIT_INDEX_FILE in a fresh temp dir) is filled with `read-tree HEAD`
//      (so tracked files that match an ignore rule are still seen) and `add -A` (changes, deletions
//      and untracked files; ignore rules apply, nothing is forced);
//   2. `write-tree` turns it into a tree, `commit-tree` into a commit with a fixed author;
//   3. `update-ref` creates the ref. The only writes into `.git` are new objects and that one ref.
import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SafetyGit, SafetyGitResult } from "./git";

export const CHECKPOINT_REF_PREFIX = "refs/phoenix/checkpoints/";
const REF_PATTERN = /^refs\/phoenix\/checkpoints\/cp_[0-9a-f]{16}$/;
export const CHECKPOINT_ID_PATTERN = /^cp_[0-9a-f]{16}$/;

/** True only for a ref this feature created. Every ref deletion is guarded by it. */
export const isCheckpointRef = (ref: string): boolean => REF_PATTERN.test(ref);
export const newCheckpointId = (): string => `cp_${randomBytes(8).toString("hex")}`;
export const refOf = (id: string): string => `${CHECKPOINT_REF_PREFIX}${id}`;

export interface CheckpointLimits {
  maxFiles: number;
  maxBytes: number;
}

export type SkipReason =
  | "disabled"
  | "kill_switch"
  | "not_git"
  | "git_unavailable"
  | "too_many_files"
  | "too_large"
  | "throttled"
  | "snapshot_failed";

/** What every git step needs: the runner, the repository's working tree and where to put temp indexes. */
export interface GitContext {
  git: SafetyGit;
  /** The repository's top-level working directory. */
  root: string;
  /** The user's global excludes file (so files they never track are not snapshotted), or null. */
  excludes: string | null;
  tmpDir: string;
}

const AUTHOR = {
  GIT_AUTHOR_NAME: "Phoenix",
  GIT_AUTHOR_EMAIL: "phoenix-safety@localhost.invalid",
  GIT_COMMITTER_NAME: "Phoenix",
  GIT_COMMITTER_EMAIL: "phoenix-safety@localhost.invalid",
} as const;

const SHA = /^[0-9a-f]{40,64}$/;

/** Config that applies the user's global ignore file despite GIT_CONFIG_GLOBAL being /dev/null. */
export const excludesArgs = (ctx: Pick<GitContext, "excludes">): string[] =>
  ctx.excludes ? ["-c", `core.excludesFile=${ctx.excludes}`] : [];

/** stdout trimmed, or null when git failed or did not print a full object id. */
export function oid(result: SafetyGitResult): string | null {
  const text = result.stdout.trim();
  return result.code === 0 && SHA.test(text) ? text : null;
}

/** The repository top-level of `project`, or why there is none. */
export async function findRoot(
  git: SafetyGit,
  project: string,
): Promise<{ ok: true; root: string } | { ok: false; reason: "not_git" | "git_unavailable" }> {
  const result = await git(project, ["rev-parse", "--show-toplevel"]);
  if (result.code === null) return { ok: false, reason: "git_unavailable" };
  const root = result.stdout.trim();
  if (result.code !== 0 || root === "") return { ok: false, reason: "not_git" };
  return { ok: true, root };
}

/** HEAD's commit id; null for an unborn branch (a repository with no commit yet). */
export async function headOf(git: SafetyGit, root: string): Promise<string | null> {
  return oid(await git(root, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]));
}

/**
 * The tree of the working tree as it is right now (tracked changes, deletions, untracked files; not
 * ignored ones), built in a throw-away index. Null when git could not build it.
 */
export async function currentTree(ctx: GitContext, head: string | null): Promise<string | null> {
  const dir = await mkdtemp(join(ctx.tmpDir, "phoenix-safety-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    if (head) {
      const read = await ctx.git(ctx.root, ["read-tree", head], { env });
      if (read.code !== 0) return null;
    }
    const add = await ctx.git(ctx.root, [...excludesArgs(ctx), "add", "-A"], { env });
    if (add.code !== 0) return null;
    return oid(await ctx.git(ctx.root, ["write-tree"], { env }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Counts what a snapshot would contain; stops early once a limit is passed. */
async function withinLimits(
  ctx: GitContext,
  limits: CheckpointLimits,
): Promise<"ok" | "too_many_files" | "too_large" | "failed"> {
  const listed = await ctx.git(ctx.root, [
    ...excludesArgs(ctx),
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (listed.code === null) return "failed";
  if (listed.code !== 0) return "failed";
  const paths = listed.stdout.split("\0").filter((p) => p !== "");
  if (paths.length > limits.maxFiles) return "too_many_files";
  let bytes = 0;
  for (let i = 0; i < paths.length; i += 64) {
    const sizes = await Promise.all(
      paths.slice(i, i + 64).map(async (p) => {
        try {
          const st = await lstat(join(ctx.root, p));
          return st.isFile() ? st.size : 0;
        } catch {
          return 0; // deleted or unreadable: it adds nothing the snapshot could hold
        }
      }),
    );
    for (const size of sizes) bytes += size;
    if (bytes > limits.maxBytes) return "too_large";
  }
  return "ok";
}

export interface CreateInput {
  id: string;
  project: string;
  now: Date;
  limits: CheckpointLimits;
  excludes: string | null;
  tmpDir: string;
}

export type CreateOutcome =
  | {
      ok: true;
      root: string;
      ref: string;
      commitId: string;
      treeId: string;
      headId: string | null;
      fileCount: number;
    }
  | { ok: false; reason: SkipReason };

/** Takes one checkpoint. Never throws for a git problem: the outcome says why nothing was taken. */
export async function createCheckpoint(git: SafetyGit, input: CreateInput): Promise<CreateOutcome> {
  const found = await findRoot(git, input.project);
  if (!found.ok) return found;
  const ctx: GitContext = {
    git,
    root: found.root,
    excludes: input.excludes,
    tmpDir: input.tmpDir,
  };
  const limit = await withinLimits(ctx, input.limits);
  if (limit === "too_many_files" || limit === "too_large") return { ok: false, reason: limit };
  if (limit === "failed") return { ok: false, reason: "snapshot_failed" };
  const head = await headOf(git, ctx.root);
  const tree = await currentTree(ctx, head);
  if (!tree) return { ok: false, reason: "snapshot_failed" };
  const date = input.now.toISOString();
  const commit = oid(
    await git(
      ctx.root,
      ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", `phoenix checkpoint ${input.id}`],
      { env: { ...AUTHOR, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } },
    ),
  );
  if (!commit) return { ok: false, reason: "snapshot_failed" };
  const ref = refOf(input.id);
  const updated = await git(ctx.root, ["update-ref", ref, commit]);
  if (updated.code !== 0) return { ok: false, reason: "snapshot_failed" };
  const listed = await git(ctx.root, ["ls-tree", "-r", "-z", "--name-only", tree]);
  const fileCount =
    listed.code === 0 ? listed.stdout.split("\0").filter((p) => p !== "").length : 0;
  return { ok: true, root: ctx.root, ref, commitId: commit, treeId: tree, headId: head, fileCount };
}

/**
 * Deletes one checkpoint ref. Refuses (returns false) for any ref outside
 * refs/phoenix/checkpoints/cp_<16 hex>: a tampered database row can never make this delete a
 * branch, tag or stash.
 */
export async function deleteCheckpointRef(
  git: SafetyGit,
  root: string,
  ref: string,
): Promise<boolean> {
  if (!isCheckpointRef(ref)) return false;
  const result = await git(root, ["update-ref", "-d", ref]);
  return result.code === 0;
}
