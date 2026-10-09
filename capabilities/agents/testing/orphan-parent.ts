// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for Phoenix Core that starts one session with the fake agent and prints the pids it
// finds, so a test can kill -9 this process and check that nothing it started survives.
// Usage: tsx orphan-parent.ts <fake-agent.cjs> <workspace> <mode>
import { SessionManager } from "../src/sessions";

const [agentPath, workspace, mode] = process.argv.slice(2);
if (!agentPath || !workspace || !mode) process.exit(2);

const manager = new SessionManager({
  now: Date.now,
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  env: process.env,
  maxSessions: 2,
  maxRuntimeMs: 600_000,
  graceMs: 200,
  isKillSwitchEngaged: () => false,
  onChange: () => {},
  warn: () => {},
});

const session = manager.start(
  "fake",
  { command: [process.execPath, agentPath], cwd_roots: [workspace] },
  workspace,
  `FAKE:${mode}\ntask`,
);

const timer = setInterval(() => {
  const out = manager.output(session.id, 50).stdout.join("\n");
  const agent = /fake-agent pid=(\d+)/.exec(out)?.[1];
  const helper = /helper pid=(\d+)/.exec(out)?.[1];
  if (agent && (mode !== "stubborn" || helper)) {
    process.stdout.write(
      `${JSON.stringify({ agent: Number(agent), helper: Number(helper ?? 0) })}\n`,
    );
    clearInterval(timer);
    // Stay alive until killed.
    setInterval(() => {}, 1 << 30);
  }
}, 20);
