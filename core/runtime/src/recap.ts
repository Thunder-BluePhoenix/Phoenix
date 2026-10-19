// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Weekly recap (Phase 69), Core side. Everything is a count kept on this computer; no AI call, no
// network, no content. Where the numbers come from:
//   - Agent activity (steps, files, lines, commands, sessions, time, per agent / project): bumped
//     by AgentLive as hooks report, into `recap_daily` (migration 28), so it outlives the capped
//     events table and a Core restart.
//   - Commits and CI outcomes: counted from `git.commit.created` / `github.ci.*` events as they
//     arrive (and, once, from whatever the events table already holds), into the same table.
//   - Permissions: read from the audit log by timestamp.
//   - Meetings and decisions: read from the meetings tables, only while sensitive meeting data is
//     allowed (the memory setting `allow_sensitive_meetings`).
// A week starts on Monday; "day" is a local calendar date in an injectable time zone.
import type { RecapApi, RecapGridView, RecapRankView, RecapView } from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import {
  RECAP_OTHER_KEY,
  RecapStore,
  type Database,
  type RecapBump,
  type RecapRow,
  type SettingsStore,
} from "@phoenix/persistence";
import { ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import {
  addDays,
  assertTimeZone,
  dayKeyOf,
  isDayKey,
  systemTimeZone,
  utcWindow,
  weekDays,
  weekStartOf,
} from "./recap-calendar";

/** Metric names in `recap_daily`. */
export const RECAP_METRIC = {
  steps: "steps",
  files: "files",
  linesAdded: "lines_added",
  linesRemoved: "lines_removed",
  commands: "commands",
  sessions: "sessions",
  activeMs: "active_ms",
  longestSessionMs: "longest_session_ms",
  agentSteps: "agent_steps",
  projectSteps: "project_steps",
  commits: "commits",
  ciPassed: "ci_passed",
  ciFailed: "ci_failed",
} as const;

/** Where AgentLive reports what it saw; `atMs` is Core's clock, never the sender's. */
export interface RecapSink {
  bump(atMs: number, bumps: readonly RecapBump[]): void;
  /**
   * Goes up each time the statistics are deleted. A live session that last reported under an
   * earlier epoch must not carry its time from before the delete into the new counts.
   */
  readonly epoch: number;
}

/** Most lines one step may add (or remove) in the recap; a hook reports the number, Core cannot check it. */
export const MAX_STEP_LINES = 100_000;
/** Most lines of each kind one live session may add to the recap in total. */
export const MAX_SESSION_LINES = 1_000_000;

/** How many of `reported` lines the recap counts, given what this session already put in. */
export function countableLines(reported: number, alreadyCounted: number): number {
  const room = Math.max(0, MAX_SESSION_LINES - alreadyCounted);
  return Math.max(0, Math.min(reported, MAX_STEP_LINES, room));
}

/** A gap longer than this between two reports from one session is not counted as coding time. */
export const IDLE_GAP_MS = 5 * 60_000;
/** Distinct agents / projects remembered per day; further names count as "(other)". */
export const MAX_AGENTS_PER_DAY = 20;
export const MAX_PROJECTS_PER_DAY = 50;
/** Days of recap rows kept (about two years); older rows are dropped on maintenance. */
export const RECAP_KEEP_DAYS = 800;
/** Columns of the contribution grid (one per week, like GitHub's). */
export const GRID_WEEKS = 53;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const BACKFILLED_KEY = "recap.backfilled";

const GIT_COMMIT = "git.commit.created";
const CI_EVENTS: Record<string, string> = {
  "github.ci.passed": RECAP_METRIC.ciPassed,
  "github.ci.failed": RECAP_METRIC.ciFailed,
};
const COUNTED_EVENTS = [GIT_COMMIT, ...Object.keys(CI_EVENTS)];

const GRANT_ACTIONS = ["agent_approval.resolved", "confirmation.approved"];
const DENY_ACTIONS = [
  "agent_approval.resolved",
  "confirmation.rejected",
  "confirmation.expired",
  "confirmation.cancelled",
];

export interface RecapDeps {
  db: Database;
  settings: SettingsStore;
  bus: EventBus;
  audit: Pick<AuditLog, "record">;
  /** True while the user allows sensitive meeting data into Phoenix. */
  meetingsAllowed: () => boolean;
  logger: Logger;
  now?: () => number;
  /** IANA zone that defines "a day"; default: this computer's. */
  timeZone?: string;
}

interface ClockRow {
  timestamp: string;
  event_type: string;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

export class RecapRuntime implements RecapApi, RecapSink {
  readonly store: RecapStore;
  private readonly now: () => number;
  private readonly timeZone: string;
  private readonly unsubscribe: () => void;

  constructor(private readonly d: RecapDeps) {
    this.store = new RecapStore(d.db);
    this.now = d.now ?? Date.now;
    this.timeZone = assertTimeZone(d.timeZone ?? systemTimeZone());
    this.backfill();
    this.unsubscribe = d.bus.subscribe("recap", COUNTED_EVENTS, (event) => this.onEvent(event));
  }

  close(): void {
    this.unsubscribe();
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /** See RecapSink.epoch. */
  epoch = 0;

  bump(atMs: number, bumps: readonly RecapBump[]): void {
    this.store.bump(dayKeyOf(atMs, this.timeZone), bumps);
  }

  /**
   * Only the capability that owns the event family counts. This is NOT a defence against a forged
   * event: anyone holding the session token can publish an event with source `github` or `git`
   * (the simulator does exactly that), so a forged `github.ci.failed` IS counted. The recap is a
   * personal tally on this computer, not evidence; what is enforced is only that the counts stay
   * bounded: events older than RECAP_KEEP_DAYS are dropped (they would be pruned at once anyway)
   * and a timestamp more than a day ahead is replaced by Core's clock.
   */
  private metricOf(event: PhoenixEvent): string | undefined {
    if (event.event_type === GIT_COMMIT && event.source === "git") return RECAP_METRIC.commits;
    return event.source === "github" ? CI_EVENTS[event.event_type] : undefined;
  }

  /** The first day still kept, as a day key; anything earlier is not counted. */
  private oldestKeptDay(now: number): string {
    return addDays(dayKeyOf(now, this.timeZone), -RECAP_KEEP_DAYS);
  }

  private onEvent(event: PhoenixEvent): void {
    const metric = this.metricOf(event);
    if (!metric) return;
    const now = this.now();
    const stamped = Date.parse(event.timestamp);
    // A clock more than a day ahead is not trusted.
    const at = Number.isFinite(stamped) && stamped <= now + 86_400_000 ? stamped : now;
    if (dayKeyOf(at, this.timeZone) < this.oldestKeptDay(now)) return;
    try {
      this.bump(at, [{ metric, value: 1 }]);
    } catch (err) {
      this.d.logger.warn("recap: could not count an event", { error: (err as Error).message });
    }
  }

  /** Once: counts commits and CI outcomes the events table already holds from before the recap. */
  private backfill(): void {
    if (this.d.settings.get<boolean>(BACKFILLED_KEY, false)) return;
    const rows = this.d.db
      .prepare(
        `SELECT timestamp, event_type FROM events
         WHERE event_type IN (${COUNTED_EVENTS.map(() => "?").join(", ")})
           AND source = CASE WHEN event_type LIKE 'git.%' THEN 'git' ELSE 'github' END`,
      )
      .all(...COUNTED_EVENTS) as unknown as ClockRow[];
    const now = this.now();
    const oldest = this.oldestKeptDay(now);
    for (const row of rows) {
      const metric =
        row.event_type === GIT_COMMIT ? RECAP_METRIC.commits : CI_EVENTS[row.event_type];
      const stamped = Date.parse(row.timestamp);
      if (!metric || !Number.isFinite(stamped)) continue;
      const at = Math.min(stamped, now);
      if (dayKeyOf(at, this.timeZone) < oldest) continue;
      this.bump(at, [{ metric, value: 1 }]);
    }
    this.d.settings.set(BACKFILLED_KEY, true);
  }

  /** Drops rows older than RECAP_KEEP_DAYS. */
  maintain(): number {
    return this.store.deleteBefore(this.oldestKeptDay(this.now()));
  }

  deleteAll(): { deleted: number } {
    const deleted = this.store.deleteAll();
    this.epoch++;
    void this.d.audit.record({
      actor: "user",
      action: "recap.stats.delete",
      decision: "info",
      details: { deleted },
    });
    return { deleted };
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  recap(week: string | undefined): RecapView {
    const today = dayKeyOf(this.now(), this.timeZone);
    if (week !== undefined) {
      if (!isDayKey(week)) throw invalid('"week" must be a day written YYYY-MM-DD');
      const year = Number(week.slice(0, 4));
      if (year < MIN_YEAR || year > MAX_YEAR) throw invalid('"week" is out of range');
    }
    const start = weekStartOf(week ?? today);
    const days = weekDays(start);
    const end = days[6]!;
    const gridStart = addDays(start, -7 * (GRID_WEEKS - 1));
    const rows = this.store.range(gridStart, end);

    const inWeek = new Set(days);
    const byDay = new Map<string, Map<string, number>>();
    const agents = new Map<string, number>();
    const projects = new Map<string, number>();
    for (const row of rows) {
      if (row.key === "") put(byDay, row);
      else if (!inWeek.has(row.day)) continue;
      else if (row.metric === RECAP_METRIC.agentSteps) add(agents, row.key, row.value);
      else if (row.metric === RECAP_METRIC.projectSteps) add(projects, row.key, row.value);
    }
    const metric = (day: string, name: string) => byDay.get(day)?.get(name) ?? 0;
    const sum = (name: string) => days.reduce((n, day) => n + metric(day, name), 0);

    const daily = days.map((day) => ({
      day,
      steps: metric(day, RECAP_METRIC.steps),
      seconds: toSeconds(metric(day, RECAP_METRIC.activeMs)),
      commits: metric(day, RECAP_METRIC.commits),
    }));
    // The day with the most steps; the earlier day wins a tie; none when nothing happened.
    const busiest = daily.reduce<(typeof daily)[number] | null>(
      (best, d) => (d.steps > (best?.steps ?? 0) ? d : best),
      null,
    );
    const linesAdded = sum(RECAP_METRIC.linesAdded);
    const linesRemoved = sum(RECAP_METRIC.linesRemoved);
    const permissions = this.permissions(days);
    const allowed = this.d.meetingsAllowed();

    return {
      week: {
        start,
        end,
        days,
        time_zone: this.timeZone,
        current: inWeek.has(today),
      },
      coding: {
        seconds: toSeconds(sum(RECAP_METRIC.activeMs)),
        sessions: sum(RECAP_METRIC.sessions),
        steps: sum(RECAP_METRIC.steps),
        files: sum(RECAP_METRIC.files),
        lines_added: linesAdded,
        lines_removed: linesRemoved,
        lines_changed: linesAdded + linesRemoved,
        commands: sum(RECAP_METRIC.commands),
        longest_session_seconds: toSeconds(
          Math.max(0, ...days.map((day) => metric(day, RECAP_METRIC.longestSessionMs))),
        ),
      },
      permissions,
      top_agent: top(agents),
      top_project: top(projects),
      busiest_day: busiest
        ? { day: busiest.day, steps: busiest.steps, seconds: busiest.seconds }
        : null,
      days: daily,
      commits: sum(RECAP_METRIC.commits),
      ci: { passed: sum(RECAP_METRIC.ciPassed), failed: sum(RECAP_METRIC.ciFailed) },
      meetings: allowed ? this.meetings(days) : null,
      meetings_allowed: allowed,
      grid: grid(start, today, byDay),
    };
  }

  /** Approvals the user decided in this week, from the audit log (by its own timestamp). */
  private permissions(days: readonly string[]): RecapView["permissions"] {
    const { since, until } = utcWindow(days[0]!, days[6]!);
    const inWeek = new Set(days);
    const rows = this.d.db
      .prepare(
        `SELECT ts, action, decision FROM audit_log
         WHERE ts >= ? AND ts < ? AND decision IN ('allowed', 'denied')`,
      )
      .all(since, until) as unknown as { ts: string; action: string; decision: string }[];
    let granted = 0;
    let denied = 0;
    for (const row of rows) {
      const at = Date.parse(row.ts);
      if (!Number.isFinite(at) || !inWeek.has(dayKeyOf(at, this.timeZone))) continue;
      if (row.decision === "allowed" && GRANT_ACTIONS.includes(row.action)) granted++;
      else if (row.decision === "denied" && DENY_ACTIONS.includes(row.action)) denied++;
    }
    return { granted, denied };
  }

  /** Meetings that started in the week and the decisions the user kept from them. */
  private meetings(days: readonly string[]): { count: number; decisions: number } {
    const { since, until } = utcWindow(days[0]!, days[6]!);
    const inWeek = new Set(days);
    const meetings = this.d.db
      .prepare(
        `SELECT id, started_at FROM meetings
         WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ?`,
      )
      .all(since, until) as unknown as { id: string; started_at: string }[];
    const ids = new Set<string>();
    for (const m of meetings) {
      const at = Date.parse(m.started_at);
      if (Number.isFinite(at) && inWeek.has(dayKeyOf(at, this.timeZone))) ids.add(m.id);
    }
    const items = this.d.db
      .prepare(
        `SELECT meeting_id FROM meeting_items
         WHERE kind = 'decision' AND status IN ('accepted', 'edited')`,
      )
      .all() as unknown as { meeting_id: string }[];
    return { count: ids.size, decisions: items.filter((i) => ids.has(i.meeting_id)).length };
  }
}

const toSeconds = (ms: number): number => Math.round(ms / 1000);

function add(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function put(byDay: Map<string, Map<string, number>>, row: RecapRow): void {
  let metrics = byDay.get(row.day);
  if (!metrics) byDay.set(row.day, (metrics = new Map()));
  metrics.set(row.metric, row.value);
}

/** The most steps; the name that sorts first wins a tie. */
function top(counts: ReadonlyMap<string, number>): RecapRankView | null {
  let best: RecapRankView | null = null;
  for (const [name, steps] of counts) {
    // "(other)" is a bucket of many names, not a name.
    if (steps === 0 || name === RECAP_OTHER_KEY) continue;
    if (!best || steps > best.steps || (steps === best.steps && name < best.name))
      best = { name, steps };
  }
  return best;
}

/** Commits per local day for the GRID_WEEKS weeks ending with the recap's week. */
function grid(
  start: string,
  today: string,
  byDay: ReadonlyMap<string, ReadonlyMap<string, number>>,
): RecapGridView {
  let max = 0;
  let total = 0;
  const weeks = Array.from({ length: GRID_WEEKS }, (_, w) => {
    const first = addDays(start, -7 * (GRID_WEEKS - 1 - w));
    return {
      start: first,
      days: weekDays(first).map((day) => {
        const count = day > today ? 0 : (byDay.get(day)?.get(RECAP_METRIC.commits) ?? 0);
        max = Math.max(max, count);
        total += count;
        return { day, count };
      }),
    };
  });
  return { weeks, max, total, source: "local-git-events" };
}
