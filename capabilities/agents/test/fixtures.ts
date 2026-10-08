// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hook payloads shaped like Claude Code 2.0.31 sends them. The field names were read from the
// installed binary (common fields session_id, transcript_path, cwd, permission_mode, plus
// hook_event_name and the per-hook extras); they are NOT captures of a live session.
export const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";
export const CWD = "/home/me/projects/phoenix";

const common = {
  session_id: SESSION,
  transcript_path: `/home/me/.claude/projects/-home-me-projects-phoenix/${SESSION}.jsonl`,
  cwd: CWD,
  permission_mode: "default",
};

export const HOOKS = {
  SessionStart: { ...common, hook_event_name: "SessionStart", source: "startup" },
  UserPromptSubmit: {
    ...common,
    hook_event_name: "UserPromptSubmit",
    prompt: "Fix the flaky retry test in the sync module",
  },
  PostToolUse: {
    ...common,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "cat ~/.ssh/id_rsa" },
    tool_response: { stdout: "TOP SECRET TOOL OUTPUT" },
  },
  NotificationPermission: {
    ...common,
    hook_event_name: "Notification",
    message: "Claude needs your permission to use Bash",
  },
  NotificationIdle: {
    ...common,
    hook_event_name: "Notification",
    message: "Claude is waiting for your input",
  },
  Stop: { ...common, hook_event_name: "Stop", stop_hook_active: false },
  SessionEnd: { ...common, hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
  PreToolUse: { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} },
  SubagentStop: { ...common, hook_event_name: "SubagentStop", stop_hook_active: false },
} as const;
