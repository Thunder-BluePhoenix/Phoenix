// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 56: pure mapping between a coding agent's approval hook and Phoenix's agent-approval
// protocol. Claude Code `PermissionRequest` and `PreToolUse(AskUserQuestion)` payloads become a
// request for Core; Core's decision becomes the one JSON line the hook prints. Everything in the
// payload is untrusted data: it is copied into JSON values and never interpreted.
//
// Fail-open rule: whenever anything is unusable the functions return null, meaning "no
// decision", and the hook prints nothing so the agent asks in its own terminal.
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { isRecord } from "./guards";

/** Agent slug accepted by Core (`--agent <name>`). */
export const APPROVAL_AGENT_PATTERN = /^[a-z0-9-]{1,24}$/;

export const MAX_SESSION_ID = 200;
export const MAX_PROJECT = 1_000;
export const MAX_TOOL = 100;
export const MAX_COMMAND = 2_000;
export const MAX_PATH = 1_000;
export const MAX_DESCRIPTION = 500;
export const MAX_MESSAGE = 500;
export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 10;
export const MAX_QUESTION = 500;
export const MAX_HEADER = 100;
export const MAX_LABEL = 200;
export const MAX_ANSWER = 2_000;

/** How long Core keeps a request open (`timeout_ms`), and what the hook waits at most. */
export const APPROVAL_TIMEOUT = { min: 5_000, max: 600_000, default: 120_000 } as const;
/** The agent's own hook timeout is this much longer than the decision timeout. */
export const HOOK_TIMEOUT_MARGIN_MS = 10_000;

export function isApprovalTimeout(ms: unknown): ms is number {
  return (
    typeof ms === "number" &&
    Number.isInteger(ms) &&
    ms >= APPROVAL_TIMEOUT.min &&
    ms <= APPROVAL_TIMEOUT.max
  );
}

/** The `timeout` (in seconds) to put in the agent's hook settings for a decision timeout. */
export function approvalHookTimeoutSeconds(timeoutMs: number): number {
  return Math.ceil((timeoutMs + HOOK_TIMEOUT_MARGIN_MS) / 1_000);
}

export type ApprovalKind = "permission" | "question";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface ApprovalQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface InputSummary {
  command?: string;
  path?: string;
  description?: string;
}

/** The body of `POST /api/agent-approvals`. */
export interface ApprovalRequest {
  kind: ApprovalKind;
  agent: string;
  session_id: string;
  project: string;
  tool: string;
  input_summary: InputSummary;
  questions?: ApprovalQuestion[];
  timeout_ms: number;
  suggestions_ok?: boolean;
}

/** What Core decided. `always` is applied by Core itself and never reaches the agent. */
export interface ApprovalDecision {
  behavior: "allow" | "deny";
  message?: string;
  answers?: Record<string, string>;
}

/** A request plus what is needed to turn the decision back into the agent's stdout. */
export interface MappedApproval {
  request: ApprovalRequest;
  /** Question kind: `tool_input` of the original call, echoed back with the answers. */
  originalInput?: Record<string, unknown>;
}

/** Agent-specific summary of a tool input; the default covers the Claude Code tools. */
export type InputSummarizer = (tool: string, toolInput: unknown) => InputSummary;

export interface MapOptions {
  agent: string;
  timeoutMs?: number;
  summarize?: InputSummarizer;
}

const nonEmpty = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

/** JSON with object keys sorted, so equal data always serialises to equal text. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 40) throw new Error("value is nested too deeply");
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v, depth + 1)).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, depth + 1)}`).join(",")}}`;
}

/** sha256 hex of canonical JSON {agent, session_id, project, tool, input_summary}. */
export function approvalDigest(request: ApprovalRequest): string {
  const { agent, session_id, project, tool, input_summary } = request;
  return createHash("sha256")
    .update(canonicalJson({ agent, session_id, project, tool, input_summary }))
    .digest("hex");
}

const optionalString = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;

/** command / path / description of a tool input; nothing else (file contents, args) is copied. */
export function defaultSummary(_tool: string, toolInput: unknown): InputSummary {
  if (!isRecord(toolInput)) return {};
  const command = Array.isArray(toolInput.command)
    ? toolInput.command.every((p) => typeof p === "string")
      ? optionalString((toolInput.command as string[]).join(" "), MAX_COMMAND)
      : undefined
    : optionalString(toolInput.command, MAX_COMMAND);
  const path = optionalString(
    toolInput.file_path ?? toolInput.path ?? toolInput.notebook_path,
    MAX_PATH,
  );
  const description = optionalString(toolInput.description, MAX_DESCRIPTION);
  return {
    ...(command ? { command } : {}),
    ...(path ? { path } : {}),
    ...(description ? { description } : {}),
  };
}

function parseQuestions(raw: unknown): ApprovalQuestion[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_QUESTIONS) return null;
  const questions: ApprovalQuestion[] = [];
  for (const q of raw as unknown[]) {
    if (!isRecord(q) || !nonEmpty(q.question, MAX_QUESTION) || typeof q.header !== "string") {
      return null;
    }
    if (q.header.length > MAX_HEADER) return null;
    if (!Array.isArray(q.options) || q.options.length < 1 || q.options.length > MAX_OPTIONS) {
      return null;
    }
    const options: QuestionOption[] = [];
    for (const o of q.options as unknown[]) {
      if (!isRecord(o) || !nonEmpty(o.label, MAX_LABEL)) return null;
      if (o.description !== undefined && typeof o.description !== "string") return null;
      options.push({
        label: o.label,
        ...(typeof o.description === "string" ? { description: o.description.slice(0, 500) } : {}),
      });
    }
    // Answers are keyed by question text and made of labels: both must be unambiguous.
    if (new Set(options.map((o) => o.label)).size !== options.length) return null;
    if (q.multiSelect !== undefined && typeof q.multiSelect !== "boolean") return null;
    questions.push({
      question: q.question,
      header: q.header,
      options,
      ...(q.multiSelect === true ? { multiSelect: true } : {}),
    });
  }
  if (new Set(questions.map((q) => q.question)).size !== questions.length) return null;
  return questions;
}

function commonFields(
  payload: Record<string, unknown>,
): { session_id: string; project: string; tool: string } | null {
  const { session_id, cwd, tool_name } = payload;
  if (!nonEmpty(session_id, MAX_SESSION_ID)) return null;
  if (
    typeof cwd !== "string" ||
    cwd.length > MAX_PROJECT ||
    !isAbsolute(cwd) ||
    /\p{Cc}/u.test(cwd)
  ) {
    return null;
  }
  if (!nonEmpty(tool_name, MAX_TOOL)) return null;
  return { session_id, project: cwd, tool: tool_name };
}

/**
 * Maps a hook payload to a protocol request, or null when Phoenix does not handle it:
 * `PermissionRequest` (any tool but AskUserQuestion) and `PreToolUse` of `AskUserQuestion`.
 * Works for every agent that sends Claude Code's payload shape (Codex does, see approval-codex.ts).
 */
export function mapApprovalPayload(payload: unknown, options: MapOptions): MappedApproval | null {
  if (!isRecord(payload) || !APPROVAL_AGENT_PATTERN.test(options.agent)) return null;
  const timeout_ms = options.timeoutMs ?? APPROVAL_TIMEOUT.default;
  if (!isApprovalTimeout(timeout_ms)) return null;
  const common = commonFields(payload);
  if (!common) return null;
  const base = { agent: options.agent, ...common, timeout_ms };

  if (payload.hook_event_name === "PermissionRequest" && common.tool !== "AskUserQuestion") {
    const summarize = options.summarize ?? defaultSummary;
    return {
      request: {
        kind: "permission",
        ...base,
        input_summary: summarize(common.tool, payload.tool_input),
        suggestions_ok: true,
      },
    };
  }

  if (payload.hook_event_name === "PreToolUse" && common.tool === "AskUserQuestion") {
    if (!isRecord(payload.tool_input)) return null;
    const questions = parseQuestions(payload.tool_input.questions);
    if (!questions) return null;
    return {
      request: { kind: "question", ...base, input_summary: {}, questions },
      originalInput: payload.tool_input,
    };
  }
  return null;
}

/** Validates Core's decision object; null when it is not one. Never throws. */
export function parseDecision(raw: unknown): ApprovalDecision | null {
  if (!isRecord(raw)) return null;
  if (raw.behavior !== "allow" && raw.behavior !== "deny") return null;
  if (raw.message !== undefined && typeof raw.message !== "string") return null;
  let answers: Record<string, string> | undefined;
  if (raw.answers !== undefined) {
    if (!isRecord(raw.answers)) return null;
    answers = {};
    for (const [key, value] of Object.entries(raw.answers)) {
      if (typeof value !== "string") return null;
      answers[key] = value;
    }
  }
  return {
    behavior: raw.behavior,
    ...(raw.message ? { message: raw.message.slice(0, MAX_MESSAGE) } : {}),
    ...(answers ? { answers } : {}),
  };
}

/**
 * Splits a multi-select answer ("A,B") into option labels. Labels may themselves contain commas,
 * so this matches known labels rather than splitting blindly. Null if it is not a joined list of
 * distinct labels.
 */
function splitLabels(answer: string, labels: readonly string[]): string[] | null {
  if (answer.length === 0 || answer.length > MAX_ANSWER) return null;
  const walk = (rest: string, used: readonly string[]): string[] | null => {
    for (const label of labels) {
      if (used.includes(label) || !rest.startsWith(label)) continue;
      if (rest.length === label.length) return [...used, label];
      if (rest[label.length] !== ",") continue;
      const found = walk(rest.slice(label.length + 1), [...used, label]);
      if (found) return found;
    }
    return null;
  };
  return walk(answer, []);
}

/** True when every question has exactly one answer made only of its own option labels. */
export function answersMatch(
  questions: readonly ApprovalQuestion[],
  answers: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(answers);
  if (keys.length !== questions.length) return false;
  return questions.every((q) => {
    if (!Object.hasOwn(answers, q.question)) return false;
    const answer = answers[q.question]!;
    const labels = q.options.map((o) => o.label);
    return q.multiSelect ? splitLabels(answer, labels) !== null : labels.includes(answer);
  });
}

/**
 * The single JSON line the hook prints for a decision, or null for "no decision". Null also when
 * the decision does not fit the request (for example answers naming an option that does not exist).
 */
export function renderDecision(mapped: MappedApproval, decision: ApprovalDecision): string | null {
  const { request } = mapped;
  if (request.kind === "permission") {
    const out =
      decision.behavior === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", ...(decision.message ? { message: decision.message } : {}) };
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: out },
    });
  }

  if (decision.behavior === "deny") {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        ...(decision.message ? { permissionDecisionReason: decision.message } : {}),
      },
    });
  }
  if (!request.questions || !mapped.originalInput || !decision.answers) return null;
  if (!answersMatch(request.questions, decision.answers)) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...mapped.originalInput, answers: decision.answers },
    },
  });
}
