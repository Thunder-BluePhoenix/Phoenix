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
  command: [process.execPath, FAKE_AGENT],
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
