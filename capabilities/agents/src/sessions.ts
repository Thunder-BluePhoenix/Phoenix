// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Orchestrated coding-agent sessions (Phase 34): the processes Phoenix started on the user's
// explicit, confirmed command. A session is a configured launcher run inside a validated
// workspace under `agent-supervisor.cjs`, which owns the process group and stops the whole tree
// on a stop request or when Core dies. This module knows processes and bounded buffers; it knows
// nothing about events, memory or links (index.ts wires those through `onChange`).
//
// Rules held here: the launcher comes from config only; the prompt goes to stdin, never into argv;
// no shell; a minimal allow-listed environment; output is kept in bounded, sanitised and redacted
// ring buffers for the user to read and is never put into an event; at most `maxSessions` run at
// once; each session ends after `maxRuntimeMs`; a stop is SIGTERM, then SIGKILL after a grace period.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { buildEnv, resolveLaunch, LauncherRefusal, type LauncherSpec } from "./launchers";
import { OutputRing, type OutputStats } from "./output";
import { repositoryName } from "./report";

export const SUPERVISOR = fileURLToPath(new URL("./agent-supervisor.cjs", import.meta.url));

export const MAX_PROMPT_CHARS = 8_000;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_TITLE_CHARS = 120;
export const MAX_HISTORY = 100;
/** Finished sessions kept in memory (their output too) so the user can read what happened. */
export const MAX_FINISHED = 20;
/** How long after the grace period Core waits before it kills the supervisor itself. */
export const SUPERVISOR_MARGIN_MS = 3_000;

export type SessionState = "running" | "waiting" | "completed" | "failed" | "stopped";
export type StopReason = "user" | "kill_switch" | "max_runtime" | "shutdown";

export type HistoryKind =
  | "started"
  | "waiting"
  | "resumed"
  | "message_sent"
  | "context_sent"
  | "completed"
  | "failed"
  | "stopped";

export interface HistoryEntry {
  at: number;
  kind: HistoryKind;
  /** Counts and reasons only, never agent output or prompt text. */
  detail?: Record<string, string | number | boolean>;
}

export interface SessionView {
  id: string;
  launcher: string;
  workspace: string;
  repository: string;
  state: SessionState;
  started_at: string;
  ended_at?: string;
  exit_code?: number | null;
  signal?: string | null;
  stop_reason?: StopReason;
  failure?: string;
  accepts_input: boolean;
  messages_sent: number;
  output: { stdout: OutputStats; stderr: OutputStats };
}

/** What happened to a session; index.ts turns each into an `agent.*` event. */
export type SessionChange = "started" | "working" | "waiting" | "completed" | "failed" | "stopped";

export interface SessionManagerOptions {
  now: () => number;
  /** Runs `fn` after `ms`; returns a function that cancels it. Tests pass a manual scheduler. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** The environment launchers may copy from (normally `process.env`). */
  env: Readonly<Record<string, string | undefined>>;
  maxSessions: number;
  maxRuntimeMs: number;
  graceMs: number;
  isKillSwitchEngaged: () => boolean;
  onChange: (view: SessionView, change: SessionChange) => void;
  /** Where a failure that cannot be reported to the caller goes. */
  warn: (message: string, extra: Record<string, unknown>) => void;
}

interface Session {
  id: string;
  launcher: string;
  spec: LauncherSpec;
  workspace: string;
  state: SessionState;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  stopReason?: StopReason;
  failure?: string;
  child: ChildProcess;
  stdout: OutputRing;
  stderr: OutputRing;
  history: HistoryEntry[];
  messagesSent: number;
  cancelRuntime: () => void;
  cancelKill: () => void;
  exited: Promise<void>;
}

const refuse = (code: ErrorCode, message: string, details: string[] = []) =>
  new PhoenixError(code, message, details);

const TERMINAL: Readonly<Record<SessionState, boolean>> = {
  running: false,
  waiting: false,
  completed: true,
  failed: true,
  stopped: true,
};

/** Text sent to an agent: no control characters except newline and tab, bounded. */
export function checkText(text: string, max: number, what: string): string {
  if (text.length === 0 || text.length > max) {
    throw refuse(ErrorCode.INVALID_REQUEST, `${what} must be 1 to ${max} characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(text)) {
    throw refuse(ErrorCode.INVALID_REQUEST, `${what} must not contain control characters`);
  }
  return text;
}

export class SessionManager {
  private sessions: Record<string, Session> = {};
  private order: string[] = [];

  constructor(private readonly o: SessionManagerOptions) {}

  /** Starts `spec` in `workspace`. The prompt is written to the agent's stdin. */
  start(
    launcher: string,
    spec: LauncherSpec,
    workspace: string,
    prompt: string,
  ): SessionView {
    if (this.o.isKillSwitchEngaged()) {
      throw refuse(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    }
    checkText(prompt, MAX_PROMPT_CHARS, "The prompt");
    if (this.active().length >= this.o.maxSessions) {
      throw refuse(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        `${this.o.maxSessions} sessions are already running`,
        ["TOO_MANY_SESSIONS"],
      );
    }
    let resolved;
    try {
      resolved = resolveLaunch(spec, workspace);
    } catch (err) {
      if (err instanceof LauncherRefusal) {
        throw refuse(ErrorCode.INVALID_REQUEST, err.message, ["LAUNCH_REFUSED"]);
      }
      throw err;
    }

    const id = `ph-${randomBytes(8).toString("hex")}`;
    // The executable is the launcher's resolved path; its arguments are the fixed ones from config.
    const child = spawn(
      process.execPath,
      [SUPERVISOR, String(this.o.graceMs), resolved.executable, ...spec.command.slice(1)],
      {
        cwd: resolved.workspace,
        env: buildEnv(spec, this.o.env),
        // 0 prompt and messages, 1-2 output, 3 lifeline: Core never writes to it, so the
        // operating system closing it (Core killed) tells the supervisor to stop the agent.
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const exit = Promise.withResolvers<void>();
    const session: Session = {
      id,
      launcher,
      spec,
      workspace: resolved.workspace,
      state: "running",
      startedAt: this.o.now(),
      child,
      stdout: new OutputRing(),
      stderr: new OutputRing(),
      history: [],
      messagesSent: 0,
      cancelRuntime: this.o.schedule(() => void this.terminate(id, "max_runtime"), this.o.maxRuntimeMs),
      cancelKill: () => {},
      exited: exit.promise,
    };
    this.sessions[id] = session;
    this.order.push(id);
    this.note(session, "started");

    child.stdin?.on("error", () => {});
    child.stdio[3]?.on("error", () => {});
    child.stdout?.on("data", (chunk: Buffer) => this.onOutput(session, session.stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.onOutput(session, session.stderr, chunk));
    child.on("error", (err) => {
      session.failure = `could not start: ${(err as NodeJS.ErrnoException).code ?? "error"}`;
    });
    child.on("close", (code, signal) => {
      this.finish(session, code, signal);
      exit.resolve();
    });

    child.stdin?.write(`${prompt}\n`);
    if (spec.stdin === "close_after_prompt") child.stdin?.end();
    this.o.onChange(this.view(session), "started");
    this.o.onChange(this.view(session), "working");
    return this.view(session);
  }

  /** Writes a line to a running session's stdin. */
  send(id: string, text: string, kind: "message" | "context" = "message"): SessionView {
    if (this.o.isKillSwitchEngaged()) {
      throw refuse(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    }
    const session = this.require(id);
    if (TERMINAL[session.state]) {
      throw refuse(ErrorCode.INVALID_REQUEST, `Session ${id} is ${session.state}`, ["NOT_RUNNING"]);
    }
    if (session.spec.stdin === "close_after_prompt") {
      throw refuse(
        ErrorCode.INVALID_REQUEST,
        "This launcher closes the agent's input after the prompt, so it cannot receive messages",
        ["NO_INPUT_CHANNEL"],
      );
    }
    if (!session.child.stdin || session.child.stdin.destroyed || !session.child.stdin.writable) {
      throw refuse(ErrorCode.INVALID_REQUEST, "The agent's input is closed", ["NO_INPUT_CHANNEL"]);
    }
    session.child.stdin.write(`${text}\n`);
    session.messagesSent++;
    this.note(session, kind === "context" ? "context_sent" : "message_sent", {
      chars: text.length,
    });
    if (session.state === "waiting") {
      session.state = "running";
      this.note(session, "resumed");
      this.o.onChange(this.view(session), "working");
    }
    return this.view(session);
  }

  /** Stops one session: SIGTERM to the process tree, SIGKILL after the grace period. */
  async stop(id: string, reason: StopReason = "user"): Promise<SessionView> {
    this.require(id);
    return this.terminate(id, reason);
  }

  async stopAll(reason: StopReason): Promise<number> {
    const running = this.active();
    await Promise.all(running.map((s) => this.terminate(s.id, reason)));
    return running.length;
  }

  list(): SessionView[] {
    return this.order
      .map((id) => this.sessions[id])
      .filter((s): s is Session => s !== undefined)
      .map((s) => this.view(s))
      .reverse();
  }

  get(id: string): SessionView | undefined {
    const session = this.sessions[id];
    return session ? this.view(session) : undefined;
  }

  history(id: string): HistoryEntry[] {
    return [...(this.sessions[id]?.history ?? [])];
  }

  /** The last `lines` output lines per stream (sanitised, redacted). Empty after eviction. */
  output(id: string, lines: number): { stdout: string[]; stderr: string[] } {
    const session = this.sessions[id];
    return session
      ? { stdout: session.stdout.tail(lines), stderr: session.stderr.tail(lines) }
      : { stdout: [], stderr: [] };
  }

  /** The spec of a session (for handoff checks). */
  spec(id: string): LauncherSpec | undefined {
    return this.sessions[id]?.spec;
  }

  /** Sessions that have not finished. */
  active(): SessionView[] {
    return Object.values(this.sessions)
      .filter((s) => !TERMINAL[s.state])
      .map((s) => this.view(s));
  }

  /** Forgets every session and its output (the capability is shutting down). */
  clear(): void {
    for (const s of Object.values(this.sessions)) {
      s.stdout.clear();
      s.stderr.clear();
    }
    this.sessions = {};
    this.order = [];
  }

  // ── internals ────────────────────────────────────────────────────────────

  private require(id: string): Session {
    const session = this.sessions[id];
    if (!session) throw refuse(ErrorCode.RESOURCE_NOT_FOUND, `Unknown session "${id.slice(0, 40)}"`);
    return session;
  }

  private note(session: Session, kind: HistoryKind, detail?: HistoryEntry["detail"]): void {
    session.history.push({ at: this.o.now(), kind, ...(detail ? { detail } : {}) });
    if (session.history.length > MAX_HISTORY) session.history.shift();
  }

  private onOutput(session: Session, ring: OutputRing, chunk: Buffer): void {
    const lines = ring.feed(chunk);
    const prompts = session.spec.waiting_prompts;
    if (!prompts || session.state !== "running") return;
    if (lines.some((line) => prompts.some((p) => line.includes(p)))) {
      session.state = "waiting";
      this.note(session, "waiting");
      this.o.onChange(this.view(session), "waiting");
    }
  }

  private terminate(id: string, reason: StopReason): Promise<SessionView> {
    const session = this.require(id);
    if (!TERMINAL[session.state] && session.stopReason === undefined) {
      session.stopReason = reason;
      session.child.kill("SIGTERM");
      // The supervisor SIGKILLs the process group after the grace period; if the supervisor
      // itself is wedged, Core kills it after a further margin.
      session.cancelKill = this.o.schedule(
        () => session.child.kill("SIGKILL"),
        this.o.graceMs + SUPERVISOR_MARGIN_MS,
      );
    }
    return session.exited.then(() => this.view(session));
  }

  private finish(session: Session, code: number | null, signal: NodeJS.Signals | null): void {
    session.cancelRuntime();
    session.cancelKill();
    session.stdout.end();
    session.stderr.end();
    session.child.stdio[3]?.destroy();
    session.endedAt = this.o.now();
    session.exitCode = code;
    session.signal = signal;

    let change: SessionChange;
    if (session.stopReason === "max_runtime") {
      session.state = "failed";
      session.failure = "ran longer than the maximum runtime and was stopped";
      change = "failed";
    } else if (session.stopReason !== undefined) {
      session.state = "stopped";
      change = "stopped";
    } else if (code === 0) {
      session.state = "completed";
      change = "completed";
    } else {
      session.state = "failed";
      session.failure ??= signal ? `killed by ${signal}` : `exited with code ${String(code)}`;
      change = "failed";
    }
    this.note(session, session.state, {
      ...(code === null ? {} : { exit_code: code }),
      ...(session.stopReason ? { stop_reason: session.stopReason } : {}),
    });
    this.evict();
    try {
      this.o.onChange(this.view(session), change);
    } catch (err) {
      this.o.warn("session change handler failed", { error: String(err) });
    }
  }

  private evict(): void {
    const finished = this.order.filter((id) => {
      const s = this.sessions[id];
      return s !== undefined && TERMINAL[s.state];
    });
    for (const id of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) {
      const s = this.sessions[id];
      s?.stdout.clear();
      s?.stderr.clear();
      delete this.sessions[id];
      this.order = this.order.filter((o) => o !== id);
    }
  }

  private view(s: Session): SessionView {
    return {
      id: s.id,
      launcher: s.launcher,
      workspace: s.workspace,
      repository: repositoryName(s.workspace),
      state: s.state,
      started_at: new Date(s.startedAt).toISOString(),
      ...(s.endedAt === undefined ? {} : { ended_at: new Date(s.endedAt).toISOString() }),
      ...(s.exitCode === undefined ? {} : { exit_code: s.exitCode }),
      ...(s.signal ? { signal: s.signal } : {}),
      ...(s.stopReason ? { stop_reason: s.stopReason } : {}),
      ...(s.failure ? { failure: s.failure } : {}),
      accepts_input: s.spec.stdin !== "close_after_prompt" && !TERMINAL[s.state],
      messages_sent: s.messagesSent,
      output: { stdout: s.stdout.stats(), stderr: s.stderr.stats() },
    };
  }
}
