// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Codex CLI adapter for Phase 56 approvals. What the public Codex hooks documentation
// (https://developers.openai.com/codex/hooks) says, and what this file relies on:
//   - A `PermissionRequest` command hook runs when Codex is about to ask for approval, receives
//     one JSON object on stdin (session_id, cwd, hook_event_name, tool_name, tool_input, ...) and
//     may print {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":
//     "allow"|"deny","message"?}}}. Exit 0 with no output means "no decision": Codex then uses its
//     normal approval prompt. That is the same wire format as Claude Code, so approval-map.ts is
//     reused; only the summary of `tool_input` differs.
//   - `tool_input.command` is the shell command for Bash and the patch text for `apply_patch`; MCP
//     tools send all their arguments; `tool_input.description` is optional.
//   - `updatedInput`, `updatedPermissions` and `interrupt` fail closed today, so they are never sent.
//   - `timeout` is in seconds (default 600). Non-managed hooks must be reviewed with `/hooks`.
// NOT confirmed (no public documentation found): a Codex counterpart of AskUserQuestion, so only
// permission approvals (Allow / Deny) exist for Codex. "Always" is a Phoenix rule, never a Codex one.
import {
  APPROVAL_TIMEOUT,
  approvalHookTimeoutSeconds,
  defaultSummary,
  shellQuote,
  summarizeExtra,
  type InputSummarizer,
  type InputSummary,
} from "./approval-map";
import { guardGroup, type GuardHook } from "./claude";
import { isRecord } from "./guards";

export const CODEX_AGENT = "codex";

/** Every file a patch touches: `*** Add|Update|Delete File: <p>` and `*** Move to: <p>`. */
const PATCH_FILE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;

/**
 * Bash and MCP tools: command / path / description like Claude Code. apply_patch: the files named
 * in the patch, never the patch text (it is file content). `path` is the first file. Several files
 * are all in the `command` (shell-quoted, space separated; Core's rule subject is the command, else
 * the path) so an Always rule covers every one of them, and in `detail` with the other tool-input
 * fields (escalation flags).
 */
export const codexSummary: InputSummarizer = (tool, toolInput) => {
  if (tool !== "apply_patch") return defaultSummary(tool, toolInput);
  const input = isRecord(toolInput) ? toolInput : {};
  const patch = typeof input.command === "string" ? input.command : "";
  const files = [...patch.matchAll(PATCH_FILE)].map((m) => m[1]!.trim()).filter((f) => f !== "");
  const { command: _patch, description, ...rest } = input;
  const extra = summarizeExtra({ ...rest, ...(files.length > 1 ? { files } : {}) });
  if (!extra) return null;
  const summary: InputSummary = {};
  if (files.length > 0) summary.path = files[0];
  // Core's rule subject is the command, else the path: a multi-file patch puts every file in it.
  if (files.length > 1) summary.command = files.map(shellQuote).join(" ");
  if (typeof description === "string" && description.length > 0) summary.description = description;
  return { ...summary, ...extra };
};

/** Per-agent summarizers; agents not listed use the Claude Code tool shapes. */
export const SUMMARIZERS: Readonly<Record<string, InputSummarizer>> = {
  [CODEX_AGENT]: codexSummary,
};

/**
 * The `hooks` object for ~/.codex/hooks.json (or `[hooks]` in config.toml). Printed, never written.
 * `timeout` is in seconds and is the decision timeout plus 10 s. With `guard`, a `PreToolUse` group
 * without a matcher runs the Phase 79 secret guard for every tool call (Codex's `PreToolUse` takes the
 * same deny shape, per its published hooks documentation; never run against a real Codex).
 */
export function codexHooksConfig(
  command: string,
  timeoutMs: number = APPROVAL_TIMEOUT.default,
  guard?: GuardHook,
): Record<string, unknown> {
  return {
    hooks: {
      PermissionRequest: [
        {
          hooks: [
            {
              type: "command",
              command,
              timeout: approvalHookTimeoutSeconds(timeoutMs),
              statusMessage: "Waiting for a Phoenix decision",
            },
          ],
        },
      ],
      ...(guard
        ? { PreToolUse: guardGroup(guard, { statusMessage: "Checking for secrets" }) }
        : {}),
    },
  };
}
