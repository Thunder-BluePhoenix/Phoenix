// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pure mapping from the hook payloads of the agents Phoenix installs into (Cursor, Gemini CLI,
// Copilot CLI, Codex, Muse Code) and from the environment of the OpenCode/Amp plugins to an
// AgentReport. Field names are the ones in each vendor's public hooks documentation (see
// adapters.ts for the URLs). Prompts, tool inputs and transcripts are never read.
import { isAbsolute } from "node:path";
import { waitReason } from "../claude";
import { isRecord } from "../guards";
import {
  AGENT_ID_PATTERN,
  AGENT_PATTERN,
  AGENT_STATES,
  MAX_WORKSPACE,
  type AgentReport,
  type AgentState,
} from "../report";
import { validateTokenUsage, type TokenUsageReport } from "../usage";

/** Hook event name (any agent's spelling) → what the agent is doing. Everything else is ignored. */
export const EVENT_STATES: Readonly<Record<string, AgentState>> = {
  sessionStart: "started",
  SessionStart: "started",
  beforeSubmitPrompt: "working",
  UserPromptSubmit: "working",
  userPromptSubmitted: "working",
  BeforeAgent: "working",
  PostToolUse: "working",
  postToolUse: "working",
  afterShellExecution: "working",
  AfterTool: "working",
  stop: "completed",
  Stop: "completed",
  AfterAgent: "completed",
  agentStop: "completed",
  sessionEnd: "ended",
  SessionEnd: "ended",
  Notification: "waiting",
  notification: "waiting",
};

export interface GenericOptions {
  agent: string;
  /** The event the installed command was written for (`--event`); a payload name wins over it. */
  event?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

function sessionId(
  p: Record<string, unknown>,
  env: Record<string, string | undefined>,
): string | undefined {
  return (
    text(p.session_id) ??
    text(p.sessionId) ??
    text(p.conversation_id) ??
    text(p.conversationId) ??
    text(env.PHOENIX_AGENT_ID)
  );
}

function workspace(
  p: Record<string, unknown>,
  env: Record<string, string | undefined>,
  cwd: string,
): string {
  const roots = Array.isArray(p.workspace_roots) ? p.workspace_roots : [];
  return text(p.cwd) ?? text(roots[0]) ?? text(env.PHOENIX_AGENT_WORKSPACE) ?? cwd;
}

/** A failed or aborted end of turn is "failed"; the agents say so in `status`/`stop_reason`. */
function finishedState(p: Record<string, unknown>, state: AgentState): AgentState {
  if (state !== "completed") return state;
  return p.status === "error" || p.stopReason === "error" || p.stop_reason === "error"
    ? "failed"
    : state;
}

/** Null when the hook is one Phoenix does not follow or its payload is unusable. Never throws. */
export function mapGenericHook(payload: unknown, options: GenericOptions): AgentReport | null {
  const env = options.env ?? {};
  const p = isRecord(payload) ? payload : {};
  if (!AGENT_PATTERN.test(options.agent)) return null;

  const named = text(p.hook_event_name) ?? options.event;
  // `phoenix_state`: an agent with no hook names of its own says the state directly (docs/agents.md).
  const envState = text(p.phoenix_state) ?? text(env.PHOENIX_AGENT_STATE);
  let state: AgentState | undefined;
  if (named !== undefined && Object.hasOwn(EVENT_STATES, named)) state = EVENT_STATES[named];
  else if (envState && (AGENT_STATES as readonly string[]).includes(envState))
    state = envState as AgentState;
  if (!state) return null;
  state = finishedState(p, state);

  const id = sessionId(p, env);
  if (!id || !AGENT_ID_PATTERN.test(id)) return null;
  const dir = workspace(p, env, options.cwd ?? process.cwd());
  if (dir.length > MAX_WORKSPACE || !isAbsolute(dir) || /\p{Cc}/u.test(dir)) return null;

  let reason: AgentReport["reason"];
  if (state === "waiting") {
    reason =
      p.notification_type === "permission_prompt" || p.notification_type === "ToolPermission"
        ? "permission"
        : waitReason(p.message);
  }
  return {
    agent: options.agent,
    agent_id: id,
    state,
    workspace: dir,
    ...(reason ? { reason } : {}),
  };
}

/** The keys a `phoenix_usage` object may carry. Anything else makes the whole report refused. */
const PHOENIX_USAGE_KEYS: Readonly<Record<string, true>> = {
  model: true,
  input_tokens: true,
  output_tokens: true,
  cost_usd: true,
};

/**
 * The opt-in usage report of Phoenix's own wrapper: a `phoenix_usage` object in the hook payload,
 * `{"input_tokens"?: n, "output_tokens"?: n, "cost_usd"?: n, "model"?: "id"}`, as running totals for
 * the session. Nothing in an agent's native payload is read for usage: Codex's own hook payload was
 * never observed to carry token counts, so only an explicit `phoenix_usage` produces a report.
 * The session id comes from the usual fields, the project is the folder NAME of the workspace, and
 * the agent slug is the one the hook was installed with. Null when there is no `phoenix_usage`, when
 * it carries a field not listed above, or when anything fails the strict `validateTokenUsage` rules
 * (whole non-negative token counts up to 1e12, cost up to 100000, at least one number). The
 * returned body is the validated, rebuilt one: no other text from the payload is ever copied.
 */
export function mapGenericUsage(
  payload: unknown,
  options: GenericOptions,
): TokenUsageReport | null {
  if (!isRecord(payload) || !isRecord(payload.phoenix_usage)) return null;
  const usage = payload.phoenix_usage;
  for (const key of Object.keys(usage)) if (!Object.hasOwn(PHOENIX_USAGE_KEYS, key)) return null;
  const env = options.env ?? {};
  const id = sessionId(payload, env);
  if (!id) return null;
  const dir = workspace(payload, env, options.cwd ?? process.cwd());
  const checked = validateTokenUsage({
    agent: options.agent,
    session_id: id,
    ...(dir.length <= MAX_WORKSPACE && isAbsolute(dir) ? { project: dir } : {}),
    ...usage,
  });
  return checked.ok ? checked.report : null;
}
