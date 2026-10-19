// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of GET /api/recap (see core/api/src/recap-routes.ts) and the small formatters the
// recap page and its share image use.

export interface RecapRank {
  name: string;
  steps: number;
}

export interface RecapGridWeek {
  start: string;
  days: { day: string; count: number }[];
}

export interface Recap {
  week: { start: string; end: string; days: string[]; time_zone: string; current: boolean };
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
  top_agent: RecapRank | null;
  top_project: RecapRank | null;
  busiest_day: { day: string; steps: number; seconds: number } | null;
  days: { day: string; steps: number; seconds: number; commits: number }[];
  commits: number;
  ci: { passed: number; failed: number };
  meetings: { count: number; decisions: number } | null;
  meetings_allowed: boolean;
  grid: {
    weeks: RecapGridWeek[];
    max: number;
    total: number;
    source: "local-git-events";
  };
}

/** "3 h 05 min", "42 min", "0 min": coding time at the precision a weekly number deserves. */
export function formatCodingTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Mon 12 Oct" from a YYYY-MM-DD key, without going through a time zone. */
export function formatDayKey(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${WEEKDAYS[(date.getUTCDay() + 6) % 7]} ${date.getUTCDate()} ${month}`;
}

/** The week as one phrase: "Mon 12 Oct – Sun 18 Oct". */
export function formatWeek(week: Pick<Recap["week"], "start" | "end">): string {
  return `${formatDayKey(week.start)} – ${formatDayKey(week.end)}`;
}

/** 0 (none) to 4 (most) for a contribution-grid cell. */
export function gridLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4;
}

/** True when the recap holds nothing for its week (an empty week shows a note, not zeros). */
export function isEmptyWeek(recap: Recap): boolean {
  const { coding, permissions, commits, ci, meetings } = recap;
  return (
    coding.steps === 0 &&
    coding.sessions === 0 &&
    permissions.granted + permissions.denied === 0 &&
    commits === 0 &&
    ci.passed + ci.failed === 0 &&
    (meetings?.count ?? 0) === 0
  );
}
