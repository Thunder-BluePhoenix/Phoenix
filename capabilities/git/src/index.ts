// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Git capability (Phase 17): watches the repositories the user selected and
// emits git.* events for commits, branch switches, dirty working trees and
// merge conflicts. Read-only: it only ever runs `git status` and `git log`.
import { execFile } from "node:child_process";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { redact } from "@phoenix/logging";
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";

const run = promisify(execFile);

export interface RepoStatus {
  path: string;
  name: string;
  /** Branch name, or null when HEAD is detached. */
  branch: string | null;
  /** HEAD commit, or null before the first commit. */
  head: string | null;
  /** Changed, staged and untracked entries. */
  changed: number;
  conflicts: string[];
}

export type RepoState = RepoStatus | { path: string; name: string; error: string };

type GitEvent = Parameters<CapabilityContext["emit"]>[0];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], {
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
    // Never take the index lock: Phoenix must not get in the way of the user's own git commands.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout;
}

/** Reads one repository with a single `git status --porcelain=v2 --branch`. */
export async function readStatus(path: string): Promise<RepoStatus> {
  const out = await git(path, ["status", "--porcelain=v2", "--branch"]);
  const status: RepoStatus = {
    path,
    name: basename(path),
    branch: null,
    head: null,
    changed: 0,
    conflicts: [],
  };
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice(13);
      status.head = oid === "(initial)" ? null : oid;
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice(14);
      status.branch = head === "(detached)" ? null : head;
    } else if (line.startsWith("u ")) {
      status.conflicts.push(line.split(" ").slice(10).join(" "));
      status.changed++;
    } else if (/^[12?] /.test(line)) {
      status.changed++;
    }
  }
  return status;
}

/** Events for the transition prev → next. Pure, so the mapping is easy to test. */
export function diff(prev: RepoStatus, next: RepoStatus): GitEvent[] {
  const subject = next.name;
  const base = { repository: next.name, path: next.path };
  const events: GitEvent[] = [];
  if (prev.branch !== next.branch) {
    events.push({
      event_type: "git.branch.changed",
      severity: "info",
      subject,
      payload: { ...base, from: prev.branch, to: next.branch ?? "detached HEAD" },
    });
  } else if (next.head && prev.head !== next.head) {
    // ponytail: any HEAD move on the same branch counts as a commit (includes pull/reset);
    // use `merge-base --is-ancestor` if resets ever need telling apart.
    events.push({
      event_type: "git.commit.created",
      severity: "info",
      subject,
      payload: { ...base, sha: next.head, branch: next.branch },
    });
  }
  if (!prev.conflicts.length && next.conflicts.length) {
    events.push({
      event_type: "git.merge_conflict",
      severity: "warning",
      subject,
      payload: { ...base, files: next.conflicts.slice(0, 20) },
    });
  } else if (prev.conflicts.length && !next.conflicts.length) {
    events.push({
      event_type: "git.merge_conflict_resolved",
      severity: "success",
      subject,
      payload: base,
    });
  }
  if (!prev.changed && next.changed) {
    events.push({
      event_type: "git.working_tree.dirty",
      severity: "info",
      subject,
      payload: { ...base, changed: next.changed },
    });
  } else if (prev.changed && !next.changed) {
    events.push({ event_type: "git.working_tree.clean", severity: "info", subject, payload: base });
  }
  return events;
}

export function summarise(r: RepoState): string {
  if ("error" in r) return `${r.name}: ${r.error}`;
  const parts = [r.branch ?? "detached HEAD"];
  if (r.changed) parts.push(`${r.changed} changed`);
  if (r.conflicts.length) parts.push(`${r.conflicts.length} conflicted`);
  return `${r.name}: ${parts.join(" · ")}`;
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses `gitCapability`. */
export function createGitCapability() {
  const repos = new Map<string, RepoState>();
  let inflight: Promise<void> | null = null;

  async function pollOne(ctx: CapabilityContext, path: string): Promise<void> {
    const prev = repos.get(path);
    let next: RepoStatus;
    try {
      next = await readStatus(path);
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr?.trim().split("\n")[0] || String(err);
      repos.set(path, { path, name: basename(path), error: msg });
      return;
    }
    if (ctx.signal.aborted) return;
    repos.set(path, next);
    if (!prev || "error" in prev) {
      // First look: no history to diff, but an existing conflict still needs attention.
      if (next.conflicts.length) ctx.emit(diff({ ...next, conflicts: [] }, next)[0]!);
      return;
    }
    for (const event of diff(prev, next)) {
      if (event.event_type === "git.commit.created") {
        const message = await git(path, ["log", "-1", "--format=%s"]).catch(() => "");
        event.payload!.message = (redact(message.trim()) as string).slice(0, 200);
      }
      ctx.emit(event);
    }
  }

  function pollAll(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= Promise.all(paths(ctx).map((p) => pollOne(ctx, p)))
      .then(() => undefined)
      .finally(() => (inflight = null)));
  }

  const paths = (ctx: CapabilityContext) => (ctx.config.repositories as string[] | undefined) ?? [];

  return defineCapability({
    manifest: {
      id: "git",
      name: "Git",
      version: "0.1.0",
      description: "Watches your selected local repositories for commits, branches and conflicts.",
      license: "GPL-3.0-or-later",
      events: ["git.*"],
      permissions: ["repository_access"],
      data_categories: ["repository metadata", "commit messages"],
      healthcheck: { interval_ms: 5_000 },
      commands: [
        {
          name: "status",
          description: "Current branch, changes and conflicts of each watched repository",
          side_effect: "read",
          permissions: ["repository_access"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          repositories: {
            type: "array",
            maxItems: 50,
            items: { type: "string", minLength: 1 },
            description: "Absolute paths of the repositories to watch",
          },
          poll_ms: { type: "integer", minimum: 500, maximum: 60_000 },
        },
      },
    },
    init(ctx) {
      repos.clear();
      const relative = paths(ctx).filter((p) => !isAbsolute(p));
      if (relative.length)
        throw new Error(`Repository paths must be absolute: ${relative.join(", ")}`);
      const interval = (ctx.config.poll_ms as number | undefined) ?? 2_000;
      void (async () => {
        while (!ctx.signal.aborted) {
          await pollAll(ctx);
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, interval);
            ctx.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), {
              once: true,
            });
          });
        }
      })();
    },
    commands: {
      async status(_input, ctx) {
        await pollAll(ctx);
        return {
          repositories: paths(ctx)
            .map((p) => repos.get(p))
            .filter(Boolean),
        };
      },
    },
    health(ctx): HealthResult {
      const states = paths(ctx)
        .map((p) => repos.get(p))
        .filter((r): r is RepoState => !!r);
      if (!paths(ctx).length) return { status: "degraded", message: "No repositories selected" };
      if (!states.length) return { status: "healthy", message: "Reading repositories…" };
      const failed = states.filter((r) => "error" in r).length;
      return {
        status: failed === states.length ? "unhealthy" : failed ? "degraded" : "healthy",
        message: states.map(summarise).join("; "),
      };
    },
  });
}

export const gitCapability = createGitCapability();
