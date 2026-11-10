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
 * `StopFailure` ("the turn ends due to an API error", code.claude.com/docs/en/hooks#stopfailure)
 * is the only failure hook mapped: a failed tool call (`PostToolUseFailure`) is not the agent
 * failing, Claude normally carries on. Claude Code 2.0.31 rejects the name and `PermissionRequest`
 * ("not valid", shown by `claude doctor` against a throwaway CLAUDE_CONFIG_DIR); 2.1.308 accepts
 * the whole printed hooks set (same check; a deliberately unknown event name in a control dir is
 * reported, so the check does validate). The payload's error type, details and message are never
 * copied.
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

/**
 * Newer Claude Code sends `notification_type` on Notification hooks
 * (code.claude.com/docs/en/hooks#notification, read 2026-11-10). The types that mean Claude is
 * waiting for the person map to a reason. The rest are not a wait (sign-in finished, an MCP
 * elicitation completed or answered, a background session finished, a usage-limit wait ended or
 * was given up, a mod's notice) and are ignored, so they never show as WAITING. A type this
 * version does not know, or no type (Claude Code 2.0.x), falls back to the message text.
 */
const NOTIFICATION_WAITS: Readonly<Record<string, WaitReason>> = {
  permission_prompt: "permission",
  idle_prompt: "idle",
  elicitation_dialog: "input",
  elicitation_url_dialog: "input",
  agent_needs_input: "input",
  // Claude Code stopped at a usage-limit reset and waits for Enter.
  quota_auto_resume_stale: "input",
};
const NOTIFICATION_NOT_WAITS: Readonly<Record<string, true>> = {
  auth_success: true,
  auth_storage_failure: true,
  elicitation_complete: true,
  elicitation_response: true,
  agent_completed: true,
  quota_auto_resume_fired: true,
  quota_auto_resume_disabled: true,
  plugin_notification: true,
};

/** The wait a Notification payload means, or null when it is a notification that is not a wait. */
export function notificationWait(type: unknown, message: unknown): WaitReason | null {
  if (typeof type === "string") {
    if (Object.hasOwn(NOTIFICATION_WAITS, type)) return NOTIFICATION_WAITS[type]!;
    if (Object.hasOwn(NOTIFICATION_NOT_WAITS, type)) return null;
  }
  return waitReason(message);
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
  notification_type?: unknown;
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
  const reason = state === "waiting" ? notificationWait(p.notification_type, p.message) : undefined;
  if (state === "waiting" && reason === null) return null;
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
    ...(reason ? { reason } : {}),
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
