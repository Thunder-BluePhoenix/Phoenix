// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Coding-agent orchestration (Phase 34): starts, messages and stops agents the USER configured,
// links what happens during a session to commits and CI runs, hands a session the context it is
// allowed to see, and tells the rest of Phoenix when a finished session left a commit behind.
//
// Safety rules enforced here (each has a test):
//  - Nothing starts without a command that went through the PermissionGateway (confirmation).
//  - The launcher comes from config only; a refused or unconfigured launcher starts nothing.
//  - Events carry ids, states and counts. Agent output, prompts and messages are never in an event.
//  - `agent.handoff` only announces; nothing is executed because of it.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CapabilityContext } from "@phoenix/sdk";
import { ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import {
  assembleForSession,
  readBundle,
  type ContextAssembler,
  type HandoffBundle,
} from "./handoff";
import { isRecord } from "./guards";
import { parseLaunchers, type LauncherSpec, type LauncherTable } from "./launchers";
import {
  Correlator,
  LinkStore,
  type CommitTimeReader,
  type LinkNotice,
  type LinkView,
  type SessionFacts,
} from "./links";
import type { AgentReport } from "./report";
import {
  checkText,
  MAX_MESSAGE_CHARS,
  SessionManager,
  type HistoryEntry,
  type SessionChange,
  type SessionView,
  type StopReason,
} from "./sessions";

export const DEFAULT_MAX_SESSIONS = 3;
export const DEFAULT_MAX_RUNTIME_MIN = 120;
export const DEFAULT_GRACE_MS = 5_000;
export const MAX_OUTPUT_LINES = 200;

/** The part of the event bus the capability listens with (`EventBus.subscribe` fits). */
export interface EventSource {
  subscribe(
    id: string,
    patterns: string | readonly string[],
    handler: (event: PhoenixEvent) => void | Promise<void>,
  ): () => void;
}

/** One audit record; Phoenix's audit log redacts `details` again before it stores them. */
export interface AuditRecord {
  actor: string;
  action: string;
  capabilityId: string;
  decision: "info";
  details: Record<string, unknown>;
}

/**
 * How a session gets context. `fetch` is the ONLY place the context is read, and it must go
 * through the tool gateway (`agents.context.fetch` as an `agent` actor named after the session),
 * so the read is policy-checked and audited. `assembler` is what `agents.context.fetch` runs.
 */
export interface ContextPort {
  assembler: ContextAssembler;
  fetch(request: { session_id: string; question: string }): Promise<unknown>;
  /** Unpredictable per handoff; tests pin it. */
  nonce?: () => string;
}

export interface AgentsServices {
  db: DatabaseSync;
  events: EventSource;
  audit: (record: AuditRecord) => void;
  isKillSwitchEngaged: () => boolean;
  context?: ContextPort;
  /** When a commit was made; default: `git show` in the repository (tests inject one). */
  commitTime?: CommitTimeReader;
  /** Environment launchers may copy from; default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
}

export interface OrchestratorOptions {
  ctx: CapabilityContext;
  services: AgentsServices;
  now: () => number;
  /** Feeds the Phase 25 session table and event path with this session's state. */
  announce: (report: AgentReport) => void;
}

const KILL_SWITCH_EVENT = "security.kill_switch.engaged";
const SUBSCRIBER = "agents-orchestration";

const COMMIT_TIME_TIMEOUT_MS = 5_000;

/** The default commit-time reader: `git show -s --format=%ct <sha>` (no shell, hex sha only). */
export const gitCommitTime: CommitTimeReader = (repoPath, sha) => {
  const done = Promise.withResolvers<number | undefined>();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    done.resolve(undefined);
    return done.promise;
  }
  execFile(
    "git",
    ["-c", "core.fsmonitor=false", "-C", repoPath, "show", "-s", "--format=%ct", sha],
    {
      timeout: COMMIT_TIME_TIMEOUT_MS,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GIT_TERMINAL_PROMPT: "0" },
    },
    (err, stdout) => {
      const seconds = Number(stdout.trim());
      done.resolve(err || !Number.isSafeInteger(seconds) ? undefined : seconds * 1000);
    },
  );
  return done.promise;
};

const invalid = (message: string, details: string[] = []) =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, message, details);

function field(input: unknown, name: string): unknown {
  return isRecord(input) ? input[name] : undefined;
}

function text(input: unknown, name: string): string {
  const value = field(input, name);
  if (typeof value !== "string") throw invalid(`${name} must be a string`);
  return value;
}

export interface SessionDetail {
  session: SessionView | null;
  links: LinkView[];
  ambiguous: LinkView[];
  timeline: TimelineEntry[];
  output?: { stdout: string[]; stderr: string[] };
}

export interface TimelineEntry {
  at: string;
  kind: string;
  detail?: Record<string, unknown>;
}

export class Orchestrator {
  readonly launchers: LauncherTable;
  readonly problems: string[];
  private readonly sessions: SessionManager;
  private readonly links: LinkStore;
  private readonly correlator: Correlator;
  private readonly unsubscribe: (() => void)[] = [];
  /** `agent.handoff` events already sent, so a redelivered event cannot send a second one. */
  private readonly announced: Record<string, true> = {};
  private readonly titles: Record<string, string> = {};

  constructor(private readonly o: OrchestratorOptions) {
    const { ctx, services } = o;
    const parsed = parseLaunchers(ctx.config.launchers);
    this.launchers = parsed.launchers;
    this.problems = parsed.problems;
    const num = (name: string, fallback: number) =>
      typeof ctx.config[name] === "number" ? ctx.config[name] : fallback;

    this.sessions = new SessionManager({
      now: o.now,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref();
        return () => clearTimeout(timer);
      },
      env: services.env ?? process.env,
      maxSessions: num("max_sessions", DEFAULT_MAX_SESSIONS),
      maxRuntimeMs: num("max_runtime_min", DEFAULT_MAX_RUNTIME_MIN) * 60_000,
      graceMs: num("grace_ms", DEFAULT_GRACE_MS),
      isKillSwitchEngaged: services.isKillSwitchEngaged,
      onChange: (view, change) => this.onChange(view, change),
      warn: (message, extra) => ctx.logger.warn(message, extra),
    });
    this.links = new LinkStore(services.db, o.now);
    this.correlator = new Correlator({
      links: this.links,
      sessions: () => this.facts(),
      commitTime: services.commitTime ?? gitCommitTime,
      now: o.now,
      onLink: (notice) => this.onLink(notice),
      warn: (message, extra) => ctx.logger.warn(message, extra),
    });

    // Correlation sources are trusted by event `source`, which the capability manager forces to
    // the emitting capability's id: another capability cannot pose as git or github.
    this.unsubscribe.push(
      services.events.subscribe(
        SUBSCRIBER,
        ["git.commit.created", "github.ci.*", "github.pr.*", KILL_SWITCH_EVENT],
        (event) => this.onEvent(event),
      ),
    );
  }

  /** Stops every session (disable, shutdown, kill switch) and stops listening. */
  async close(reason: StopReason): Promise<void> {
    for (const off of this.unsubscribe.splice(0)) off();
    await this.sessions.stopAll(reason);
    this.sessions.clear();
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  start(input: unknown): SessionView {
    const spec = this.requireLauncher(text(input, "launcher"));
    const workspace = text(input, "workspace");
    const view = this.sessions.start(
      text(input, "launcher"),
      spec,
      workspace,
      text(input, "prompt"),
    );
    const task = field(input, "task");
    if (typeof task === "string" && task) this.titles[view.id] = task;
    this.audit("agent.session.started", view.id, {
      launcher: view.launcher,
      workspace: view.workspace,
      prompt_chars: text(input, "prompt").length,
    });
    return view;
  }

  send(input: unknown): SessionView {
    const id = text(input, "session_id");
    const message = checkText(text(input, "message"), MAX_MESSAGE_CHARS, "The message");
    this.requireReady();
    const view = this.sessions.send(id, message);
    this.audit("agent.session.message_sent", id, { chars: message.length });
    return view;
  }

  async stop(input: unknown): Promise<SessionView> {
    this.requireReady();
    const id = text(input, "session_id");
    const view = await this.sessions.stop(id, "user");
    this.audit("agent.session.stop_requested", id, { reason: "user" });
    return view;
  }

  list(): { sessions: SessionView[]; ambiguous_links: LinkView[] } {
    return { sessions: this.sessions.list(), ambiguous_links: this.links.ambiguous() };
  }

  get(input: unknown): SessionDetail {
    const id = text(input, "session_id");
    const lines = field(input, "output_lines");
    const session = this.sessions.get(id) ?? null;
    const links = this.links.forSession(id);
    if (!session && links.length === 0) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `Unknown session "${id.slice(0, 40)}"`);
    }
    const timeline: TimelineEntry[] = [
      ...this.sessions.history(id).map((h) => this.historyEntry(h)),
      ...links.map((l): TimelineEntry => ({
        at: l.created_at,
        kind: `link.${l.kind}`,
        detail: { ref: l.ref, repo: l.repo, confidence: l.confidence, link_id: l.id },
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      session,
      links,
      ambiguous: this.links.ambiguousFor(id),
      timeline,
      ...(typeof lines === "number" && lines > 0
        ? { output: this.sessions.output(id, Math.min(lines, MAX_OUTPUT_LINES)) }
        : {}),
    };
  }

  resolveLink(input: unknown): LinkView {
    const linkId = field(input, "link_id");
    if (typeof linkId !== "number" || !Number.isSafeInteger(linkId)) {
      throw invalid("link_id must be an integer");
    }
    const sessionId = text(input, "session_id");
    try {
      const link = this.links.resolve(linkId, sessionId);
      this.audit("agent.link.resolved", sessionId, {
        link_id: link.id,
        kind: link.kind,
        ref: link.ref,
      });
      return link;
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : "Could not resolve the link");
    }
  }

  /** `agents.context.fetch`: what this session may see. Scope comes from the session, not the caller. */
  fetchContext(input: unknown): HandoffBundle {
    const port = this.requireContext();
    const id = text(input, "session_id");
    const session = this.sessions.get(id);
    if (!session) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown session");
    return assembleForSession(
      port.assembler,
      { id, workspace: session.workspace, repository: session.repository },
      text(input, "question"),
      (port.nonce ?? defaultNonce)(),
    );
  }

  /** Fetches the session's authorised context through the tool gateway and writes it to the agent. */
  async handoffContext(input: unknown): Promise<{
    sent: boolean;
    count: number;
    chars: number;
    item_ids: string[];
    guard_dropped: number;
  }> {
    const port = this.requireContext();
    this.requireReady();
    const id = text(input, "session_id");
    const question = text(input, "question");
    const session = this.sessions.get(id);
    if (!session) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown session");
    if (!session.accepts_input) {
      throw invalid("This session cannot receive messages", ["NO_INPUT_CHANNEL"]);
    }
    const bundle = readBundle(await port.fetch({ session_id: id, question }));
    // A handoff never exceeds what the engine promised; a larger block is refused, not trimmed.
    checkText(bundle.block, 10_000, "The context block");
    let sent = false;
    if (bundle.count > 0) {
      this.sessions.send(id, bundle.block, "context");
      sent = true;
    }
    // Ids and counts only: no memory text, no question, no block.
    this.audit("agent.context.handoff", id, {
      sent,
      count: bundle.count,
      item_ids: bundle.item_ids,
      chars: bundle.chars,
      guard_dropped: bundle.guard_dropped,
      omitted: bundle.omitted,
    });
    return {
      sent,
      count: bundle.count,
      chars: bundle.chars,
      item_ids: bundle.item_ids,
      guard_dropped: bundle.guard_dropped,
    };
  }

  // ── Guards ───────────────────────────────────────────────────────────────

  /** Orchestration is refused until the user configured at least one usable launcher. */
  requireReady(): void {
    if (Object.keys(this.launchers).length === 0) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "No coding-agent launcher is configured. Add one in the capability's settings first.",
        ["NO_LAUNCHER", ...this.problems.slice(0, 5)],
      );
    }
  }

  private requireLauncher(name: string): LauncherSpec {
    this.requireReady();
    const spec = Object.hasOwn(this.launchers, name) ? this.launchers[name] : undefined;
    if (!spec) throw invalid(`Unknown launcher "${name.slice(0, 40)}"`, ["UNKNOWN_LAUNCHER"]);
    return spec;
  }

  private requireContext(): ContextPort {
    const port = this.o.services.context;
    if (!port) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Context is not available: Phoenix memory is not connected to this capability",
        ["NO_CONTEXT"],
      );
    }
    return port;
  }

  // ── Events in and out ────────────────────────────────────────────────────

  private async onEvent(event: PhoenixEvent): Promise<void> {
    if (event.event_type === KILL_SWITCH_EVENT) {
      if (event.source === "core") await this.sessions.stopAll("kill_switch");
      return;
    }
    const trusted =
      (event.event_type === "git.commit.created" && event.source === "git") ||
      (event.event_type.startsWith("github.") && event.source === "github");
    if (trusted) await this.correlator.handle(event);
  }

  private onChange(view: SessionView, change: SessionChange): void {
    if (this.o.ctx.signal.aborted) return;
    const report = (state: AgentReport["state"], reason?: AgentReport["reason"]): void =>
      this.o.announce({
        agent: view.launcher,
        agent_id: view.id,
        state,
        workspace: view.workspace,
        ...(this.titles[view.id] ? { task: this.titles[view.id]! } : {}),
        ...(reason ? { reason } : {}),
      });
    if (change === "started") report("started");
    else if (change === "working") report("working");
    else if (change === "waiting") report("waiting", "input");
    else if (change === "completed") report("completed");
    else if (change === "failed") report("failed");
    else report("ended");

    if (change === "completed" || change === "failed" || change === "stopped") {
      delete this.titles[view.id];
      this.audit("agent.session.finished", view.id, {
        state: view.state,
        ...(view.exit_code === undefined ? {} : { exit_code: view.exit_code }),
        ...(view.stop_reason ? { stop_reason: view.stop_reason } : {}),
      });
    }
    if (change === "completed") this.handoffFor(view.id);
  }

  private onLink(notice: LinkNotice): void {
    const { link, sessionId } = notice;
    this.audit(notice.created ? "agent.link.created" : "agent.link.updated", sessionId, {
      link_id: link.id,
      kind: link.kind,
      ref: link.ref,
      repo: link.repo,
      confidence: link.confidence,
    });
    if (link.kind === "ci_run" || link.kind === "commit") this.handoffFor(sessionId, link);
  }

  /**
   * Announces `agent.handoff` for a COMPLETED session that left a commit (and, later, for a CI run
   * built from it). Only an event: the CI-failure agent may pick it up when the user asks it to.
   */
  private handoffFor(sessionId: string, trigger?: LinkView): void {
    const view = this.sessions.get(sessionId);
    if (!view || view.state !== "completed" || this.o.ctx.signal.aborted) return;
    const links = this.links.forSession(sessionId);
    const commits = links.filter((l) => l.kind === "commit");
    const runs = links.filter((l) => l.kind === "ci_run");
    for (const commit of commits) {
      const run = runs.find((r) => r.detail?.commit === commit.ref);
      const conclusion = run?.detail?.conclusion;
      const key = `${sessionId}:${commit.ref}:${run?.ref ?? ""}:${String(conclusion ?? run?.detail?.event_type ?? "")}`;
      if (this.announced[key]) continue;
      if (trigger && trigger.kind === "commit" && trigger.ref !== commit.ref) continue;
      this.announced[key] = true;
      this.emitHandoff(view, commit, run);
    }
  }

  private emitHandoff(view: SessionView, commit: LinkView, run: LinkView | undefined): void {
    const result = this.o.ctx.emit({
      event_type: "agent.handoff",
      severity: "info",
      correlation_id: `agent-${view.id}`,
      subject: view.repository,
      data_classification: "internal",
      payload: {
        agent: view.launcher,
        agent_id: view.id,
        session_id: view.id,
        workspace: view.workspace,
        repository: view.repository,
        commit: {
          sha: commit.ref,
          repo: commit.repo,
          confidence: commit.confidence,
          ...(typeof commit.detail?.branch === "string" ? { branch: commit.detail.branch } : {}),
        },
        ...(run
          ? {
              ci_run: {
                run_id: run.ref,
                repo: run.repo,
                confidence: run.confidence,
                ...(typeof run.detail?.event_type === "string"
                  ? { event_type: run.detail.event_type }
                  : {}),
                ...(typeof run.detail?.conclusion === "string"
                  ? { conclusion: run.detail.conclusion }
                  : {}),
              },
            }
          : {}),
        note: "Linked because it happened during the session; this does not say the agent wrote it. Nothing runs because of this event.",
      },
    });
    if (!result.ok)
      this.o.ctx.logger.warn("agent.handoff was not published", { code: result.error.code });
    this.audit("agent.handoff.announced", view.id, {
      commit: commit.ref,
      ...(run ? { ci_run: run.ref } : {}),
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private facts(): SessionFacts[] {
    return this.sessions.list().map((s) => ({
      id: s.id,
      launcher: s.launcher,
      workspace: s.workspace,
      startedAt: Date.parse(s.started_at),
      ...(s.ended_at ? { endedAt: Date.parse(s.ended_at) } : {}),
    }));
  }

  private historyEntry(entry: HistoryEntry): TimelineEntry {
    return {
      at: new Date(entry.at).toISOString(),
      kind: `session.${entry.kind}`,
      ...(entry.detail ? { detail: entry.detail } : {}),
    };
  }

  private audit(action: string, sessionId: string, details: Record<string, unknown>): void {
    try {
      this.o.services.audit({
        actor: "capability:agents",
        action,
        capabilityId: this.o.ctx.id,
        decision: "info",
        details: { session_id: sessionId, ...details },
      });
    } catch (err) {
      this.o.ctx.logger.warn("agent audit record failed", { action, error: String(err) });
    }
  }
}

const defaultNonce = (): string => randomBytes(12).toString("hex");
