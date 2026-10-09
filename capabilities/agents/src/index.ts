// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Agents capability. Phase 25: shows whether AI coding agents (Claude Code, Codex, …) are working,
// waiting for you, done or failed: an adapter reports what an agent does and this capability turns
// that into `agent.*` events and a list of active agents (`report`, `list`: no side effects).
// Phase 34: for agents the USER configured as launchers, it can also start, message and stop them
// (`session.*`, `context.handoff`: side effect `execute`, so each call asks for confirmation),
// link their sessions to commits and CI runs, and hand them authorised context. See
// orchestration.ts for the rules; nothing here runs an agent without a confirmed command.
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
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
import { Orchestrator, type AgentsServices } from "./orchestration";
import { MAX_LAUNCHERS } from "./launchers";
import { MAX_MESSAGE_CHARS, MAX_PROMPT_CHARS } from "./sessions";

export * from "./report";
export * from "./handoff";
export * from "./launchers";
export * from "./links";
export * from "./orchestration";
export * from "./output";
export * from "./sessions";

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
  /**
   * Phoenix Core's services for orchestration (database, event bus, audit, kill switch, memory).
   * Called each time the capability is enabled. Without it only the observe-only commands work.
   */
  services?: () => AgentsServices | undefined;
}

const SESSION_ID_PATTERN = "^ph-[0-9a-f]{16}$";
const sessionIdInput = {
  type: "object",
  required: ["session_id"],
  additionalProperties: false,
  properties: { session_id: { type: "string", pattern: SESSION_ID_PATTERN } },
};

/** A fresh capability instance (its own session table); Phoenix Core uses `agentsCapability`. */
export function createAgentsCapability(options: AgentsCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  let sessions: Record<string, Session> = {};
  /** Present while the capability is enabled and Core supplied its services. */
  let orchestrator: Orchestrator | undefined;

  /** The orchestration half; without Core's services (a bare harness) it is unavailable. */
  function connected(): Orchestrator {
    if (!orchestrator) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Agent orchestration needs Phoenix Core's services (memory, events, audit); they are not connected",
        ["NOT_CONNECTED"],
      );
    }
    return orchestrator;
  }

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
        "Shows whether coding agents (Claude Code, Codex, …) are working, waiting for you, done or failed, and, for agents you configure, starts, messages and stops them on your confirmation and links their sessions to commits and CI runs.",
      license: "GPL-3.0-or-later",
      events: ["agent.*"],
      permissions: ["shell_command", "repository_access"],
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
        {
          name: "session.start",
          description:
            "Start a coding agent (a launcher you configured) in a workspace with a task prompt",
          side_effect: "execute",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            required: ["launcher", "workspace", "prompt"],
            additionalProperties: false,
            properties: {
              launcher: { type: "string", pattern: AGENT_PATTERN.source },
              workspace: { type: "string", maxLength: MAX_WORKSPACE, pattern: "^/[^\\p{Cc}]*$" },
              prompt: { type: "string", minLength: 1, maxLength: MAX_PROMPT_CHARS },
              task: { type: "string", maxLength: MAX_TASK, pattern: "^[^\\p{Cc}]*$" },
            },
          },
        },
        {
          name: "session.send",
          description: "Send a message to a running coding-agent session",
          side_effect: "execute",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            required: ["session_id", "message"],
            additionalProperties: false,
            properties: {
              session_id: { type: "string", pattern: SESSION_ID_PATTERN },
              message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_CHARS },
            },
          },
        },
        {
          name: "session.stop",
          description: "Stop a running coding-agent session and everything it started",
          side_effect: "execute",
          permissions: ["shell_command"],
          input_schema: sessionIdInput,
        },
        {
          name: "session.list",
          description:
            "Coding-agent sessions Phoenix started, and links waiting for you to resolve",
          side_effect: "read",
        },
        {
          name: "session.get",
          description: "One session with its linked commits and CI runs and a timeline",
          side_effect: "read",
          input_schema: {
            type: "object",
            required: ["session_id"],
            additionalProperties: false,
            properties: {
              session_id: { type: "string", pattern: SESSION_ID_PATTERN },
              output_lines: { type: "integer", minimum: 0, maximum: 200 },
            },
          },
        },
        {
          name: "context.handoff",
          description:
            "Give a session notes from Phoenix memory it is allowed to see (its own repository only, nothing sensitive)",
          side_effect: "execute",
          permissions: ["shell_command"],
          input_schema: {
            type: "object",
            required: ["session_id", "question"],
            additionalProperties: false,
            properties: {
              session_id: { type: "string", pattern: SESSION_ID_PATTERN },
              question: { type: "string", minLength: 1, maxLength: 300 },
            },
          },
        },
        {
          name: "context.fetch",
          description:
            "Read the notes a session is allowed to see from Phoenix memory (used by context.handoff through the tool gateway)",
          side_effect: "read",
          permissions: ["repository_access"],
          input_schema: {
            type: "object",
            required: ["session_id", "question"],
            additionalProperties: false,
            properties: {
              session_id: { type: "string", pattern: SESSION_ID_PATTERN },
              question: { type: "string", minLength: 1, maxLength: 300 },
            },
          },
        },
        {
          name: "link.resolve",
          description: "Pick the session an ambiguous commit or CI run belongs to",
          side_effect: "write",
          input_schema: {
            type: "object",
            required: ["link_id", "session_id"],
            additionalProperties: false,
            properties: {
              link_id: { type: "integer", minimum: 1 },
              session_id: { type: "string", pattern: SESSION_ID_PATTERN },
            },
          },
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
          launchers: {
            type: "object",
            maxProperties: MAX_LAUNCHERS,
            additionalProperties: { type: "object" },
            description:
              'Coding agents Phoenix may start, by name: { "<name>": { "command": ["/abs/path", ...fixed args], "cwd_roots": ["/abs/folder"], "env_allow": [...], "waiting_prompts": [...], "stdin": "keep_open" } }. Nothing else can be started. Details are checked when a session starts.',
          },
          max_sessions: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Most sessions running at once (default 3).",
          },
          max_runtime_min: {
            type: "integer",
            minimum: 1,
            maximum: 1_440,
            description: "A session still running after this long is stopped (default 120).",
          },
          grace_ms: {
            type: "integer",
            minimum: 0,
            maximum: 60_000,
            description:
              "How long a stopped agent gets to exit before it is killed (default 5000).",
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

      void orchestrator?.close("shutdown");
      const services = options.services?.();
      orchestrator = services
        ? new Orchestrator({
            ctx,
            services,
            now,
            announce: (report) => {
              try {
                record(report, ctx);
              } catch (err) {
                ctx.logger.warn("could not announce an agent session", { error: String(err) });
              }
            },
          })
        : undefined;
    },
    async shutdown() {
      const closing = orchestrator;
      orchestrator = undefined;
      await closing?.close("shutdown");
    },
    health: () => {
      const problems = orchestrator?.problems ?? [];
      return {
        status: problems.length > 0 ? "degraded" : "healthy",
        message:
          `${Object.keys(sessions).length} active agent session(s)` +
          (problems.length > 0 ? `; launcher config: ${problems[0]}` : ""),
      };
    },
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
      "session.start": (input) => connected().start(input),
      "session.send": (input) => connected().send(input),
      "session.stop": (input) => connected().stop(input),
      "session.list": () => connected().list(),
      "session.get": (input) => connected().get(input),
      "context.handoff": (input) => connected().handoffContext(input),
      "context.fetch": (input) => connected().fetchContext(input),
      "link.resolve": (input) => connected().resolveLink(input),
    },
  });
}

export const agentsCapability = createAgentsCapability();
