// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared helpers for the orchestration tests: a throwaway workspace, launcher configs that run the
// fake agent, and process probes.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type SessionManagerOptions } from "../src/sessions";
import type { LauncherSpec } from "../src/launchers";

export const FAKE_AGENT = join(import.meta.dirname, "../testing/fake-agent.cjs");

const dirs: string[] = [];
export function tempDir(name = "phoenix-agents-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), name)));
  dirs.push(dir);
  return dir;
}
export function cleanTempDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** A workspace folder with a `project` subfolder, plus the root a launcher may use. */
export function workspaceIn(): { root: string; workspace: string } {
  const root = tempDir();
  const workspace = join(root, "project");
  mkdirSync(workspace);
  return { root, workspace };
}

export const fakeLauncher = (root: string, over: Partial<LauncherSpec> = {}): LauncherSpec => ({
  command: [FAKE_AGENT],
  cwd_roots: [root],
  waiting_prompts: ["(y/n)"],
  ...over,
});

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A scheduler the test fires by hand, so no test waits for a real timeout. */
export function manualScheduler() {
  const pending: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const entry = { fn, ms, live: true };
      pending.push(entry);
      return () => {
        entry.live = false;
      };
    },
    /** Runs every live timer scheduled with `ms` or more (the max-runtime timer). */
    fire(minMs: number) {
      for (const e of pending.filter((p) => p.live && p.ms >= minMs)) {
        e.live = false;
        e.fn();
      }
    },
    live: () => pending.filter((p) => p.live).length,
  };
}

export function managerFor(over: Partial<SessionManagerOptions> = {}) {
  const changes: { id: string; change: string }[] = [];
  const scheduler = manualScheduler();
  const manager = new SessionManager({
    now: Date.now,
    schedule: scheduler.schedule,
    env: process.env,
    maxSessions: 3,
    maxRuntimeMs: 3_600_000,
    graceMs: 150,
    isKillSwitchEngaged: () => false,
    onChange: (view, change) => void changes.push({ id: view.id, change }),
    warn: () => {},
    ...over,
  });
  return { manager, changes, scheduler };
}

// ── A harness with the orchestration half connected ─────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { createAgentsCapability } from "../src";
import type { AgentsServices, AuditRecord, ContextPort } from "../src/orchestration";

export interface Orchestrated {
  h: Harness;
  audit: AuditRecord[];
  root: string;
  workspace: string;
  /** Config the user would have saved: one launcher that runs the fake agent. */
  launchers: Record<string, unknown>;
  /** Runs a command like the Pet Panel would: confirmations are answered with `approve`. */
  run: (command: string, input?: unknown, approve?: boolean) => ReturnType<Harness["run"]>;
  commitTimes: Record<string, number>;
}

export async function orchestrated(
  over: {
    config?: Record<string, unknown>;
    context?: ContextPort;
    commitTimes?: Record<string, number>;
    killSwitch?: () => boolean;
    now?: () => number;
  } = {},
): Promise<Orchestrated> {
  const { root, workspace } = workspaceIn();
  const audit: AuditRecord[] = [];
  const commitTimes = over.commitTimes ?? {};
  const holder: { h?: Harness } = {};
  const module = createAgentsCapability({
    ...(over.now ? { now: over.now } : {}),
    services: (): AgentsServices => ({
      db: holder.h!.db,
      events: holder.h!.bus,
      audit: (record) => {
        audit.push(record);
        holder.h!.permissions.audit.record(record);
      },
      isKillSwitchEngaged: over.killSwitch ?? (() => holder.h!.permissions.isKillSwitchEngaged()),
      ...(over.context ? { context: over.context } : {}),
      commitTime: async (_path, sha) => commitTimes[sha],
      env: process.env,
    }),
  });
  const h = createHarness({ modules: [module] });
  holder.h = h;
  const launchers = { fake: fakeLauncher(root) };
  h.manager.configure("agents", { launchers, grace_ms: 150, ...over.config });
  await h.enable("agents");
  return {
    h,
    audit,
    root,
    workspace,
    launchers,
    commitTimes,
    run: (command, input = {}, approve = true) => h.run("agents", command, input, approve),
  };
}

/** Initialises a throwaway git repository with one commit (for tests that use real git). */
export function gitRepo(dir: string): string {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
      encoding: "utf8",
    }).trim();
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "first");
  return git("rev-parse", "HEAD");
}
