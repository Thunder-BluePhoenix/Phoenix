// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AgentLauncher, OrchestratedState } from "./types";

/** The limits the `agents` capability enforces on a start (capabilities/agents/src). */
export const MAX_PROMPT_CHARS = 8_000;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_QUESTION_CHARS = 300;
export const MAX_WORKSPACE_CHARS = 1_000;
/** Lines asked of `session.get` (its maximum). */
export const OUTPUT_LINES = 200;

export const SESSION_STATE_TEXT: Record<OrchestratedState, string> = {
  running: "Running",
  waiting: "Waiting for your input",
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

export const LINK_KIND_TEXT: Record<string, string> = {
  commit: "Commit",
  ci_run: "CI run",
  pr: "Pull request",
  task: "Task",
};

export const CONFIDENCE_TEXT: Record<string, string> = {
  "time+path": "matched by time and folder",
  "sha-match": "matched by commit id",
  "branch-match": "matched by branch",
  user: "chosen by you",
  ambiguous: "ambiguous: more than one session fits",
};

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

/** The same rules the command schema applies, so a form says what Core would say. */
export function validateStart(
  input: StartInput,
  launchers: Record<string, AgentLauncher>,
): StartProblems {
  const problems: StartProblems = {};
  if (!Object.hasOwn(launchers, input.launcher)) problems.launcher = "Choose a launcher.";
  const workspace = input.workspace.trim();
  if (workspace.length === 0) problems.workspace = "Enter the folder the agent should work in.";
  else if (!workspace.startsWith("/"))
    problems.workspace = "The workspace must be an absolute path starting with /.";
  else if (workspace.length > MAX_WORKSPACE_CHARS)
    problems.workspace = `The path is longer than ${MAX_WORKSPACE_CHARS} characters.`;
  else if (/[\u0000-\u001f\u007f-\u009f]/.test(workspace))
    problems.workspace = "The path must not contain control characters.";
  if (input.prompt.trim().length === 0) problems.prompt = "Write what the agent should do.";
  else if (input.prompt.length > MAX_PROMPT_CHARS) {
    problems.prompt = `The prompt is ${input.prompt.length} characters; the most allowed is ${MAX_PROMPT_CHARS}.`;
  }
  return problems;
}
