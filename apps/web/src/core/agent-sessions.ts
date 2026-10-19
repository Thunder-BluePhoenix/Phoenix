// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatNumber, translated } from "./format";
import { translate } from "../i18n/store";
import type { AgentLauncher } from "./types";

/** The limits the `agents` capability enforces on a start (capabilities/agents/src). */
export const MAX_PROMPT_CHARS = 8_000;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_QUESTION_CHARS = 300;
export const MAX_WORKSPACE_CHARS = 1_000;
/** Lines asked of `session.get` (its maximum). */
export const OUTPUT_LINES = 200;

export const SESSION_STATE_TEXT = translated({
  running: "agents.sessionState.running",
  waiting: "agents.sessionState.waiting",
  completed: "agents.sessionState.completed",
  failed: "agents.sessionState.failed",
  stopped: "agents.sessionState.stopped",
});

export const LINK_KIND_TEXT = translated({
  commit: "agents.linkKind.commit",
  ci_run: "agents.linkKind.ci_run",
  pr: "agents.linkKind.pr",
  task: "agents.linkKind.task",
});

export const CONFIDENCE_TEXT = translated({
  "time+path": "agents.confidence.timePath",
  "sha-match": "agents.confidence.shaMatch",
  "branch-match": "agents.confidence.branchMatch",
  user: "agents.confidence.user",
  ambiguous: "agents.confidence.ambiguous",
});

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The launchers in the `agents` capability's config: name, fixed command and allowed folders. */
export function launchersOf(
  config: Record<string, unknown> | undefined,
): Record<string, AgentLauncher> {
  const raw = config?.launchers;
  const out: Record<string, AgentLauncher> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [name, spec] of Object.entries(raw)) {
    if (typeof spec === "object" && spec !== null) {
      out[name] = {
        command: "command" in spec ? strings(spec.command) : [],
        cwd_roots: "cwd_roots" in spec ? strings(spec.cwd_roots) : [],
      };
    }
  }
  return out;
}

export interface StartInput {
  launcher: string;
  workspace: string;
  prompt: string;
}

export interface StartProblems {
  launcher?: string;
  workspace?: string;
  prompt?: string;
}

/** A whole number with the digits of the language but no grouping: "8000", as the limits are written. */
export const PLAIN_NUMBER: Intl.NumberFormatOptions = { useGrouping: false };

/** The same rules the command schema applies, so a form says what Core would say. */
export function validateStart(
  input: StartInput,
  launchers: Record<string, AgentLauncher>,
): StartProblems {
  const problems: StartProblems = {};
  if (!Object.hasOwn(launchers, input.launcher))
    problems.launcher = translate("agents.validate.chooseLauncher");
  const workspace = input.workspace.trim();
  if (workspace.length === 0) problems.workspace = translate("agents.validate.workspaceEmpty");
  else if (!workspace.startsWith("/"))
    problems.workspace = translate("agents.validate.workspaceAbsolute");
  else if (workspace.length > MAX_WORKSPACE_CHARS)
    problems.workspace = translate("agents.validate.workspaceTooLong", {
      max: formatNumber(MAX_WORKSPACE_CHARS, undefined, PLAIN_NUMBER),
    });
  else if (/[\u0000-\u001f\u007f-\u009f]/.test(workspace))
    problems.workspace = translate("agents.validate.workspaceControl");
  if (input.prompt.trim().length === 0) problems.prompt = translate("agents.validate.promptEmpty");
  else if (input.prompt.length > MAX_PROMPT_CHARS) {
    problems.prompt = translate("agents.validate.promptTooLong", {
      length: formatNumber(input.prompt.length, undefined, PLAIN_NUMBER),
      max: formatNumber(MAX_PROMPT_CHARS, undefined, PLAIN_NUMBER),
    });
  }
  return problems;
}
