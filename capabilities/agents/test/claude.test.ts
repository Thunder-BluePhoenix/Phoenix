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
    ["StopFailure", { state: "failed" }],
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

  it("StopFailure never copies the API error type, details or message", () => {
    const text = JSON.stringify(mapClaudeHook(HOOKS.StopFailure));
    expect(text).not.toMatch(/rate_limit|429|Rate limit|transcript/);
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

describe("Notification notification_type", () => {
  it("a typed permission or idle prompt keeps its reason whatever the message says", () => {
    expect(mapClaudeHook(HOOKS.NotificationTypedPermission)).toEqual({
      ...base,
      state: "waiting",
      reason: "permission",
    });
    expect(mapClaudeHook(HOOKS.NotificationTypedIdle)).toEqual({
      ...base,
      state: "waiting",
      reason: "idle",
    });
    // The type wins over the text: this message would read as "permission" by text alone.
    expect(
      mapClaudeHook({
        ...HOOKS.NotificationTypedIdle,
        message: "Claude needs your permission",
      }),
    ).toMatchObject({ reason: "idle" });
  });

  it.each([
    "auth_success",
    "auth_storage_failure",
    "elicitation_complete",
    "elicitation_response",
    "agent_completed",
    "quota_auto_resume_fired",
    "quota_auto_resume_disabled",
    "plugin_notification",
  ])("%s is not a wait and is ignored", (type) => {
    expect(mapClaudeHook({ ...HOOKS.NotificationPermission, notification_type: type })).toBeNull();
  });

  it.each([
    ["elicitation_dialog", "input"],
    ["elicitation_url_dialog", "input"],
    ["agent_needs_input", "input"],
    ["quota_auto_resume_stale", "input"],
  ] as const)("%s waits for %s", (type, reason) => {
    expect(mapClaudeHook({ ...HOOKS.NotificationIdle, notification_type: type })).toMatchObject({
      state: "waiting",
      reason,
    });
  });

  it("an unknown or non-string type falls back to the message text", () => {
    expect(
      mapClaudeHook({ ...HOOKS.NotificationPermission, notification_type: "brand_new" }),
    ).toMatchObject({ reason: "permission" });
    expect(mapClaudeHook({ ...HOOKS.NotificationIdle, notification_type: { a: 1 } })).toMatchObject(
      { reason: "idle" },
    );
    // A prototype key is not a known type.
    expect(
      mapClaudeHook({ ...HOOKS.NotificationIdle, notification_type: "constructor" }),
    ).toMatchObject({ reason: "idle" });
  });
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
        "StopFailure",
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
