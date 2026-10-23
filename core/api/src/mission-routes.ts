// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, intParam, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** Where a session sits on the board; the mapping is documented in docs/mission-control.md. */
export type MissionState = "working" | "waiting" | "finished" | "stuck";
export type MissionSource = "report" | "steps" | "orchestrated";

/**
 * Sums of what agents REPORTED. `cost_usd` is null when no row of the sum has a known cost:
 * unknown is never shown as zero. `cost_partial` is true when some of the usage has no known cost,
 * so the cost shown is a lower bound.
 */
export interface MissionTotalsView {
  input_tokens: number;
  output_tokens: number;
  /** False when the agent reported no token counts (a cost only): the two token numbers are then not data. */
  tokens_reported: boolean;
  cost_usd: number | null;
  cost_partial: boolean;
}

export interface MissionSessionView {
  /** `<agent>:<id>`, unique on the board. */
  key: string;
  id: string;
  agent: string;
  /** A folder NAME, never a path. */
  project: string;
  state: MissionState;
  /** The state the source reported (`working`, `running`, `completed`, ...). */
  raw_state: string;
  reason?: "permission" | "input" | "idle";
  /** Why a stuck session is stuck. */
  stuck_reason?: "no_report" | "safety_stall";
  sources: MissionSource[];
  first_seen?: string;
  last_seen?: string;
  steps?: number;
  /** `#/agents/:id` can show it (Core holds its steps or it is an orchestrated session). */
  can_open: boolean;
  /** Core knows the agent's terminal window. */
  can_focus: boolean;
  usage: MissionTotalsView;
}

export interface MissionBudgetView {
  id: string;
  scope: "daily" | "session";
  metric: "tokens" | "cost";
  /** Tokens, or US dollars. */
  limit: number;
  /** Absent = all agents. */
  agent?: string;
}

export interface MissionBudgetStatusView extends MissionBudgetView {
  /** Now: today's sum (daily) or the largest session's (session). Null when the cost is unknown. */
  used: number | null;
  pct: number | null;
  /**
   * Rows of that sum with tokens but no known cost. Above zero, a cost budget's `used` is a lower
   * bound ("at least"): the unpriced usage is not in it. Always 0 for a token budget.
   */
  unpriced_rows: number;
}

/** What the ingest limits did today (in memory: a restart starts the count again). */
export interface MissionIngestView {
  day: string;
  /** Reports whose numbers were cut to a per-report, per-session, per-agent or per-day limit. */
  clamped: number;
  /** Reports refused for a limit (too many sessions, agents or models in a day). */
  refused: number;
  by_agent: { agent: string; clamped: number; refused: number }[];
}

export interface MissionPriceView {
  input_per_mtok: number;
  output_per_mtok: number;
}

export interface MissionView {
  generated_at: string;
  /** Local days of the usage window, oldest first. */
  days: string[];
  stuck_after_min: number;
  /** false = that source could not be read now (capability off or failing); the board is partial. */
  sources: { reported: boolean; orchestrated: boolean };
  sessions: MissionSessionView[];
  totals: MissionTotalsView;
  by_day: (MissionTotalsView & { day: string })[];
  by_agent: (MissionTotalsView & { agent: string })[];
  by_project: (MissionTotalsView & { project: string })[];
  by_session: (MissionTotalsView & {
    agent: string;
    session_id: string;
    project: string;
    models: number;
  })[];
  /** Models with reported tokens but no price: their cost is unknown. */
  unpriced_models: string[];
  budgets: MissionBudgetStatusView[];
  ingest: MissionIngestView;
  thresholds: number[];
}

export interface MissionConfigView {
  budgets: MissionBudgetView[];
  /** The user's prices for agents, keyed by the model id the agent reports. */
  prices: Record<string, MissionPriceView>;
  /** Model ids that also have a price in the AI settings (`<provider>:<model>` keys), used when no own price is set. */
  ai_price_models: string[];
  stuck_after_min: number;
  /** Days of usage rows kept (7-3650, default 400); older rows are dropped on the next report or at start. */
  keep_days: number;
  thresholds: number[];
}

/** Mission control: the board of all agent sessions, what they cost, budgets. Errors are PhoenixErrors. */
export interface MissionApi {
  /** `days` (1-90, default 14): the usage window ending today (local days). */
  mission(days: number | undefined): Promise<MissionView>;
  config(): MissionConfigView;
  /** Replaces whichever of `budgets`, `prices`, `stuck_after_min`, `keep_days` the body holds. */
  setConfig(body: unknown): MissionConfigView;
  deleteAll(): { deleted: number };
}

export function missionRoutes(s: CoreServices): Route[] {
  const mission = () => {
    if (!s.mission)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Mission control is unavailable");
    return s.mission;
  };
  const only = (url: URL, allowed: readonly string[]) => {
    for (const key of url.searchParams.keys())
      if (!allowed.includes(key))
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          `Unknown parameter "${key.slice(0, 40)}"`,
        );
  };
  return [
    route("GET", "/api/mission", ({ url }) => {
      only(url, ["days"]);
      return mission().mission(intParam(url, "days"));
    }),
    route("GET", "/api/mission/config", () => mission().config()),
    route("POST", "/api/mission/config", async ({ body }) =>
      mission().setConfig(expectObject(await body())),
    ),
    route("DELETE", "/api/mission/usage", ({ url }) => {
      only(url, ["confirm"]);
      if (url.searchParams.get("confirm") !== "true")
        throw new PhoenixError(
          ErrorCode.ACTION_REQUIRES_CONFIRMATION,
          "Deleting agent usage needs ?confirm=true",
        );
      return mission().deleteAll();
    }),
  ];
}
