// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Live coding-agent sessions (Phase 58), Core side. Agents' hooks report one STEP per tool call
// (a path or a short, redacted command: never tool output or file contents) and the plan usage
// their status line shows. From those Core keeps, in memory and bounded:
//   - a ring of the last 500 steps per session,
//   - per-file {added, removed, edits} counts (the full diff is computed on demand from git),
//   - the latest plan usage per agent and window, with one-shot warnings before a limit.
// Nothing here is a capability command or tool, so an agent cannot reach it through the tool
// gateway; the hooks use the session token (or the Phase 57 relay). Only warnings thresholds and
// "already warned" markers are persisted (two settings keys), so a restart cannot repeat a warning.
import { basename, isAbsolute, relative } from "node:path";
import type {
  AgentLiveApi,
  LiveDiffView,
  LiveSessionDetailView,
  LiveSessionView,
  LiveUsageSummaryView,
} from "@phoenix/api";
import {
  CODEX_UNSUPPORTED,
  DEFAULT_THRESHOLDS,
  FileTallies,
  StepLog,
  UsageTracker,
  diffLinks,
  exportMarkdown,
  parseThresholds,
  readDiff,
  windowTitle,
  validateStep,
  validateUsage,
  execGit,
  type FiredState,
  type GitExec,
  type LinkView,
  type SessionDetail,
  type SessionView,
  type StepEvent,
  type TerminalFocuser,
  type UsageSample,
  type UsageWarning,
} from "@phoenix/capability-agents";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import type { RecapBump, SettingsStore } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  IDLE_GAP_MS,
  MAX_AGENTS_PER_DAY,
  MAX_PROJECTS_PER_DAY,
  RECAP_METRIC,
  type RecapSink,
} from "./recap";

export const THRESHOLDS_KEY = "agents.usage.thresholds";
export const FIRED_KEY = "agents.usage.fired";
/** Live sessions kept; the least recently heard from is dropped first. */
export const MAX_LIVE_SESSIONS = 100;
/** A session heard from within this long is "active". */
export const ACTIVE_MS = 10 * 60_000;
/** Clock slack when matching a live session to an orchestrated one by folder and time. */
const MATCH_SLACK_MS = 2 * 60_000;
const PH_ID = /^ph-[0-9a-f]{16}$/;
const LIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

interface LiveSession {
  agent: string;
  id: string;
  project: string;
  firstSeen: number;
  lastSeen: number;
  /** Time between reports that were close enough together to count as coding. */
  activeMs: number;
  steps: StepLog;
  files: FileTallies;
  pid: number | undefined;
  tty: string | undefined;
}

/** How Core reaches the orchestrated sessions of the `agents` capability (read-only commands). */
export interface OrchestratedPort {
  list(): Promise<SessionView[]>;
  get(id: string): Promise<SessionDetail>;
}

export interface AgentLiveDeps {
  bus: EventBus;
  permissions: Pick<PermissionGateway, "authorize" | "recordOutcome">;
  settings: SettingsStore;
  logger: Logger;
  orchestrated: OrchestratedPort;
  /** Absent where jumping to a terminal is not supported. */
  focuser?: TerminalFocuser;
  git?: GitExec;
  now?: () => number;
  /** Where the weekly recap's counts go (Phase 69); absent = nothing is counted. */
  recap?: RecapSink;
}

const notFound = (what: string) => new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, what);
const invalid = (problems: string[]) =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid request", problems);

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

// eslint-disable-next-line no-control-regex
const UNSEEN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/** A name from a hook, safe to show in a confirmation: no control, bidi or zero-width characters, at most 80. */
export function displayName(raw: string): string {
  const clean = raw.replace(UNSEEN, "").trim();
  return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

/** What the user is asked to confirm: the exact terminal Core will act on. */
function focusSummary(target: LiveSession): string {
  const where = [
    target.tty ? `tty ${target.tty}` : undefined,
    target.pid ? `pid ${target.pid}` : undefined,
    `window titled "${displayName(windowTitle(target.project))}"`,
  ].filter((part) => part !== undefined);
  const agent = displayName(target.agent) || "an agent";
  const project = displayName(basename(target.project)) || "a project";
  return `Agents: bring the terminal window of ${agent} in ${project} to the front (${where.join(", ")})`;
}

export class AgentLive implements AgentLiveApi {
  private sessionsByKey: Record<string, LiveSession> = {};
  private readonly tracker: UsageTracker;
  private readonly now: () => number;
  private thresholds: number[];

  constructor(private readonly d: AgentLiveDeps) {
    this.now = d.now ?? Date.now;
    this.thresholds = parseThresholds(d.settings.get<unknown>(THRESHOLDS_KEY, null)) ?? [
      ...DEFAULT_THRESHOLDS,
    ];
    const saved = d.settings.get<FiredState | null>(FIRED_KEY, null);
    this.tracker = new UsageTracker({
      now: this.now,
      thresholds: () => this.thresholds,
      fired: saved && typeof saved === "object" ? saved : {},
      persist: (fired) => d.settings.set(FIRED_KEY, fired),
      onWarning: (warning) => this.warn(warning),
    });
  }

  // ── Reports from hooks ────────────────────────────────────────────────────

  recordStep(body: unknown): { accepted: true; n: number } {
    const result = validateStep(body, this.now());
    if (!result.ok) throw invalid(result.problems);
    const step = result.step;
    const { session, created, gapMs } = this.touch(step);
    const logged = session.steps.push(step);
    // A file is new to the recap the first time this live session changes it.
    const newFile = step.file !== undefined && !session.files.has(step.file.path);
    const file = step.file ? session.files.apply(step.file, step.at) : undefined;
    this.recapStep(step, session, { created, gapMs, newFile });
    this.publish(
      "agent.session.step",
      {
        agent: step.agent,
        session_id: step.session_id,
        // The session's own project (its first report), whatever this step's cwd was.
        project: session.project,
        n: logged.n,
        kind: step.kind,
        tool: step.tool,
        target: step.target,
        at: step.at,
        ...(file
          ? {
              file: {
                path: file.path,
                added: file.added,
                removed: file.removed,
                edits: file.edits,
              },
            }
          : {}),
      },
      { ephemeral: true },
    );
    return { accepted: true, n: logged.n };
  }

  recordUsage(body: unknown): { accepted: number } {
    const result = validateUsage(body, this.now());
    if (!result.ok) throw invalid(result.problems);
    const accepted = result.samples.filter((sample) => this.acceptUsage(sample)).length;
    if (accepted === 0 && result.samples.length > 0)
      throw invalid(["too many different agents are reporting usage"]);
    return { accepted };
  }

  setThresholds(body: unknown): { thresholds: number[] } {
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).thresholds
        : undefined;
    const parsed = parseThresholds(raw);
    if (!parsed) throw invalid(["thresholds must be 1 to 4 different whole percents from 1 to 99"]);
    this.thresholds = parsed;
    this.d.settings.set(THRESHOLDS_KEY, parsed);
    return { thresholds: parsed };
  }

  private acceptUsage(sample: UsageSample): boolean {
    if (!this.tracker.record(sample)) return false;
    this.publish(
      "agent.usage.updated",
      {
        agent: sample.agent,
        window: sample.window,
        used_pct: sample.used_pct,
        resets_at: sample.resets_at,
      },
      { ephemeral: true },
    );
    return true;
  }

  private warn(w: UsageWarning): void {
    const highest = this.thresholds[this.thresholds.length - 1];
    this.publish(
      "agent.usage.warning",
      {
        agent: w.agent,
        window: w.window,
        threshold: w.threshold,
        used_pct: w.used_pct,
        resets_at: w.resets_at,
      },
      {
        severity: this.thresholds.length > 1 && w.threshold === highest ? "error" : "warning",
        subject: `${w.agent} ${w.window}`,
      },
    );
  }

  private publish(
    type: string,
    payload: Record<string, unknown>,
    options: {
      ephemeral?: boolean;
      severity?: "info" | "warning" | "error";
      subject?: string;
    } = {},
  ): void {
    const result = this.d.bus.publish(
      createEvent({
        event_type: type,
        source: "core",
        severity: options.severity ?? "info",
        ...(options.subject ? { subject: options.subject } : {}),
        payload,
      }),
      options.ephemeral ? { ephemeral: true } : {},
    );
    if (!result.ok)
      this.d.logger.warn("agent live event rejected", { type, code: result.error.code });
  }

  /** Finds or creates the session a step belongs to; the table stays bounded. */
  private touch(step: StepEvent): { session: LiveSession; created: boolean; gapMs: number } {
    const key = `${step.agent}:${step.session_id}`;
    const at = this.now();
    let session = this.sessionsByKey[key];
    const created = !session;
    if (!session) {
      session = {
        agent: step.agent,
        id: step.session_id,
        project: step.project,
        firstSeen: at,
        lastSeen: at,
        activeMs: 0,
        steps: new StepLog(),
        files: new FileTallies(),
        pid: undefined,
        tty: undefined,
      };
      this.sessionsByKey[key] = session;
      const all = Object.entries(this.sessionsByKey);
      if (all.length > MAX_LIVE_SESSIONS) {
        all.sort(([, a], [, b]) => a.lastSeen - b.lastSeen);
        for (const [oldKey] of all.slice(0, all.length - MAX_LIVE_SESSIONS)) {
          delete this.sessionsByKey[oldKey];
        }
      }
    }
    const gapMs = at - session.lastSeen;
    session.lastSeen = at;
    if (step.pid) session.pid = step.pid;
    if (step.tty) session.tty = step.tty;
    return { session, created, gapMs };
  }

  /**
   * The weekly recap's counts (Phase 69): numbers only, kept in `recap_daily`. Coding time is the
   * time between two reports of one session when they are at most IDLE_GAP_MS apart. A session
   * that resumes after a Core restart counts as a new one (the live table is memory only).
   */
  private recapStep(
    step: StepEvent,
    session: LiveSession,
    seen: { created: boolean; gapMs: number; newFile: boolean },
  ): void {
    if (!this.d.recap) return;
    const worked = !seen.created && seen.gapMs > 0 && seen.gapMs <= IDLE_GAP_MS ? seen.gapMs : 0;
    session.activeMs += worked;
    const bumps: RecapBump[] = [
      { metric: RECAP_METRIC.steps, value: 1 },
      {
        metric: RECAP_METRIC.agentSteps,
        key: displayName(step.agent),
        value: 1,
        maxKeys: MAX_AGENTS_PER_DAY,
      },
      {
        metric: RECAP_METRIC.projectSteps,
        key: displayName(basename(session.project)) || "(unnamed)",
        value: 1,
        maxKeys: MAX_PROJECTS_PER_DAY,
      },
    ];
    if (seen.created) bumps.push({ metric: RECAP_METRIC.sessions, value: 1 });
    if (worked > 0) bumps.push({ metric: RECAP_METRIC.activeMs, value: worked });
    if (session.activeMs > 0)
      bumps.push({ metric: RECAP_METRIC.longestSessionMs, value: session.activeMs, mode: "max" });
    if (step.kind === "run") bumps.push({ metric: RECAP_METRIC.commands, value: 1 });
    if (step.file) {
      if (seen.newFile) bumps.push({ metric: RECAP_METRIC.files, value: 1 });
      if (step.file.added > 0)
        bumps.push({ metric: RECAP_METRIC.linesAdded, value: step.file.added });
      if (step.file.removed > 0)
        bumps.push({ metric: RECAP_METRIC.linesRemoved, value: step.file.removed });
    }
    try {
      this.d.recap.bump(this.now(), bumps);
    } catch (err) {
      this.d.logger.warn("recap: could not count a step", { error: (err as Error).message });
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private view(s: LiveSession): LiveSessionView {
    return {
      id: s.id,
      agent: s.agent,
      project: s.project,
      repository: basename(s.project) || s.project,
      first_seen: new Date(s.firstSeen).toISOString(),
      last_seen: new Date(s.lastSeen).toISOString(),
      active: this.now() - s.lastSeen < ACTIVE_MS,
      step_count: s.steps.total,
      dropped_steps: s.steps.dropped,
      has_terminal: s.tty !== undefined,
    };
  }

  sessions(): LiveSessionView[] {
    return Object.values(this.sessionsByKey)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((s) => this.view(s));
  }

  /** The live sessions an id stands for: the session itself, or those that ran in a `ph-…` session's folder while it was active. */
  private async resolve(id: string): Promise<{
    matchedBy: "id" | "folder+time";
    live: LiveSession[];
    orchestrated?: SessionDetail;
  }> {
    if (PH_ID.test(id)) {
      let detail: SessionDetail;
      try {
        detail = await this.d.orchestrated.get(id);
      } catch {
        throw notFound("Session not found");
      }
      const ph = detail.session;
      if (!ph) return { matchedBy: "folder+time", live: [], orchestrated: detail };
      const from = Date.parse(ph.started_at) - MATCH_SLACK_MS;
      const to = (ph.ended_at ? Date.parse(ph.ended_at) : this.now()) + MATCH_SLACK_MS;
      const live = Object.values(this.sessionsByKey)
        .filter((s) => inside(ph.workspace, s.project) && s.lastSeen >= from && s.firstSeen <= to)
        .sort((a, b) => b.lastSeen - a.lastSeen);
      return { matchedBy: "folder+time", live, orchestrated: detail };
    }
    if (!LIVE_ID.test(id)) throw notFound("Session not found");
    const live = Object.values(this.sessionsByKey).filter((s) => s.id === id);
    if (live.length === 0) throw notFound("Session not found");
    return { matchedBy: "id", live };
  }

  async session(id: string): Promise<LiveSessionDetailView> {
    const { matchedBy, live } = await this.resolve(id);
    const steps = live
      .flatMap((s) => s.steps.list().map((step) => ({ ...step, session_id: s.id })))
      .sort((a, b) => a.at.localeCompare(b.at) || a.n - b.n)
      .slice(-500);
    return {
      id,
      matched_by: matchedBy,
      sessions: live.map((s) => this.view(s)),
      steps,
      files: live
        .flatMap((s) => s.files.list().map((f) => ({ ...f, session_id: s.id })))
        .sort((a, b) => b.last_at.localeCompare(a.last_at)),
      dropped_steps: live.reduce((n, s) => n + s.steps.dropped, 0),
    };
  }

  /** Commits and CI runs Phoenix already linked to the orchestrated sessions that overlap `live`. */
  private async linksFor(id: string, live: LiveSession | undefined): Promise<LinkView[]> {
    if (PH_ID.test(id)) return this.linksOf(id);
    if (!live) return [];
    let phs: SessionView[];
    try {
      phs = await this.d.orchestrated.list();
    } catch {
      return [];
    }
    const matching = phs
      .filter(
        (ph) =>
          inside(ph.workspace, live.project) &&
          live.lastSeen >= Date.parse(ph.started_at) - MATCH_SLACK_MS &&
          live.firstSeen <= (ph.ended_at ? Date.parse(ph.ended_at) : this.now()) + MATCH_SLACK_MS,
      )
      .map((ph) => this.linksOf(ph.id));
    return (await Promise.all(matching)).flat();
  }

  /** The links Phoenix's correlator already stored for an orchestrated session. */
  private async linksOf(id: string): Promise<LinkView[]> {
    try {
      return (await this.d.orchestrated.get(id)).links;
    } catch {
      return [];
    }
  }

  /**
   * The diff of one file. A live session is diffed in the project of its FIRST report (a later
   * step claiming another cwd never moves it); an orchestrated `ph-…` id is diffed in the
   * workspace Phoenix configured for it.
   */
  async diff(id: string, path: string): Promise<LiveDiffView> {
    const { live, orchestrated } = await this.resolve(id);
    const owner =
      live.find((s) => s.files.has(path)) ??
      live.find((s) => isAbsolute(path) && inside(s.project, path)) ??
      live[0];
    const workspace = orchestrated?.session?.workspace;
    const project = workspace ?? owner?.project;
    if (!project) throw notFound("No live session of this folder has reported file changes");
    const file = await readDiff(project, path, this.d.git ?? execGit);
    const { commits, ci_runs } = diffLinks(await this.linksFor(id, owner));
    return { session_id: owner?.id ?? id, ...file, commits, ci_runs };
  }

  async exportMarkdown(id: string): Promise<string> {
    const resolved = await this.resolve(id);
    const detail = await this.session(id);
    const owner = resolved.live[0];
    const { commits, ci_runs } = diffLinks(await this.linksFor(id, owner));
    const ph = resolved.orchestrated?.session ?? undefined;
    return exportMarkdown({
      id,
      ...(ph
        ? {
            session: {
              launcher: ph.launcher,
              workspace: ph.workspace,
              state: ph.state,
              started_at: ph.started_at,
              ...(ph.ended_at ? { ended_at: ph.ended_at } : {}),
            },
          }
        : {}),
      live: detail.sessions.map((s) => ({
        agent: s.agent,
        project: s.project,
        first_seen: s.first_seen,
        last_seen: s.last_seen,
      })),
      timeline: resolved.orchestrated?.timeline ?? [],
      steps: detail.steps,
      dropped_steps: detail.dropped_steps,
      files: detail.files,
      commits,
      ci_runs,
    });
  }

  // ── Jump to terminal ──────────────────────────────────────────────────────

  async focusTerminal(id: string): Promise<{ focused: true; method: string }> {
    const { live } = await this.resolve(id);
    const target = live.find((s) => s.tty !== undefined) ?? live[0];
    if (!target) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "No terminal window is known for this session (Phoenix started it without one)",
      );
    }
    const focuser = this.d.focuser;
    if (!focuser) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "Jumping to a terminal is not supported on this system",
      );
    }
    // Starting a process is a side effect: the user confirms it (and it is audited) first.
    const action = await this.d.permissions.authorize({
      capabilityId: "agents",
      command: "session.focus_terminal",
      permissions: [],
      sideEffect: "execute",
      summary: focusSummary(target),
    });
    try {
      const done = await focuser.focus({
        project: target.project,
        ...(target.pid ? { pid: target.pid } : {}),
        ...(target.tty ? { tty: target.tty } : {}),
      });
      this.d.permissions.recordOutcome(action, "succeeded", {
        session_id: id,
        method: done.method,
      });
      return done;
    } catch (err) {
      this.d.permissions.recordOutcome(action, "failed", { session_id: id });
      throw err;
    }
  }

  // ── Plan usage ────────────────────────────────────────────────────────────

  usage(): LiveUsageSummaryView {
    return {
      usage: this.tracker.views(),
      thresholds: [...this.thresholds],
      unsupported: [{ ...CODEX_UNSUPPORTED }],
    };
  }
}
