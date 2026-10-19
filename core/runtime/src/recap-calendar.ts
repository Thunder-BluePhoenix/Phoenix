// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Calendar arithmetic for the weekly recap (Phase 69). A "day" is a local calendar date,
// YYYY-MM-DD, in an injectable IANA time zone; weeks start on Monday. Every step after turning an
// instant into its day key works on the date alone (via UTC midnight of that date), never on a
// number of milliseconds, so a 23- or 25-hour day around a DST change cannot shift a week boundary.

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone this process runs in (what "local" means when none is injected). */
export const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Throws RangeError for a name `Intl` does not know. */
export function assertTimeZone(timeZone: string): string {
  formatterFor(timeZone);
  return timeZone;
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The local calendar day an instant falls on in `timeZone`. */
export function dayKeyOf(ms: number, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(ms);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** True for a real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DAY_KEY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const utcOf = (day: string): number => {
  const m = DAY_KEY.exec(day)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** `day` shifted by whole calendar days (negative goes back). */
export function addDays(day: string, n: number): string {
  return new Date(utcOf(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of the week containing `day`. */
export function weekStartOf(day: string): string {
  const sinceMonday = (new Date(utcOf(day)).getUTCDay() + 6) % 7;
  return addDays(day, -sinceMonday);
}

/** The seven day keys of the week starting on `start`, Monday first. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * An ISO instant bounding every UTC time that can fall on local days `from`..`to` in any zone
 * (zones differ from UTC by at most 14 h): one whole day of margin on each side. Callers read a
 * little too much and then keep only rows whose own day key is in range.
 */
export function utcWindow(from: string, to: string): { since: string; until: string } {
  return {
    since: `${addDays(from, -1)}T00:00:00.000Z`,
    until: `${addDays(to, 2)}T00:00:00.000Z`,
  };
}
