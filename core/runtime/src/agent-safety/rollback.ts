// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Rollback (Phase 77). `planRollback` compares the checkpoint's tree with the working tree as it is
// now and says exactly which paths would change; `previewHash` binds that plan. `applyRollback`
// recomputes the plan, refuses when it is no longer the one the owner was shown, and then:
//   - restores ONLY paths that differ from the checkpoint (modified, deleted, type-changed), by
//     `checkout-index` from a temporary index holding the checkpoint tree (the user's index is
//     never read or written);
//   - removes a file that did not exist at the checkpoint ONLY when it is listed in the preview, is
//     not tracked by HEAD and is not matched by an ignore rule;
//   - never touches `.git`, never resets HEAD, a branch, the index or a stash, and refuses
//     outright when HEAD is no longer the commit the checkpoint was taken on.
import { createHash } from "node:crypto";
import { lstat, mkdtemp, rm, unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { boundDiff, redactSecrets } from "@phoenix/capability-agents";
import { capForRedaction } from "../secret-guard/cap";
import { canonicalJson } from "@phoenix/workflows";
import {
  currentTree,
  excludesArgs,
  findRoot,
  headOf,
  isCheckpointRef,
  oid,
  type GitContext,
} from "./checkpoints";

/** What a checkpoint row says about itself; everything rollback needs from storage. */
export interface PlanSubject {
  id: string;
  ref: string;
  commitId: string;
  headId: string | null;
  project: string;
}

export type RestoreChange = "modified" | "deleted" | "type_changed";
export type KeptReason = "tracked_by_head" | "ignored" | "submodule" | "unsafe_path" | "not_a_file";

export interface RestoreEntry {
  path: string;
  change: RestoreChange;
}
export interface KeptEntry {
  path: string;
  why: KeptReason;
}

export interface RollbackPlan {
  checkpointId: string;
  commitId: string;
  /** The checkpoint's tree. */
  checkpointTree: string;
  /** The working tree now (tracked changes and untracked files; ignored files excluded). */
  currentTree: string;
  headId: string | null;
  restore: RestoreEntry[];
  remove: string[];
  kept: KeptEntry[];
  hash: string;
}

export type PlanRefusal =
  "repository_missing" | "checkpoint_gone" | "head_moved" | "snapshot_failed";

export type PlanOutcome =
  { ok: true; plan: RollbackPlan; ctx: GitContext } | { ok: false; reason: PlanRefusal };

const NUL = "\0";
const GITLINK = "160000";
const MAX_LISTED = 5_000;

/** A path git may legitimately hand back, and that is safe to join onto the work tree. */
export function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.includes(NUL) || rel.startsWith("/") || rel.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(rel)) return false;
  return rel
    .split(/[\\/]/)
    .every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}

/** True when a parent directory of `rel` inside `root` is a symlink (a write could leave the project). */
async function leadingSymlink(root: string, rel: string): Promise<boolean> {
  const parts = rel.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch {
      return false; // does not exist: nothing there to follow
    }
  }
  return false;
}

interface RawEntry {
  oldMode: string;
  newMode: string;
  status: string;
  path: string;
}

/** Parses `git diff-tree -r -z --raw --no-renames` output. */
export function parseRaw(output: string): RawEntry[] {
  const out: RawEntry[] = [];
  const tokens = output.split(NUL);
  for (let i = 0; i + 1 < tokens.length;) {
    const header = tokens[i]!;
    if (!header.startsWith(":")) {
      i++;
      continue;
    }
    const [oldMode, newMode, , , status] = header.slice(1).split(" ");
    const path = tokens[i + 1]!;
    if (oldMode && newMode && status)
      out.push({ oldMode, newMode, status: status.slice(0, 1), path });
    i += 2;
  }
  return out;
}

/** The ignore rules (repository files, info/exclude, the user's global file) that match `paths`. */
async function ignoredAmong(
  ctx: GitContext,
  paths: readonly string[],
): Promise<Set<string> | null> {
  if (paths.length === 0) return new Set();
  const result = await ctx.git(
    ctx.root,
    [...excludesArgs(ctx), "check-ignore", "--no-index", "-z", "--stdin"],
    { input: paths.join(NUL) + NUL },
  );
  // 0 = some matched, 1 = none matched; anything else is a failure and is treated as "unknown".
  if (result.code !== 0 && result.code !== 1) return null;
  return new Set(result.stdout.split(NUL).filter((p) => p !== ""));
}

export function previewHash(plan: Omit<RollbackPlan, "hash">): string {
  return createHash("sha256")
    .update("phoenix-rollback-preview-v1\n")
    .update(
      canonicalJson({
        checkpoint: plan.checkpointId,
        commit: plan.commitId,
        head: plan.headId,
        checkpoint_tree: plan.checkpointTree,
        current_tree: plan.currentTree,
        restore: plan.restore,
        remove: plan.remove,
        kept: plan.kept,
      }),
    )
    .digest("hex");
}

/** Works out what a rollback would do right now. Reads only; nothing in the project changes. */
export async function planRollback(
  base: Omit<GitContext, "root">,
  subject: PlanSubject,
): Promise<PlanOutcome> {
  const found = await findRoot(base.git, subject.project);
  if (!found.ok) return { ok: false, reason: "repository_missing" };
  const ctx: GitContext = { ...base, root: found.root };
  if (!isCheckpointRef(subject.ref)) return { ok: false, reason: "checkpoint_gone" };
  const pointed = oid(await ctx.git(ctx.root, ["rev-parse", "--verify", "-q", subject.ref]));
  if (pointed !== subject.commitId) return { ok: false, reason: "checkpoint_gone" };
  const checkpointTree = oid(
    await ctx.git(ctx.root, ["rev-parse", "--verify", "-q", `${subject.commitId}^{tree}`]),
  );
  if (!checkpointTree) return { ok: false, reason: "checkpoint_gone" };

  const head = await headOf(ctx.git, ctx.root);
  if (head !== subject.headId) return { ok: false, reason: "head_moved" };

  const now = await currentTree(ctx, head);
  if (!now) return { ok: false, reason: "snapshot_failed" };

  const raw = await ctx.git(ctx.root, [
    "diff-tree",
    "-r",
    "-z",
    "--raw",
    "--no-renames",
    "--no-abbrev",
    checkpointTree,
    now,
  ]);
  if (raw.code !== 0) return { ok: false, reason: "snapshot_failed" };

  let headFiles = new Set<string>();
  if (head) {
    const listed = await ctx.git(ctx.root, ["ls-tree", "-r", "-z", "--name-only", head]);
    if (listed.code !== 0) return { ok: false, reason: "snapshot_failed" };
    headFiles = new Set(listed.stdout.split(NUL).filter((p) => p !== ""));
  }

  const restore: RestoreEntry[] = [];
  const kept: KeptEntry[] = [];
  const candidates: string[] = [];
  for (const entry of parseRaw(raw.stdout)) {
    if (entry.oldMode === GITLINK || entry.newMode === GITLINK) {
      kept.push({ path: entry.path, why: "submodule" });
      continue;
    }
    if (!isSafeRelPath(entry.path) || (await leadingSymlink(ctx.root, entry.path))) {
      kept.push({ path: entry.path, why: "unsafe_path" });
      continue;
    }
    // diff-tree <checkpoint> <now>: A = only in the working tree now, D = only in the checkpoint.
    if (entry.status === "A") candidates.push(entry.path);
    else if (entry.status === "D") restore.push({ path: entry.path, change: "deleted" });
    else if (entry.status === "T") restore.push({ path: entry.path, change: "type_changed" });
    else restore.push({ path: entry.path, change: "modified" });
  }

  const remove: string[] = [];
  const ignored = await ignoredAmong(ctx, candidates);
  for (const path of candidates) {
    if (headFiles.has(path)) kept.push({ path, why: "tracked_by_head" });
    else if (ignored === null || ignored.has(path)) kept.push({ path, why: "ignored" });
    else {
      let isFile = false;
      try {
        const st = await lstat(join(ctx.root, path));
        isFile = st.isFile() || st.isSymbolicLink();
      } catch {
        isFile = false;
      }
      if (isFile) remove.push(path);
      else kept.push({ path, why: "not_a_file" });
    }
  }

  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : 1);
  restore.sort(byPath);
  kept.sort(byPath);
  remove.sort();
  const unhashed = {
    checkpointId: subject.id,
    commitId: subject.commitId,
    checkpointTree,
    currentTree: now,
    headId: head,
    restore,
    remove,
    kept,
  };
  return { ok: true, ctx, plan: { ...unhashed, hash: previewHash(unhashed) } };
}

export interface DiffPreview {
  diff: string;
  truncated: boolean;
  redacted: boolean;
}

/** The text diff from the checkpoint to now: control characters out, secrets masked, bounded. */
export async function diffPreview(ctx: GitContext, plan: RollbackPlan): Promise<DiffPreview> {
  if (plan.checkpointTree === plan.currentTree)
    return { diff: "", truncated: false, redacted: false };
  const result = await ctx.git(ctx.root, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    plan.checkpointTree,
    plan.currentTree,
  ]);
  if (result.code !== 0) return { diff: "", truncated: false, redacted: false };
  const capped = capForRedaction(result.stdout);
  const masked = redactSecrets(capped.text);
  const bounded = boundDiff(masked);
  return {
    diff: bounded.diff,
    truncated: bounded.truncated || capped.cut,
    redacted: masked !== capped.text,
  };
}

/** Listing size the API shows; the counts stay exact. */
export const listed = <T>(items: readonly T[]): { items: T[]; truncated: boolean } => ({
  items: items.slice(0, MAX_LISTED),
  truncated: items.length > MAX_LISTED,
});

export type ApplyRefusal = PlanRefusal | "preview_stale" | "nothing_to_roll_back" | "apply_failed";

export type ApplyOutcome =
  | {
      ok: true;
      restored: number;
      removed: number;
      kept: number;
      /** The working tree equals the checkpoint tree afterwards. */
      exact: boolean;
    }
  | { ok: false; reason: ApplyRefusal };

/**
 * Applies a rollback. `expectedHash` is the preview hash the owner approved: the plan is rebuilt
 * from the repository as it is now and anything but the same hash is refused before a file moves.
 */
export async function applyRollback(
  base: Omit<GitContext, "root">,
  subject: PlanSubject,
  expectedHash: string,
): Promise<ApplyOutcome> {
  const planned = await planRollback(base, subject);
  if (!planned.ok) return planned;
  const { plan, ctx } = planned;
  if (plan.hash !== expectedHash) return { ok: false, reason: "preview_stale" };
  if (plan.restore.length === 0 && plan.remove.length === 0)
    return { ok: false, reason: "nothing_to_roll_back" };

  if (plan.restore.length > 0) {
    const dir = await mkdtemp(join(ctx.tmpDir, "phoenix-rollback-"));
    try {
      const env = { GIT_INDEX_FILE: join(dir, "index") };
      const read = await ctx.git(ctx.root, ["read-tree", plan.checkpointTree], { env });
      if (read.code !== 0) return { ok: false, reason: "apply_failed" };
      const out = await ctx.git(ctx.root, ["checkout-index", "-f", "-z", "--stdin"], {
        env,
        input: plan.restore.map((r) => r.path).join(NUL) + NUL,
      });
      if (out.code !== 0) return { ok: false, reason: "apply_failed" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  let removed = 0;
  for (const path of plan.remove) {
    const abs = join(ctx.root, ...path.split("/"));
    // Belt and braces: the plan already vetted it; never leave the project, never touch .git.
    if (!isSafeRelPath(path) || !abs.startsWith(ctx.root + sep)) continue;
    try {
      const st = await lstat(abs);
      if (st.isDirectory()) continue;
      await unlink(abs);
      removed++;
    } catch {
      // already gone: that is the state we wanted
      removed++;
    }
  }

  const after = await currentTree(ctx, plan.headId);
  return {
    ok: true,
    restored: plan.restore.length,
    removed,
    kept: plan.kept.length,
    exact: after === plan.checkpointTree,
  };
}
