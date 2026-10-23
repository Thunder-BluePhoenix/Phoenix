// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Wire types of GET /api/mission (see core/api/src/mission-routes.ts) and the pure helpers the
// mission-control page uses: client-side filtering and search, and number formatting. Costs are
// `null` when unknown; the helpers never turn that into a zero.
import { formatNumber, translated } from "./format";

export type MissionState = "working" | "waiting" | "finished" | "stuck";
export const MISSION_STATES: readonly MissionState[] = ["waiting", "stuck", "working", "finished"];

export interface MissionTotals {
  input_tokens: number;
  output_tokens: number;
  tokens_reported: boolean;
  cost_usd: number | null;
  cost_partial: boolean;
}

export interface MissionSession {
  key: string;
  id: string;
  agent: string;
  project: string;
  state: MissionState;
  raw_state: string;
  reason?: "permission" | "input" | "idle";
  stuck_reason?: "no_report" | "safety_stall";
  sources: ("report" | "steps" | "orchestrated")[];
  first_seen?: string;
  last_seen?: string;
  steps?: number;
  can_open: boolean;
  can_focus: boolean;
  usage: MissionTotals;
}

export interface MissionBudget {
  id: string;
  scope: "daily" | "session";
  metric: "tokens" | "cost";
  limit: number;
  agent?: string;
}

/** A budget as sent to Core: without an id Core makes one. */
export type MissionBudgetInput = Omit<MissionBudget, "id"> & { id?: string };

export interface MissionBudgetStatus extends MissionBudget {
  used: number | null;
  pct: number | null;
  /** Rows of the sum with tokens but no known cost: above 0, a cost `used` is "at least". */
  unpriced_rows: number;
}

/** What Core's limits did today with agents' reports. */
export interface MissionIngest {
  day: string;
  clamped: number;
  refused: number;
  by_agent: { agent: string; clamped: number; refused: number }[];
}

export interface MissionPrice {
  input_per_mtok: number;
  output_per_mtok: number;
}

export interface Mission {
  generated_at: string;
  days: string[];
  stuck_after_min: number;
  sources: { reported: boolean; orchestrated: boolean };
  sessions: MissionSession[];
  totals: MissionTotals;
  by_day: (MissionTotals & { day: string })[];
  by_agent: (MissionTotals & { agent: string })[];
  by_project: (MissionTotals & { project: string })[];
  by_session: (MissionTotals & {
    agent: string;
    session_id: string;
    project: string;
    models: number;
  })[];
  unpriced_models: string[];
  budgets: MissionBudgetStatus[];
  ingest: MissionIngest;
  thresholds: number[];
}

/** What POST /api/mission/config takes; each part is optional. */
export interface MissionConfigUpdate {
  budgets?: MissionBudgetInput[];
  prices?: Record<string, MissionPrice>;
  stuck_after_min?: number;
  keep_days?: number;
}

export interface MissionConfig {
  budgets: MissionBudget[];
  prices: Record<string, MissionPrice>;
  ai_price_models: string[];
  stuck_after_min: number;
  keep_days: number;
  thresholds: number[];
}

export const STATE_TEXT = translated({
  working: "mission.state.working",
  waiting: "mission.state.waiting",
  finished: "mission.state.finished",
  stuck: "mission.state.stuck",
});

export const REASON_TEXT = translated({
  permission: "mission.reason.permission",
  input: "mission.reason.input",
  idle: "mission.reason.idle",
});

export const STUCK_REASON_TEXT = translated({
  no_report: "mission.stuck.noReport",
  safety_stall: "mission.stuck.safetyStall",
});

export interface BoardFilter {
  query: string;
  agent: string;
  project: string;
  state: MissionState | "";
}

export const NO_FILTER: BoardFilter = { query: "", agent: "", project: "", state: "" };

/** Case-insensitive search over the agent, project and id of a session; all words must match. */
export function filterSessions(
  sessions: readonly MissionSession[],
  filter: BoardFilter,
): MissionSession[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((s) => {
    if (filter.agent && s.agent !== filter.agent) return false;
    if (filter.project && s.project !== filter.project) return false;
    if (filter.state && s.state !== filter.state) return false;
    const haystack = `${s.agent} ${s.project} ${s.id}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** Distinct non-empty values, sorted, for a filter's choices. */
export function distinct(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v !== ""))].sort((a, b) => a.localeCompare(b));
}

export const formatTokens = (n: number): string => formatNumber(n);

const USD: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
};

/** "$1.50", or null when the cost is unknown (the caller shows the words for "unknown"). */
export const formatUsd = (usd: number | null): string | null =>
  usd === null ? null : formatNumber(usd, undefined, USD);
