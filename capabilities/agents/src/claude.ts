// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Claude Code hook → AgentReport (Phase 25). Pure: the hook CLI (claude-hook.ts)
// reads stdin and calls this. Transcripts and tool inputs/outputs are never
// read: of everything Claude Code sends, only the fields below are looked at.
import { isAbsolute } from "node:path";
import {
  AGENT_ID_PATTERN,
  MAX_WORKSPACE,
  cleanTask,
  type AgentReport,
  type AgentState,
  type WaitReason,
} from "./report";
import { APPROVAL_TIMEOUT, approvalHookTimeoutSeconds } from "./approval-map";

export const CLAUDE_AGENT = "claude-code";

/**
 * Hook name → what the agent is doing. Every other hook (PreToolUse, SubagentStop, …) is ignored.
 * `StopFailure` ("the turn ends due to an API error", code.claude.com/docs/en/hooks#stopfailure,
 * first listed in the Claude Code changelog at 2.1.78) is the only failure hook mapped: a failed
 * tool call (`PostToolUseFailure`) is not the agent failing, Claude normally carries on. Claude
 * Code 2.0.31 rejects the name ("StopFailure" is not valid, shown by `claude doctor` against a
 * throwaway CLAUDE_CONFIG_DIR), as it does `PermissionRequest`, so these hooks need a newer
 * Claude Code. The payload's error type, details and message are never copied.
 */
export const CLAUDE_HOOK_STATES: Readonly<Record<string, AgentState>> = {
  SessionStart: "started",
  UserPromptSubmit: "working",
  // After a tool call finished the agent is working again (e.g. you just approved a permission).
  PostToolUse: "working",
  Notification: "waiting",
  Stop: "completed",
  StopFailure: "failed",
  SessionEnd: "ended",
};

/**
 * Claude Code 2.0.31 raises Notification hooks with these texts (read from its binary, see the
 * phase doc): "Claude needs your permission to use <tool>", "Claude Code needs your approval for
 * the plan", "Claude Code needs your attention" (permission prompts) and "Claude is waiting for
 * your input" (idle for a minute after a turn). Anything else is treated as a question.
 */
export function waitReason(message: unknown): WaitReason {
  const text = typeof message === "string" ? message.slice(0, 500) : "";
  if (/waiting for your input/i.test(text)) return "idle";
  if (/permission|approval|attention/i.test(text)) return "permission";
  return "input";
}

export interface ClaudeMapOptions {
  /** Include a title derived from the prompt of UserPromptSubmit (default false: prompts stay in Claude Code). */
  withTitle?: boolean;
}

interface HookPayload {
  hook_event_name?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  message?: unknown;
  prompt?: unknown;
}

/** Null when the hook is not one Phoenix follows or its payload is unusable. Never throws. */
export function mapClaudeHook(
  payload: unknown,
  options: ClaudeMapOptions = {},
): AgentReport | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as HookPayload;
  if (
    typeof p.hook_event_name !== "string" ||
    !Object.hasOwn(CLAUDE_HOOK_STATES, p.hook_event_name)
  ) {
    return null;
  }
  const state = CLAUDE_HOOK_STATES[p.hook_event_name]!;
  if (typeof p.session_id !== "string" || !AGENT_ID_PATTERN.test(p.session_id)) return null;
  if (
    typeof p.cwd !== "string" ||
    p.cwd.length > MAX_WORKSPACE ||
    !isAbsolute(p.cwd) ||
    /\p{Cc}/u.test(p.cwd)
  ) {
    return null;
  }
  const task =
    options.withTitle && p.hook_event_name === "UserPromptSubmit" && typeof p.prompt === "string"
      ? cleanTask(p.prompt)
      : undefined;
  return {
    agent: CLAUDE_AGENT,
    agent_id: p.session_id,
    state,
    workspace: p.cwd,
    ...(task ? { task } : {}),
    ...(state === "waiting" ? { reason: waitReason(p.message) } : {}),
  };
}

export interface ClaudeApprovalHooks {
  /** Command that runs approval-hook.ts (with its `--agent`/`--timeout-ms` flags, if any). */
  command: string;
  /** The decision timeout the command was built with; the hook timeout is this + 10 s. */
  timeoutMs?: number;
}

/** The secret guard (Phase 79): the command that runs guard-hook.ts and the timeout it was built with. */
export interface GuardHook {
  command: string;
  timeoutMs?: number;
}

/** The `PreToolUse` group of the secret guard: no matcher, because it reads every tool's input. */
export function guardGroup(guard: GuardHook, extra: Record<string, unknown> = {}): unknown[] {
  return [
    {
      hooks: [
        {
          type: "command",
          command: guard.command,
          timeout: approvalHookTimeoutSeconds(guard.timeoutMs ?? APPROVAL_TIMEOUT.default),
          ...extra,
        },
      ],
    },
  ];
}

/**
 * The `hooks` object for ~/.claude/settings.json; `command` is run for every followed hook
 * (observe-only, 5 s). With `approvals`, two more entries wait for a decision from Phoenix:
 * `PermissionRequest`, and `PreToolUse` limited to `AskUserQuestion`. Their `timeout` (seconds)
 * is the decision timeout plus 10 s, so the hook gives up (fail open) before Claude Code does.
 * With `guard`, a `PreToolUse` group without a matcher runs the secret guard for every tool call.
 */
export function claudeHooksConfig(
  command: string,
  approvals?: ClaudeApprovalHooks,
  guard?: GuardHook,
): Record<string, unknown> {
  const entry = [{ hooks: [{ type: "command", command, timeout: 5 }] }];
  const observed = Object.fromEntries(Object.keys(CLAUDE_HOOK_STATES).map((name) => [name, entry]));
  // PostToolUse emits the step for each completed tool; PreToolUse remains reserved for
  // AskUserQuestion approvals so a tool is not counted twice.
  const guarded = guard ? { PreToolUse: guardGroup(guard) } : {};
  if (!approvals) return { hooks: { ...observed, ...guarded } };
  const handler = {
    type: "command",
    command: approvals.command,
    timeout: approvalHookTimeoutSeconds(approvals.timeoutMs ?? APPROVAL_TIMEOUT.default),
  };
  return {
    hooks: {
      ...observed,
      PermissionRequest: [{ hooks: [handler] }],
      PreToolUse: [
        { matcher: "AskUserQuestion", hooks: [handler] },
        ...(guard ? guardGroup(guard) : []),
      ],
    },
  };
}
