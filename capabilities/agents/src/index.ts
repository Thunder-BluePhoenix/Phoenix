// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Agents capability (Phase 25): shows whether AI coding agents (Claude Code,
// Codex, …) are working, waiting for you, done or failed. OBSERVE ONLY: an
// adapter reports what an agent is doing; this capability turns that into
// `agent.*` events and a list of active agents. It has no permissions, starts
// no process, opens no connection and offers no command that could steer an
// agent (that is Phase 34).
import { defineCapability, type CapabilityContext } from "@phoenix/sdk";
import {
  AGENT_ID_PATTERN,
  AGENT_PATTERN,
  AGENT_STATES,
  MAX_TASK,
  MAX_WORKSPACE,
  WAIT_REASONS,
  cleanTask,
  repositoryName,
  validateReport,
  type AgentEventPayload,
  type AgentReport,
  type AgentState,
  type WaitReason,
} from "./report";

export * from "./report";

/** A session that went silent for this long is dropped (config `silent_after_min`). */
export const DEFAULT_SILENT_AFTER_MIN = 120;
/** Upper bound on tracked sessions; the least recently heard from is dropped first. */
const MAX_SESSIONS = 200;
const SWEEP_INTERVAL_MS = 60_000;
const WORKING_TIMEOUT_MS = 60 * 60_000;

/** One active agent as returned by the `list` command. */
export interface ActiveAgent {
  agent: string;
  agent_id: string;
  workspace: string;
  repository: string;
  /** The last reported state (`ended` sessions are not listed). */
  state: Exclude<AgentState, "ended">;
  reason?: WaitReason;
  task?: string;
  /** When the session entered this state. */
  since: string;
  /** When Phoenix last heard from the session. */
  updated_at: string;
}

interface Session {
  agent: string;
  agent_id: string;
  workspace: string;
  state: Exclude<AgentState, "ended">;
  reason?: WaitReason;
  task?: string;
  since: number;
  lastSeen: number;
}

type EventSeverity = "info" | "success" | "warning" | "error";

/** How each reported state is announced. `waiting` + reason `idle` is handled separately. */
const EVENTS: Record<AgentState, { type: string; severity: EventSeverity }> = {
  started: { type: "agent.started", severity: "info" },
  working: { type: "agent.working", severity: "info" },
  waiting: { type: "agent.waiting", severity: "warning" },
  completed: { type: "agent.completed", severity: "success" },
  failed: { type: "agent.failed", severity: "error" },
  ended: { type: "agent.ended", severity: "info" },
};

/** The Fawkes-facing payload of an event for `session`. */
function payloadOf(session: Session): AgentEventPayload {
  return {
    agent: session.agent,
    agent_id: session.agent_id,
    workspace: session.workspace,
    repository: repositoryName(session.workspace),
    ...(session.task ? { task: session.task } : {}),
    ...(session.reason ? { reason: session.reason } : {}),
  };
}

export interface AgentsCapabilityOptions {
  /** Clock in ms since the epoch; tests inject one. */
  now?: () => number;
}

/** A fresh capability instance (its own session table); Phoenix Core uses `agentsCapability`. */
export function createAgentsCapability(options: AgentsCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  let sessions: Record<string, Session> = {};

  function emit(
    ctx: CapabilityContext,
    type: string,
    severity: EventSeverity,
    session: Session,
    extra: { expired?: true; requiresAction?: boolean; ephemeral?: boolean } = {},
  ): void {
    const result = ctx.emit(
      {
        event_type: type,
        severity,
        correlation_id: `agent-${session.agent_id}`,
        subject: repositoryName(session.workspace),
        ...(extra.requiresAction ? { requires_action: true } : {}),
        payload: { ...payloadOf(session), ...(extra.expired ? { expired: true } : {}) },
      },
      extra.ephemeral ? { ephemeral: true } : undefined,
    );
    if (!result.ok) throw result.error;
  }

  /** Drops sessions that went silent and clears their Fawkes state. */
  function sweep(ctx: CapabilityContext): void {
    const minutes = ctx.config.silent_after_min;
    const cutoff =
      now() - (typeof minutes === "number" ? minutes : DEFAULT_SILENT_AFTER_MIN) * 60_000;
    for (const [key, session] of Object.entries(sessions)) {
      if (session.lastSeen > cutoff) continue;
      delete sessions[key];
      emit(ctx, EVENTS.ended.type, EVENTS.ended.severity, session, { expired: true });
    }
  }

  /** Keeps the table bounded: a hostile or buggy adapter cannot grow it without limit. */
  function evict(ctx: CapabilityContext): void {
    const entries = Object.entries(sessions);
    if (entries.length <= MAX_SESSIONS) return;
    entries.sort(([, a], [, b]) => a.lastSeen - b.lastSeen);
    for (const [key, session] of entries.slice(0, entries.length - MAX_SESSIONS)) {
      delete sessions[key];
      emit(ctx, EVENTS.ended.type, EVENTS.ended.severity, session, { expired: true });
    }
  }

  function record(report: AgentReport, ctx: CapabilityContext): { event_type: string } {
    sweep(ctx);
    const key = `${report.agent}:${report.agent_id}`;
    const prev = sessions[key];
    const at = now();

    if (report.state === "ended") {
      const ended: Session = prev ?? {
        agent: report.agent,
        agent_id: report.agent_id,
        workspace: report.workspace,
        state: "working",
        since: at,
        lastSeen: at,
      };
      delete sessions[key];
      emit(ctx, EVENTS.ended.type, EVENTS.ended.severity, ended);
      return { event_type: EVENTS.ended.type };
    }

    const title =
      ctx.config.include_prompt_title === true && report.task ? cleanTask(report.task) : undefined;
    // A new session starts without a task; later reports keep the one already known.
    const task = title ?? (report.state === "started" ? undefined : prev?.task);
    const reason = report.state === "waiting" ? report.reason : undefined;
    const session: Session = {
      agent: report.agent,
      agent_id: report.agent_id,
      workspace: report.workspace,
      state: report.state,
      ...(reason ? { reason } : {}),
      ...(task ? { task } : {}),
      since: prev && prev.state === report.state ? prev.since : at,
      lastSeen: at,
    };
    sessions[key] = session;
    evict(ctx);

    // An agent that is already working may report "working" again (a new prompt, or a tool call):
    // refresh the stall timer quietly instead of writing an event per report into the history.
    // After a long silence the stall timer has already fired, so a full event re-arms it.
    if (
      prev?.state === "working" &&
      report.state === "working" &&
      !title &&
      at - prev.lastSeen < WORKING_TIMEOUT_MS
    ) {
      emit(ctx, "agent.progress", "info", session, { ephemeral: true });
      return { event_type: "agent.progress" };
    }
    // An idle prompt ("Claude is waiting for your input" a minute after it finished) is not
    // something to nag about, so it does not raise WAITING.
    if (report.state === "waiting" && reason === "idle") {
      emit(ctx, "agent.idle", "info", session);
      return { event_type: "agent.idle" };
    }
    const { type, severity } = EVENTS[report.state];
    emit(ctx, type, severity, session, { requiresAction: report.state === "waiting" });
    return { event_type: type };
  }

  return defineCapability({
    manifest: {
      id: "agents",
      name: "Coding agents",
      version: "0.1.0",
      description:
        "Shows whether coding agents (Claude Code, Codex, …) are working, waiting for you, done or failed. Observe-only.",
      license: "GPL-3.0-or-later",
      events: ["agent.*"],
      permissions: [],
      data_categories: [
        "agent name and session id",
        "workspace path and repository name",
        "task title (only if enabled; derived from your prompt)",
      ],
      commands: [
        {
          name: "report",
          description: "Record what a coding agent is doing (called by agent hooks and wrappers)",
          // Like terminal.report: it changes nothing outside Phoenix's own event stream, so there
          // is nothing to confirm, and a confirmation prompt per hook call would make it unusable.
          side_effect: "none",
          input_schema: {
            type: "object",
            required: ["agent", "agent_id", "state", "workspace"],
            additionalProperties: false,
            properties: {
              agent: { type: "string", pattern: AGENT_PATTERN.source },
              agent_id: { type: "string", pattern: AGENT_ID_PATTERN.source },
              state: { enum: [...AGENT_STATES] },
              workspace: {
                type: "string",
                maxLength: MAX_WORKSPACE,
                pattern: "^(/|[A-Za-z]:[\\\\/])[^\\p{Cc}]*$",
              },
              task: { type: "string", maxLength: MAX_TASK, pattern: "^[^\\p{Cc}]*$" },
              reason: { enum: [...WAIT_REASONS] },
            },
          },
        },
        {
          name: "list",
          description: "Currently active coding agents, from what adapters have reported",
          side_effect: "read",
        },
      ],
      healthcheck: { interval_ms: 30_000 },
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          include_prompt_title: {
            type: "boolean",
            description:
              "Show a short title taken from your prompt (redacted, 120 characters). Off by default.",
          },
          silent_after_min: {
            type: "integer",
            minimum: 1,
            maximum: 1_440,
            description: "Forget a session that has been silent this long (default 120).",
          },
        },
      },
      state_rules: [
        // A session opening is not activity: it is listed, and clears the previous run's SUCCESS.
        { match: "agent.started", effect: { clear: true } },
        {
          match: "agent.working",
          effect: {
            state: "WORKING",
            explain: "{payload.agent} is working ({subject})",
            timeoutMs: WORKING_TIMEOUT_MS,
          },
        },
        { match: "agent.progress", effect: { heartbeat: true } },
        {
          match: "agent.waiting",
          effect: { state: "WAITING", explain: "{payload.agent} needs your input ({subject})" },
        },
        { match: "agent.idle", effect: { clear: true } },
        {
          match: "agent.completed",
          effect: {
            state: "SUCCESS",
            explain: "{payload.agent} finished ({subject})",
            ttlMs: 5_000,
          },
        },
        {
          match: "agent.failed",
          effect: { state: "ERROR", explain: "{payload.agent} failed ({subject})" },
        },
        { match: "agent.ended", effect: { clear: true } },
      ],
    },
    init(ctx) {
      sessions = {};
      const timer = setInterval(() => {
        try {
          sweep(ctx);
        } catch (err) {
          ctx.logger.warn("agent session sweep failed", { error: (err as Error).message });
        }
      }, SWEEP_INTERVAL_MS);
      timer.unref();
      ctx.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    },
    health: () => ({
      status: "healthy",
      message: `${Object.keys(sessions).length} active agent session(s)`,
    }),
    commands: {
      report(input, ctx) {
        const result = validateReport(input);
        if (!result.ok) throw new Error(`Invalid agent report: ${result.problems.join("; ")}`);
        return record(result.report, ctx);
      },
      list(_input, ctx): { agents: ActiveAgent[] } {
        sweep(ctx);
        const agents = Object.values(sessions)
          .sort((a, b) => b.lastSeen - a.lastSeen)
          .map((s): ActiveAgent => ({
            agent: s.agent,
            agent_id: s.agent_id,
            workspace: s.workspace,
            repository: repositoryName(s.workspace),
            state: s.state,
            ...(s.reason ? { reason: s.reason } : {}),
            ...(s.task ? { task: s.task } : {}),
            since: new Date(s.since).toISOString(),
            updated_at: new Date(s.lastSeen).toISOString(),
          }));
        return { agents };
      },
    },
  });
}

export const agentsCapability = createAgentsCapability();
