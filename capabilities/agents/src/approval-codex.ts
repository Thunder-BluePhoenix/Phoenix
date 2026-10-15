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
  MAX_PATH,
  type InputSummarizer,
  type InputSummary,
} from "./approval-map";
import { isRecord } from "./guards";

export const CODEX_AGENT = "codex";

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m;

/**
 * Bash and MCP tools: command / path / description like Claude Code. apply_patch: the first file
 * named in the patch, never the patch text (it is file content).
 */
export const codexSummary: InputSummarizer = (tool, toolInput) => {
  if (tool !== "apply_patch") return defaultSummary(tool, toolInput);
  const input = isRecord(toolInput) ? toolInput : {};
  const patch = typeof input.command === "string" ? input.command : "";
  const file = PATCH_FILE.exec(patch)?.[1]?.trim();
  const summary: InputSummary = defaultSummary(tool, { description: input.description });
  if (file && file.length <= MAX_PATH && !/\p{Cc}/u.test(file)) summary.path = file;
  return summary;
};

/** Per-agent summarizers; agents not listed use the Claude Code tool shapes. */
export const SUMMARIZERS: Readonly<Record<string, InputSummarizer>> = {
  [CODEX_AGENT]: codexSummary,
};

/**
 * The `hooks` object for ~/.codex/hooks.json (or `[hooks]` in config.toml). Printed, never written.
 * `timeout` is in seconds and is the decision timeout plus 10 s.
 */
export function codexHooksConfig(
  command: string,
  timeoutMs: number = APPROVAL_TIMEOUT.default,
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
    },
  };
}
