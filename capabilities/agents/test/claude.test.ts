// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { claudeHooksConfig, mapClaudeHook, waitReason } from "../src/claude";
import { validateReport } from "../src/report";
import { CWD, HOOKS, SESSION } from "./fixtures";

const base = { agent: "claude-code", agent_id: SESSION, workspace: CWD };

describe("mapClaudeHook", () => {
  it.each([
    ["SessionStart", { state: "started" }],
    ["UserPromptSubmit", { state: "working" }],
    ["PostToolUse", { state: "working" }],
    ["NotificationPermission", { state: "waiting", reason: "permission" }],
    ["NotificationIdle", { state: "waiting", reason: "idle" }],
    ["Stop", { state: "completed" }],
    ["SessionEnd", { state: "ended" }],
  ] as const)("%s → %j", (name, expected) => {
    expect(mapClaudeHook(HOOKS[name])).toEqual({ ...base, ...expected });
  });

  it.each(["PreToolUse", "SubagentStop"] as const)("ignores %s", (name) => {
    expect(mapClaudeHook(HOOKS[name])).toBeNull();
  });

  it("every mapped report passes the report validator", () => {
    for (const payload of Object.values(HOOKS)) {
      const report = mapClaudeHook(payload);
      if (report) expect(validateReport(report).ok).toBe(true);
    }
  });

  it("never copies transcript paths, tool inputs/outputs or the prompt", () => {
    const text = JSON.stringify([
      mapClaudeHook(HOOKS.PostToolUse),
      mapClaudeHook(HOOKS.UserPromptSubmit),
      mapClaudeHook(HOOKS.NotificationPermission),
    ]);
    expect(text).not.toMatch(/SECRET|id_rsa|flaky|transcript|jsonl|Bash/);
  });

  it("derives a title from the prompt only when asked, and only on UserPromptSubmit", () => {
    expect(mapClaudeHook(HOOKS.UserPromptSubmit, { withTitle: true })?.task).toBe(
      "Fix the flaky retry test in the sync module",
    );
    expect(mapClaudeHook(HOOKS.Stop, { withTitle: true })).not.toHaveProperty("task");
  });

  it("redacts and hard-truncates prompt titles", () => {
    const prompt = `use ghp_${"a".repeat(30)} to push\nsecond line ${"x".repeat(500)}`;
    const task = mapClaudeHook({ ...HOOKS.UserPromptSubmit, prompt }, { withTitle: true })?.task;
    expect(task).toBe("use [REDACTED] to push");
    const long = mapClaudeHook(
      { ...HOOKS.UserPromptSubmit, prompt: "y".repeat(5_000) },
      { withTitle: true },
    )?.task;
    expect(long).toHaveLength(120);
  });

  it.each([
    ["not an object", "Stop"],
    ["null", null],
    ["array", [HOOKS.Stop]],
    ["no hook name", { ...HOOKS.Stop, hook_event_name: undefined }],
    ["prototype hook name", { ...HOOKS.Stop, hook_event_name: "constructor" }],
    ["numeric hook name", { ...HOOKS.Stop, hook_event_name: 5 }],
    ["relative cwd", { ...HOOKS.Stop, cwd: "projects/phoenix" }],
    ["control chars in cwd", { ...HOOKS.Stop, cwd: "/home/me/\u001b[31mred" }],
    ["giant cwd", { ...HOOKS.Stop, cwd: "/" + "a".repeat(5_000) }],
    ["missing session", { ...HOOKS.Stop, session_id: undefined }],
    ["session with slash", { ...HOOKS.Stop, session_id: "../../etc/passwd" }],
    ["giant session", { ...HOOKS.Stop, session_id: "a".repeat(101) }],
    ["session id of wrong type", { ...HOOKS.Stop, session_id: 12 }],
  ])("drops %s", (_name, payload) => {
    expect(mapClaudeHook(payload)).toBeNull();
  });

  it("tolerates a hostile Notification message", () => {
    const report = mapClaudeHook({ ...HOOKS.NotificationPermission, message: { a: 1 } });
    expect(report).toMatchObject({ state: "waiting", reason: "input" });
    expect(waitReason("x".repeat(1_000_000))).toBe("input");
  });
});

describe("waitReason", () => {
  it.each([
    ["Claude needs your permission to use Edit", "permission"],
    ["Claude Code needs your approval for the plan", "permission"],
    ["Claude Code needs your attention", "permission"],
    ["Claude is waiting for your input", "idle"],
    ["something new we have never seen", "input"],
    [undefined, "input"],
  ] as const)("%s → %s", (message, reason) => expect(waitReason(message)).toBe(reason));
});

describe("claudeHooksConfig", () => {
  it("registers a command hook for exactly the followed hooks", () => {
    const config = claudeHooksConfig("tsx hook.ts") as {
      hooks: Record<string, { hooks: { type: string; command: string; timeout: number }[] }[]>;
    };
    expect(Object.keys(config.hooks).sort()).toEqual(
      [
        "Notification",
        "PostToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "UserPromptSubmit",
      ].sort(),
    );
    expect(config.hooks.Stop?.[0]?.hooks[0]).toEqual({
      type: "command",
      command: "tsx hook.ts",
      timeout: 5,
    });
  });
});
