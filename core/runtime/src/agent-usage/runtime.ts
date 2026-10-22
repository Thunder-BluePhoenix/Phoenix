// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Agent cost meter and mission control (Phase 78), Core side.
//   - Ingest: what agents REPORT about their own session (tokens, and the cost they show) is
//     stored per day in `agent_usage` (migration 32). Nothing is estimated from transcripts and no
//     provider price is built in: a cost exists only when the agent reported one or the user
//     entered a price for the model; otherwise it is unknown (null), never zero. See ingest.ts.
//   - Budgets (daily or per session, in tokens or US dollars) warn BEFORE they are reached through
//     the existing `agent.usage.warning` event (thresholds from `agents.usage.thresholds`, severity
//     rule of AgentLive), once per budget per threshold per day.
//   - Board: all sessions by working / waiting on you / finished / stuck (board.ts).
// The kill switch stops ingest (the agent's report is refused) but never hides what is stored.
import type {
  MissionApi,
  MissionIngestView,
  MissionBudgetStatusView,
  MissionBudgetView,
  MissionConfigView,
  MissionTotalsView,
  MissionView,
} from "@phoenix/api";
import type { Price } from "@phoenix/ai-models";
import {
  DEFAULT_THRESHOLDS,
  parseThresholds,
  validateTokenUsage,
  type ActiveAgent,
  type SessionView,
} from "@phoenix/capability-agents";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import {
  AgentUsageStore,
  type EventStore,
  type AgentUsageRow,
  type AgentUsageTotals,
  type Database,
  type SettingsStore,
} from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import { THRESHOLDS_KEY } from "../agent-live";
import type { LiveSessionView } from "@phoenix/api";
import { addDays, assertTimeZone, dayKeyOf, systemTimeZone } from "../recap-calendar";
import { buildBoard } from "./board";
import {
  BASELINES_KEY,
  BUDGET_FIRED_KEY,
  BUDGETS_KEY,
  PRICES_KEY,
  STUCK_KEY,
  parseBudgets,
  parsePrices,
  parseStuckAfter,
  readBudgets,
  readStuckAfter,
} from "./config";
import { readMarks, UsageIngest } from "./ingest";
import { readPrices } from "./pricing";

export const STALL_EVENT = "agent.safety.stall";
export const DEFAULT_DAYS = 14;
export const MAX_DAYS = 90;
/** Days of usage rows kept (about 13 months); older rows are dropped when a new day starts. */
export const USAGE_KEEP_DAYS = 400;
const MAX_STALLS = 500;
const MAX_FIRED = 2_000;
const MAX_COUNTED_AGENTS = 50;
const MICRO = 1_000_000;

/** What mission control needs from the `agents` capability (read-only commands). */
export interface MissionAgentsPort {
  reports(): Promise<ActiveAgent[]>;
  orchestrated(): Promise<SessionView[]>;
}

export interface AgentUsageDeps {
  db: Database;
  settings: SettingsStore;
  bus: EventBus;
  audit: Pick<AuditLog, "record">;
  agents: MissionAgentsPort;
  /** The live sessions AgentLive holds (steps reported by hooks). */
  liveSessions: () => LiveSessionView[];
  /** Prices in the AI settings, keyed `<provider>:<model>`; used only when the user set none for the agent. */
  aiPrices: () => Readonly<Record<string, Price>>;
  isKillSwitchEngaged: () => boolean;
  logger: Logger;
  /** The event store, to delete budget warning events with "delete all"; absent = they are kept. */
  events?: Pick<EventStore, "deleteByTypeWithPayloadKey">;
  now?: () => number;
  timeZone?: string;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

interface Acc {
  input: number;
  output: number;
  micro: number | null;
  unpriced: number;
}
const fresh = (): Acc => ({ input: 0, output: 0, micro: null, unpriced: 0 });

function addRow(acc: Acc, row: AgentUsageRow): void {
  acc.input += row.input_tokens;
  acc.output += row.output_tokens;
  if (row.cost_micro !== null) acc.micro = (acc.micro ?? 0) + row.cost_micro;
  else if (row.input_tokens + row.output_tokens > 0) acc.unpriced += 1;
}

function view(acc: Acc): MissionTotalsView {
  return {
    input_tokens: acc.input,
    output_tokens: acc.output,
    tokens_reported: acc.input + acc.output > 0,
    cost_usd: acc.micro === null ? null : acc.micro / MICRO,
    cost_partial: acc.micro !== null && acc.unpriced > 0,
  };
}

function viewOfTotals(t: AgentUsageTotals): MissionTotalsView {
  return view({
    input: t.input_tokens,
    output: t.output_tokens,
    micro: t.cost_micro,
    unpriced: t.unpriced_rows,
  });
}

type FiredState = Record<string, number[]>;

export class AgentUsageRuntime implements MissionApi {
  readonly store: AgentUsageStore;
  private readonly ingest: UsageIngest;
  private readonly now: () => number;
  private readonly timeZone: string;
  private readonly stalls = new Map<string, number>();
  private readonly unsubscribe: () => void;
  private prunedDay = "";
  private ingestDay = "";
  private readonly ingestCounts = new Map<string, { clamped: number; refused: number }>();

  constructor(private readonly d: AgentUsageDeps) {
    this.store = new AgentUsageStore(d.db);
    this.ingest = new UsageIngest(this.store, () =>
      readMarks(d.settings.get<unknown>(BASELINES_KEY, {})),
    );
    this.now = d.now ?? Date.now;
    this.timeZone = assertTimeZone(d.timeZone ?? systemTimeZone());
    this.unsubscribe = d.bus.subscribe("mission-stalls", [STALL_EVENT], (event) =>
      this.onStall(event),
    );
  }

  close(): void {
    this.unsubscribe();
  }

  // ── Ingest ────────────────────────────────────────────────────────────────

  /**
   * One token/cost report from an agent. `projectOf` names the project of a session Core already
   * knows from its steps (a folder name). Returns how many reports were accepted (always 1).
   */
  recordTokens(
    body: unknown,
    projectOf: (agent: string, sessionId: string) => string,
  ): { accepted: number } {
    if (this.d.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const result = validateTokenUsage(body);
    if (!result.ok)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid request", result.problems);
    const { report } = result;
    const atMs = this.now();
    const day = dayKeyOf(atMs, this.timeZone);
    this.prune(day);
    let outcome;
    try {
      outcome = this.ingest.record(report, {
        atMs,
        timeZone: this.timeZone,
        prices: readPrices(this.d.settings.get<unknown>(PRICES_KEY, {})),
        aiPrices: this.d.aiPrices(),
        projectFallback: projectOf(report.agent, report.session_id),
      });
    } catch (err) {
      // A new session, model or agent past a daily limit: counted so the page can say so.
      if (err instanceof PhoenixError) this.count(day, report.agent, "refused");
      throw err;
    }
    if (outcome.clamped) {
      this.count(day, report.agent, "clamped");
      this.d.logger.warn("agent usage report was cut to a limit", { agent: report.agent });
    }
    if (outcome.stored) this.checkBudgets(day, report.agent, report.session_id);
    return { accepted: 1 };
  }

  // ── What the limits did today ─────────────────────────────────────────────

  /** Counts a report that a limit cut or refused. In memory, one day at a time. */
  private count(day: string, agent: string, kind: "clamped" | "refused"): void {
    if (this.ingestDay !== day) {
      this.ingestDay = day;
      this.ingestCounts.clear();
    }
    let entry = this.ingestCounts.get(agent);
    if (!entry) {
      if (this.ingestCounts.size >= MAX_COUNTED_AGENTS) return;
      this.ingestCounts.set(agent, (entry = { clamped: 0, refused: 0 }));
    }
    entry[kind] += 1;
  }

  private ingestView(today: string): MissionIngestView {
    const by = this.ingestDay === today ? [...this.ingestCounts] : [];
    return {
      day: today,
      clamped: by.reduce((n, [, c]) => n + c.clamped, 0),
      refused: by.reduce((n, [, c]) => n + c.refused, 0),
      by_agent: by
        .map(([agent, c]) => ({ agent, ...c }))
        .sort((a, b) => a.agent.localeCompare(b.agent)),
    };
  }

  private prune(day: string): void {
    if (this.prunedDay === day) return;
    this.prunedDay = day;
    try {
      this.store.deleteBefore(addDays(day, -USAGE_KEEP_DAYS));
    } catch (err) {
      this.d.logger.warn("agent usage: could not prune old rows", {
        error: (err as Error).message,
      });
    }
  }

  // ── Budgets ───────────────────────────────────────────────────────────────

  private thresholds(): number[] {
    return (
      parseThresholds(this.d.settings.get<unknown>(THRESHOLDS_KEY, null)) ?? [...DEFAULT_THRESHOLDS]
    );
  }

  /** What a budget counts now, and how many rows of that sum have tokens but no known cost. */
  private usedBy(
    budget: MissionBudgetView,
    day: string,
    agent: string,
    sessionId: string,
  ): { used: number | null; unpriced: number } {
    const totals =
      budget.scope === "daily"
        ? this.store.dayTotals(day, budget.agent)
        : this.store.sessionTotals(agent, sessionId);
    if (budget.metric === "tokens")
      return { used: totals.input_tokens + totals.output_tokens, unpriced: 0 };
    return {
      used: totals.cost_micro === null ? null : totals.cost_micro / MICRO,
      unpriced: totals.unpriced_rows,
    };
  }

  /** Warns once per budget (and session, for session budgets) per threshold per day, before the limit. */
  private checkBudgets(day: string, agent: string, sessionId: string): void {
    const budgets = readBudgets(this.d.settings.get<unknown>(BUDGETS_KEY, []));
    if (budgets.length === 0) return;
    const thresholds = this.thresholds();
    const highest = thresholds[thresholds.length - 1];
    const stored = this.d.settings.get<FiredState>(BUDGET_FIRED_KEY, {});
    // Markers of today and yesterday are kept (a restart just after midnight must not re-alert);
    // older days are dropped.
    const oldest = addDays(day, -1);
    const fired: FiredState = Object.fromEntries(
      Object.entries(stored).filter(([key]) => key.slice(0, 10) >= oldest),
    );
    let changed = Object.keys(fired).length !== Object.keys(stored).length;
    for (const budget of budgets) {
      if (budget.agent !== undefined && budget.agent !== agent) continue;
      const { used } = this.usedBy(budget, day, agent, sessionId);
      if (used === null) continue;
      const pct = (used / budget.limit) * 100;
      const key =
        budget.scope === "daily"
          ? `${day}|${budget.id}`
          : `${day}|${budget.id}|${agent}:${sessionId}`;
      const done = fired[key] ?? [];
      const crossed = thresholds.filter((t) => pct >= t && !done.includes(t));
      const top = crossed[crossed.length - 1];
      if (top === undefined) continue;
      fired[key] = [...done, ...crossed];
      changed = true;
      const result = this.d.bus.publish(
        createEvent({
          event_type: "agent.usage.warning",
          source: "core",
          severity: thresholds.length > 1 && top === highest ? "error" : "warning",
          subject: `${budget.agent ?? "all agents"} ${budget.scope} ${budget.metric} budget`,
          payload: {
            agent: budget.agent ?? "all agents",
            window: `${budget.scope} ${budget.metric} budget`,
            threshold: top,
            used_pct: Math.round(pct * 10) / 10,
            budget_id: budget.id,
            scope: budget.scope,
            metric: budget.metric,
            // The day ends here (UTC midnight of the next local day is close enough to label it).
            resets_at: new Date(Date.parse(`${addDays(day, 1)}T00:00:00Z`)).toISOString(),
          },
        }),
      );
      if (!result.ok)
        this.d.logger.warn("agent budget warning rejected", { code: result.error.code });
    }
    if (changed) {
      // Oldest DAY first (stable: insertion order only within a day), so the cap never drops
      // today's markers for yesterday's.
      const keys = Object.keys(fired).sort((a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)));
      if (keys.length > MAX_FIRED)
        for (const key of keys.slice(0, keys.length - MAX_FIRED)) delete fired[key];
      this.d.settings.set(BUDGET_FIRED_KEY, fired);
    }
  }

  // ── Stall flags from Phase 77 ─────────────────────────────────────────────

  private onStall(event: PhoenixEvent): void {
    if (event.source !== "core") return;
    const { agent, session_id: sessionId } = event.payload;
    if (typeof agent !== "string" || typeof sessionId !== "string") return;
    const key = `${agent}:${sessionId}`;
    this.stalls.delete(key);
    this.stalls.set(key, Date.parse(event.timestamp) || this.now());
    if (this.stalls.size > MAX_STALLS) this.stalls.delete(this.stalls.keys().next().value!);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async mission(days: number | undefined): Promise<MissionView> {
    const span = days ?? DEFAULT_DAYS;
    if (!Number.isInteger(span) || span < 1 || span > MAX_DAYS)
      throw invalid(`"days" must be a whole number from 1 to ${MAX_DAYS}`);
    const nowMs = this.now();
    const today = dayKeyOf(nowMs, this.timeZone);
    const from = addDays(today, -(span - 1));
    const dayList = Array.from({ length: span }, (_, i) => addDays(from, i));
    const rows = this.store.range(from, today);
    const stuckAfterMin = readStuckAfter(this.d.settings.get<unknown>(STUCK_KEY, null));

    let reports: ActiveAgent[] = [];
    let orchestrated: SessionView[] = [];
    let reported = true;
    let orchestratedOk = true;
    try {
      reports = await this.d.agents.reports();
    } catch {
      reported = false;
    }
    try {
      orchestrated = await this.d.agents.orchestrated();
    } catch {
      orchestratedOk = false;
    }

    const sessions = buildBoard({
      nowMs,
      stuckAfterMin,
      live: this.d.liveSessions(),
      reports,
      orchestrated,
      stalls: this.stalls,
      usageOf: (agent, id) => viewOfTotals(this.store.sessionTotals(agent, id)),
    });

    const total = fresh();
    const byDay = new Map<string, Acc>(dayList.map((day) => [day, fresh()]));
    const byAgent = new Map<string, Acc>();
    const byProject = new Map<string, Acc>();
    const bySession = new Map<
      string,
      { acc: Acc; agent: string; id: string; project: string; models: Set<string> }
    >();
    const unpriced = new Set<string>();
    const slot = <K>(map: Map<K, Acc>, key: K): Acc => {
      let acc = map.get(key);
      if (!acc) map.set(key, (acc = fresh()));
      return acc;
    };
    for (const row of rows) {
      addRow(total, row);
      addRow(slot(byDay, row.day), row);
      addRow(slot(byAgent, row.agent), row);
      addRow(slot(byProject, row.project), row);
      const key = `${row.agent}:${row.session_id}`;
      let s = bySession.get(key);
      if (!s) {
        s = { acc: fresh(), agent: row.agent, id: row.session_id, project: "", models: new Set() };
        bySession.set(key, s);
      }
      addRow(s.acc, row);
      s.models.add(row.model);
      if (row.project) s.project = row.project;
      if (row.cost_micro === null && row.input_tokens + row.output_tokens > 0 && row.model !== "")
        unpriced.add(row.model);
    }
    const heaviest = (a: Acc, b: Acc) =>
      (b.micro ?? 0) - (a.micro ?? 0) || b.input + b.output - (a.input + a.output);

    const statuses = this.budgetStatuses(today);
    return {
      generated_at: new Date(nowMs).toISOString(),
      days: dayList,
      stuck_after_min: stuckAfterMin,
      sources: { reported, orchestrated: orchestratedOk },
      sessions,
      totals: view(total),
      by_day: dayList.map((day) => ({ day, ...view(byDay.get(day)!) })),
      by_agent: [...byAgent]
        .sort(([, a], [, b]) => heaviest(a, b))
        .map(([agent, acc]) => ({ agent, ...view(acc) })),
      by_project: [...byProject]
        .sort(([, a], [, b]) => heaviest(a, b))
        .map(([project, acc]) => ({ project, ...view(acc) })),
      by_session: [...bySession.values()]
        .sort((a, b) => heaviest(a.acc, b.acc))
        .slice(0, 200)
        .map((s) => ({
          agent: s.agent,
          session_id: s.id,
          project: s.project,
          models: s.models.size,
          ...view(s.acc),
        })),
      unpriced_models: [...unpriced].sort(),
      budgets: statuses,
      ingest: this.ingestView(today),
      thresholds: this.thresholds(),
    };
  }

  /** Where each budget stands now: today's sum (daily) or the heaviest session's (session). */
  private budgetStatuses(day: string): MissionBudgetStatusView[] {
    const budgets = readBudgets(this.d.settings.get<unknown>(BUDGETS_KEY, []));
    const rows = budgets.some((b) => b.scope === "session") ? this.store.range(day, day) : [];
    return budgets.map((budget) => {
      let used: number | null;
      let unpriced = 0;
      if (budget.scope === "daily") {
        ({ used, unpriced } = this.usedBy(budget, day, "", ""));
      } else {
        // Largest session among today's sessions of the agent the budget names.
        used = null;
        const seen = new Set<string>();
        for (const row of rows) {
          if (budget.agent !== undefined && row.agent !== budget.agent) continue;
          const key = `${row.agent}:${row.session_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const value = this.usedBy(budget, day, row.agent, row.session_id);
          if (value.used !== null && (used === null || value.used > used)) {
            used = value.used;
            unpriced = value.unpriced;
          }
        }
        if (used === null && budget.metric === "tokens") used = 0;
      }
      return {
        ...budget,
        used,
        pct: used === null ? null : Math.round((used / budget.limit) * 1000) / 10,
        // Usage without a known cost is not in `used`: a cost budget then shows "at least".
        unpriced_rows: unpriced,
      };
    });
  }

  config(): MissionConfigView {
    const aiModels = new Set<string>();
    for (const key of Object.keys(this.d.aiPrices())) {
      const colon = key.indexOf(":");
      if (colon >= 0) aiModels.add(key.slice(colon + 1));
    }
    return {
      budgets: readBudgets(this.d.settings.get<unknown>(BUDGETS_KEY, [])),
      prices: { ...readPrices(this.d.settings.get<unknown>(PRICES_KEY, {})) },
      ai_price_models: [...aiModels].sort(),
      stuck_after_min: readStuckAfter(this.d.settings.get<unknown>(STUCK_KEY, null)),
      thresholds: this.thresholds(),
    };
  }

  setConfig(body: unknown): MissionConfigView {
    if (typeof body !== "object" || body === null || Array.isArray(body))
      throw invalid("The settings must be an object");
    const input: Record<string, unknown> = { ...body };
    for (const key of Object.keys(input))
      if (!["budgets", "prices", "stuck_after_min"].includes(key))
        throw invalid(`Unknown setting "${key.slice(0, 40)}"`);
    // Everything is checked before anything is written.
    const budgets = input.budgets === undefined ? undefined : parseBudgets(input.budgets);
    const prices = input.prices === undefined ? undefined : parsePrices(input.prices);
    const stuck =
      input.stuck_after_min === undefined ? undefined : parseStuckAfter(input.stuck_after_min);
    if (budgets) this.d.settings.set(BUDGETS_KEY, budgets);
    if (prices) this.d.settings.set(PRICES_KEY, prices);
    if (stuck !== undefined) this.d.settings.set(STUCK_KEY, stuck);
    this.d.audit.record({
      actor: "user",
      action: "agent_usage.config.changed",
      decision: "info",
      details: {
        budgets: budgets?.length,
        prices: prices ? Object.keys(prices).length : undefined,
        stuck_after_min: stuck,
      },
    });
    return this.config();
  }

  deleteAll(): { deleted: number } {
    // The baselines go to disk BEFORE the rows they are rebuilt from are wiped: a report that
    // repeats an already-counted running total after a restart (or after the in-memory entry was
    // evicted) then adds only the difference, so a delete is not undone by the next report.
    this.d.settings.set(BASELINES_KEY, this.ingest.snapshotMarks());
    const deleted = this.store.deleteAll();
    this.d.settings.delete(BUDGET_FIRED_KEY);
    this.ingestDay = "";
    this.ingestCounts.clear();
    let warningsDeleted = 0;
    try {
      // Budget warnings carry a `budget_id`; the plan-usage warnings of AgentLive do not and stay.
      warningsDeleted =
        this.d.events?.deleteByTypeWithPayloadKey("agent.usage.warning", "budget_id") ?? 0;
    } catch (err) {
      this.d.logger.warn("agent usage: could not delete budget warning events", {
        error: (err as Error).message,
      });
    }
    void this.d.audit.record({
      actor: "user",
      action: "agent_usage.delete",
      decision: "info",
      details: { deleted, budget_warnings_deleted: warningsDeleted },
    });
    return { deleted };
  }
}
