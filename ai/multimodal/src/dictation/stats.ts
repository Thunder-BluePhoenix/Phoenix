// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Dictation statistics. The model is AGGREGATES ONLY: one row per (day, app id) holding counts.
// No text, no audio, no timestamps finer than a day is ever part of a row, so there is nothing to
// leak and nothing to retain beyond what the user keeps. App identifiers are private to the user:
// the Core can delete every row on request.

/** What is stored: counts for one day and one app. `app` is "" when the app is not known. */
export interface StatsRow {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  app: string;
  words: number;
  speech_ms: number;
  sessions: number;
}

export interface TopApp {
  app: string;
  words: number;
  sessions: number;
}

export interface StatsSummary {
  words: number;
  sessions: number;
  speech_ms: number;
  /** Time it would have taken to type the same words at `typing_wpm`. */
  typing_ms: number;
  /** typing_ms - speech_ms, never below 0. */
  saved_ms: number;
  typing_wpm: number;
  /** Words per minute of speech; 0 when nothing has been dictated. */
  average_wpm: number;
  /** Consecutive local days with at least one dictation, ending today (or yesterday). */
  streak_days: number;
  top_apps: TopApp[];
}

export const TYPING_WPM = { min: 10, max: 200, default: 40 } as const;
export const TOP_APPS = 5;
export const MAX_APP_ID_CHARS = 100;
/** Distinct app ids kept; further apps count under "other" so the table cannot grow without bound. */
export const MAX_DISTINCT_APPS = 200;
export const OTHER_APP = "other";

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/** App identifier as the desktop reports it (a bundle id or an executable name). */
export function isAppId(value: unknown): boolean {
  return typeof value === "string" && value.length <= MAX_APP_ID_CHARS && APP_ID.test(value);
}

export function isDay(value: unknown): boolean {
  return typeof value === "string" && DAY.test(value);
}

/** The local calendar day of a timestamp, YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  // Noon avoids DST edge cases when stepping back one calendar day.
  return localDay(new Date(y, m - 1, d - 1, 12).getTime());
}

/** Consecutive days with words, counted back from today; a streak that ended yesterday still counts. */
export function streakDays(daysWithWords: readonly string[], today: string): number {
  const have: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const day of daysWithWords) have[day] = true;
  let cursor = Object.hasOwn(have, today) ? today : previousDay(today);
  let streak = 0;
  while (Object.hasOwn(have, cursor)) {
    streak++;
    cursor = previousDay(cursor);
  }
  return streak;
}

export function summarise(
  rows: readonly StatsRow[],
  typingWpm: number,
  today: string,
): StatsSummary {
  let words = 0;
  let sessions = 0;
  let speech = 0;
  const byApp: Record<string, TopApp> = Object.create(null) as Record<string, TopApp>;
  const days: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const row of rows) {
    words += row.words;
    sessions += row.sessions;
    speech += row.speech_ms;
    if (row.words > 0) days[row.day] = true;
    const entry = (byApp[row.app] ??= { app: row.app, words: 0, sessions: 0 });
    entry.words += row.words;
    entry.sessions += row.sessions;
  }
  const typing = Math.round((words / typingWpm) * 60_000);
  return {
    words,
    sessions,
    speech_ms: speech,
    typing_ms: typing,
    saved_ms: Math.max(0, typing - speech),
    typing_wpm: typingWpm,
    average_wpm: speech > 0 ? Math.round((words / (speech / 60_000)) * 10) / 10 : 0,
    streak_days: streakDays(Object.keys(days), today),
    top_apps: Object.values(byApp)
      .filter((a) => a.words > 0)
      .sort((a, b) => b.words - a.words || a.app.localeCompare(b.app))
      .slice(0, TOP_APPS),
  };
}
