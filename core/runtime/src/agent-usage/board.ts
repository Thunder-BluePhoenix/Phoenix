// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The mission-control board: every agent session Core knows of, put into one of four columns.
// The mapping is explicit and pure (`mapState`); docs/mission-control.md documents the same table.
//
//   source state                                          column     why
//   ----------------------------------------------------  ---------  ------------------------------
//   report `completed` / `failed`; orchestrated            finished   the agent said it is done (a
//     `completed` / `failed` / `stopped`                              stall flag never overrides it)
//   report `waiting` (permission | input | idle);          waiting    the agent is waiting on YOU (a
//     orchestrated `waiting`                                          stall flag does not move it)
//   `started` / `working` / orchestrated `running` with    stuck      Phoenix's own stall detector
//     a Phase 77 `agent.safety.stall` flagged for it                  (flag newer than any report)
//   the same, last report/step older than `stuckAfterMin`  stuck      "active" but silent for longer
//                                                                     than the stall limit (30 min)
//   the same, otherwise                                    working
//   only steps were seen (no state report), last step      working
//     younger than 10 minutes (the AgentLive "active" rule)
//   only steps were seen, last step older                  finished   nothing says it is active; Core
//                                                                     cannot tell ended from idle
//
// Orchestrated (`ph-…`) sessions have no activity timestamp, so silence alone never marks them
// stuck; only a stall event does.
import type { LiveSessionView, MissionSessionView, MissionState } from "@phoenix/api";
import type { ActiveAgent, SessionView } from "@phoenix/capability-agents";
import { folderName } from "@phoenix/capability-agents";

/** Default stall limit: an active session with no report for longer than this is stuck. */
export const DEFAULT_STUCK_AFTER_MIN = 30;
export const MIN_STUCK_AFTER_MIN = 5;
export const MAX_STUCK_AFTER_MIN = 1_440;
/** A session known only from steps is "working" when its last step is younger than this (same as AgentLive's `active`). */
export const LIVE_ACTIVE_MS = 10 * 60_000;

export interface StateInput {
  /** What the best source said; "active" / "silent" for sessions seen only through steps. */
  raw: string;
  /** Last time anything was heard from the session, ms since epoch; undefined when unknown. */
  lastSeenMs: number | undefined;
  nowMs: number;
  stuckAfterMin: number;
  /** A Phase 77 stall event is flagged for the session. */
  stalled: boolean;
}

export interface StateResult {
  state: MissionState;
  stuck_reason?: "no_report" | "safety_stall";
}

const FINISHED_RAW: Record<string, true> = {
  completed: true,
  failed: true,
  stopped: true,
  silent: true,
};
const ACTIVE_RAW: Record<string, true> = { started: true, working: true, running: true };

export function mapState(input: StateInput): StateResult {
  if (Object.hasOwn(FINISHED_RAW, input.raw)) return { state: "finished" };
  if (input.raw === "waiting") return { state: "waiting" };
  if (Object.hasOwn(ACTIVE_RAW, input.raw) || input.raw === "active") {
    if (input.stalled) return { state: "stuck", stuck_reason: "safety_stall" };
    const silentMs =
      input.lastSeenMs === undefined ? undefined : Math.max(0, input.nowMs - input.lastSeenMs);
    // Orchestrated sessions pass lastSeenMs undefined: nothing to measure silence against.
    if (silentMs !== undefined && input.raw !== "active" && silentMs > input.stuckAfterMin * 60_000)
      return { state: "stuck", stuck_reason: "no_report" };
    return { state: "working" };
  }
  // A state this build does not know is not guessed at: it shows as finished with its raw name.
  return { state: "finished" };
}

export interface BoardInputs {
  nowMs: number;
  stuckAfterMin: number;
  live: readonly LiveSessionView[];
  /** Entries of the `agents` capability's `list` (reports from hooks, orchestrated ones included). */
  reports: readonly ActiveAgent[];
  /** Entries of `session.list` (processes Phoenix started). */
  orchestrated: readonly SessionView[];
  /** `${agent}:${session_id}` -> stall time (ms). */
  stalls: ReadonlyMap<string, number>;
  usageOf(agent: string, id: string): MissionSessionView["usage"];
}

interface Draft {
  key: string;
  id: string;
  agent: string;
  project: string;
  raw: string;
  reason?: "permission" | "input" | "idle";
  sources: Set<MissionSessionView["sources"][number]>;
  firstSeen?: number;
  lastSeen?: number;
  steps?: number;
  canOpen: boolean;
  canFocus: boolean;
  /** Only an explicit report or orchestrated state; steps alone do not set it. */
  stated: boolean;
}

const WAIT_REASONS: Record<string, true> = { permission: true, input: true, idle: true };
const ms = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : undefined;
};
const newest = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

/** Merges the three sources by `<agent>:<id>` and maps each session to a column. */
export function buildBoard(input: BoardInputs): MissionSessionView[] {
  const drafts = new Map<string, Draft>();
  const draft = (agent: string, id: string): Draft => {
    const key = `${agent}:${id}`;
    let d = drafts.get(key);
    if (!d) {
      d = {
        key,
        id,
        agent,
        project: "",
        raw: "",
        sources: new Set(),
        canOpen: false,
        canFocus: false,
        stated: false,
      };
      drafts.set(key, d);
    }
    return d;
  };

  for (const s of input.live) {
    const d = draft(s.agent, s.id);
    d.sources.add("steps");
    d.project ||= folderName(s.project);
    d.firstSeen =
      d.firstSeen === undefined
        ? ms(s.first_seen)
        : Math.min(d.firstSeen, ms(s.first_seen) ?? Infinity);
    d.lastSeen = newest(d.lastSeen, ms(s.last_seen));
    d.steps = s.step_count;
    d.canOpen = true;
    d.canFocus = s.has_terminal;
  }
  for (const r of input.reports) {
    const d = draft(r.agent, r.agent_id);
    d.sources.add("report");
    d.project ||= folderName(r.workspace);
    d.raw = r.state;
    d.stated = true;
    if (r.reason && Object.hasOwn(WAIT_REASONS, r.reason)) d.reason = r.reason;
    d.firstSeen ??= ms(r.since);
    d.lastSeen = newest(d.lastSeen, ms(r.updated_at));
  }
  for (const o of input.orchestrated) {
    const d = draft(o.launcher, o.id);
    d.sources.add("orchestrated");
    d.project ||= folderName(o.workspace);
    // The session manager's state wins over the (later, coarser) report of the same session.
    d.raw = o.state;
    d.stated = true;
    d.firstSeen = ms(o.started_at) ?? d.firstSeen;
    d.canOpen = true;
    // No activity timestamp exists for a process Phoenix started.
    d.lastSeen = undefined;
  }

  const out: MissionSessionView[] = [];
  for (const d of drafts.values()) {
    const orchestrated = d.sources.has("orchestrated");
    const raw = d.stated
      ? d.raw
      : input.nowMs - (d.lastSeen ?? 0) < LIVE_ACTIVE_MS
        ? "active"
        : "silent";
    const stallAt = input.stalls.get(d.key);
    const result = mapState({
      raw,
      lastSeenMs: orchestrated ? undefined : d.lastSeen,
      nowMs: input.nowMs,
      stuckAfterMin: input.stuckAfterMin,
      // A stall flag only counts while nothing newer was heard from the session.
      stalled: stallAt !== undefined && (d.lastSeen === undefined || d.lastSeen <= stallAt),
    });
    out.push({
      key: d.key,
      id: d.id,
      agent: d.agent,
      project: d.project,
      state: result.state,
      raw_state: raw,
      ...(result.state === "waiting" && d.reason ? { reason: d.reason } : {}),
      ...(result.stuck_reason ? { stuck_reason: result.stuck_reason } : {}),
      sources: [...d.sources],
      ...(d.firstSeen === undefined ? {} : { first_seen: new Date(d.firstSeen).toISOString() }),
      ...(d.lastSeen === undefined ? {} : { last_seen: new Date(d.lastSeen).toISOString() }),
      ...(d.steps === undefined ? {} : { steps: d.steps }),
      can_open: d.canOpen,
      can_focus: d.canFocus,
      usage: input.usageOf(d.agent, d.id),
    });
  }
  // Needs-you first, then stuck, working, finished; newest activity first within a column.
  const order: Record<MissionState, number> = { waiting: 0, stuck: 1, working: 2, finished: 3 };
  return out.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (b.last_seen ?? b.first_seen ?? "").localeCompare(a.last_seen ?? a.first_seen ?? "") ||
      a.key.localeCompare(b.key),
  );
}
