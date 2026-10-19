// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, type Route } from "./http";
import type { CoreServices } from "./services";

/** A name with how many steps it accounts for (an agent id, or a project's folder name). */
export interface RecapRankView {
  name: string;
  steps: number;
}

export interface RecapDayView {
  day: string;
  steps: number;
  seconds: number;
  commits: number;
}

/** One column of the contribution grid: seven local days, Monday first. */
export interface RecapGridWeekView {
  start: string;
  days: { day: string; count: number }[];
}

/** Local commit counts (git.commit.created events); not a GitHub contribution calendar. */
export interface RecapGridView {
  weeks: RecapGridWeekView[];
  max: number;
  total: number;
  source: "local-git-events";
}

/** A week of the user's work, from numbers kept on this computer. No content, no file names. */
export interface RecapView {
  week: {
    start: string;
    end: string;
    days: string[];
    time_zone: string;
    /** The week that contains today. */
    current: boolean;
  };
  coding: {
    seconds: number;
    sessions: number;
    steps: number;
    files: number;
    lines_added: number;
    lines_removed: number;
    lines_changed: number;
    commands: number;
    longest_session_seconds: number;
  };
  permissions: { granted: number; denied: number };
  top_agent: RecapRankView | null;
  top_project: RecapRankView | null;
  busiest_day: { day: string; steps: number; seconds: number } | null;
  days: RecapDayView[];
  commits: number;
  ci: { passed: number; failed: number };
  /** Null while sensitive meeting data is off: nothing meeting-derived is read then. */
  meetings: { count: number; decisions: number } | null;
  meetings_allowed: boolean;
  grid: RecapGridView;
}

/** The weekly recap as the API sees it. Errors are PhoenixErrors. */
export interface RecapApi {
  /** `week` is any local day (YYYY-MM-DD) of the wanted week; absent means this week. */
  recap(week: string | undefined): RecapView;
  deleteAll(): { deleted: number };
}

export function recapRoutes(s: CoreServices): Route[] {
  const recap = () => {
    if (!s.recap) throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Recap is unavailable");
    return s.recap;
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
    route("GET", "/api/recap", ({ url }) => {
      only(url, ["week"]);
      return recap().recap(url.searchParams.get("week") ?? undefined);
    }),
    route("DELETE", "/api/recap", ({ url }) => {
      only(url, ["confirm"]);
      if (url.searchParams.get("confirm") !== "true")
        throw new PhoenixError(
          ErrorCode.ACTION_REQUIRES_CONFIRMATION,
          "Deleting recap statistics needs ?confirm=true",
        );
      return recap().deleteAll();
    }),
  ];
}
