// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The agent report contract (Phase 25): what an adapter tells Phoenix about a
// coding agent, how it is validated, and what the resulting `agent.*` event
// payload looks like. Pure and dependency-light so the hook CLIs can share it.
import { basename, isAbsolute } from "node:path";
import { redact } from "@phoenix/logging";

/**
 * `started` registers a session (it appears in `list`, no Fawkes state);
 * `working`/`waiting`/`completed`/`failed` map to the matching `agent.*` event;
 * `ended` removes the session (event `agent.ended`, which clears its Fawkes state).
 */
export const AGENT_STATES = ["started", "working", "waiting", "completed", "failed", "ended"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Why an agent is waiting: a permission prompt, a question, or an idle prompt. */
export const WAIT_REASONS = ["permission", "input", "idle"] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

export const MAX_AGENT = 40;
export const MAX_AGENT_ID = 100;
export const MAX_WORKSPACE = 1_000;
export const MAX_TASK = 120;

/** A short slug such as "claude-code" or "codex". */
export const AGENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** A session id (a UUID for Claude Code). */
export const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

const CONTROL_CHARS = /\p{Cc}/u;

/** What an adapter reports through the `report` command. */
export interface AgentReport {
  /** Which tool: "claude-code", "codex", or any slug up to 40 characters. */
  agent: string;
  /** The tool's own session id (up to 100 characters). */
  agent_id: string;
  state: AgentState;
  /** Absolute path of the agent's working directory. */
  workspace: string;
  /** Short title of the current task (up to 120 characters). Dropped unless `include_prompt_title` is on. */
  task?: string;
  /** Only with state "waiting". */
  reason?: WaitReason;
}

/** The payload of every `agent.*` event this capability emits. */
export type AgentEventPayload = {
  agent: string;
  agent_id: string;
  workspace: string;
  /** Last path segment of the workspace. */
  repository: string;
  task?: string;
  reason?: WaitReason;
  /** Set on an `agent.ended` event that Phoenix raised itself because the session went silent. */
  expired?: boolean;
};

export type ReportResult = { ok: true; report: AgentReport } | { ok: false; problems: string[] };

const REPORT_KEYS: readonly string[] = ["agent", "agent_id", "state", "workspace", "task", "reason"];

const isState = (v: unknown): v is AgentState =>
  typeof v === "string" && (AGENT_STATES as readonly string[]).includes(v);
const isReason = (v: unknown): v is WaitReason =>
  typeof v === "string" && (WAIT_REASONS as readonly string[]).includes(v);

/** Validates untrusted input without throwing; reports every problem found. */
export function validateReport(input: unknown): ReportResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, problems: ["report must be an object"] };
  }
  const r = input as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(r)) {
    if (!REPORT_KEYS.includes(key)) problems.push(`unknown field "${key}"`);
  }
  if (typeof r.agent !== "string" || !AGENT_PATTERN.test(r.agent)) {
    problems.push(`agent must be a slug of up to ${MAX_AGENT} characters (letters, digits, . _ -)`);
  }
  if (typeof r.agent_id !== "string" || !AGENT_ID_PATTERN.test(r.agent_id)) {
    problems.push(
      `agent_id must be up to ${MAX_AGENT_ID} characters (letters, digits, . _ : -)`,
    );
  }
  if (!isState(r.state)) problems.push(`state must be one of ${AGENT_STATES.join(", ")}`);
  if (
    typeof r.workspace !== "string" ||
    r.workspace.length === 0 ||
    r.workspace.length > MAX_WORKSPACE ||
    CONTROL_CHARS.test(r.workspace) ||
    !isAbsolute(r.workspace)
  ) {
    problems.push("workspace must be an absolute path without control characters");
  }
  if (r.task !== undefined) {
    if (typeof r.task !== "string" || r.task.length > MAX_TASK || CONTROL_CHARS.test(r.task)) {
      problems.push(`task must be a single line of at most ${MAX_TASK} characters`);
    }
  }
  if (r.reason !== undefined) {
    if (!isReason(r.reason)) problems.push(`reason must be one of ${WAIT_REASONS.join(", ")}`);
    else if (r.state !== "waiting") problems.push('reason is only allowed with state "waiting"');
  }
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    report: {
      agent: r.agent as string,
      agent_id: r.agent_id as string,
      state: r.state as AgentState,
      workspace: r.workspace as string,
      ...(r.task !== undefined ? { task: r.task as string } : {}),
      ...(r.reason !== undefined ? { reason: r.reason as WaitReason } : {}),
    },
  };
}

/** The repository name Phoenix shows: the last path segment of the workspace. */
export function repositoryName(workspace: string): string {
  return (basename(workspace) || workspace).slice(0, MAX_AGENT_ID);
}

/**
 * Turns free text (a user's prompt) into a task title: first non-empty line,
 * control characters removed, known secret formats redacted, hard-truncated.
 * Redaction only knows credential formats, so titles can still reveal what you are
 * working on; that is why prompt titles are off by default.
 */
export function cleanTask(text: string): string | undefined {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const plain = (redact(line.slice(0, 2_000).replace(/\p{Cc}/gu, " ")) as string)
    .replace(/\s+/g, " ")
    .trim();
  if (plain === "") return undefined;
  return plain.length > MAX_TASK ? plain.slice(0, MAX_TASK - 1) + "…" : plain;
}
