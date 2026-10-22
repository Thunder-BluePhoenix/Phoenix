// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Local wall-clock time in an IANA zone, without a date library. A schedule says "23:00" in a
// zone; the instant that means depends on that zone's rules on that date. The two awkward cases:
//  - a time that does not exist (spring forward, 02:30 when 02:00 jumps to 03:00) resolves to the
//    same wall-clock reading after the gap (03:30), by applying the offset that was in force before;
//  - a time that happens twice (fall back, 01:30 twice) resolves to the first, earlier instant.
// Nothing here reads the system clock or the system zone: every function takes its instant.

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalParts extends LocalDate {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday .. 6 = Saturday, the weekday of `year-month-day` in the zone. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  formatters.set(timeZone, made);
  return made;
}

/** True when the runtime's ICU knows the zone. Bounded length: the value is user supplied. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of an instant in a zone. */
export function localParts(timeZone: string, epochMs: number): LocalParts {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const year = fields.year ?? 1970;
  const month = fields.month ?? 1;
  const day = fields.day ?? 1;
  return {
    year,
    month,
    day,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
    second: fields.second ?? 0,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Zone offset from UTC in ms at an instant (positive east of Greenwich), to the second. */
export function offsetAt(timeZone: string, epochMs: number): number {
  const p = localParts(timeZone, epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * The instant for a wall-clock `hour:minute` on a local date. A gap resolves forward, an overlap
 * to the earlier instant (see the file header).
 */
export function zonedToEpoch(
  timeZone: string,
  date: LocalDate,
  hour: number,
  minute: number,
): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const before = offsetAt(timeZone, naive - DAY_MS);
  const after = offsetAt(timeZone, naive + DAY_MS);
  const valid: number[] = [];
  for (const offset of new Set([before, after])) {
    const candidate = naive - offset;
    if (offsetAt(timeZone, candidate) === offset) valid.push(candidate);
  }
  if (valid.length > 0) return Math.min(...valid);
  return naive - before;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

export function formatDate(date: LocalDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` of a real calendar day, else undefined. */
export function parseDate(text: unknown): LocalDate | undefined {
  if (typeof text !== "string") return undefined;
  const m = DATE_KEY.exec(text);
  if (!m) return undefined;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = addDays(date, 0);
  return check.year === date.year && check.month === date.month && check.day === date.day
    ? date
    : undefined;
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM` (24 hour) to minutes after midnight, else undefined. */
export function parseClockTime(text: unknown): number | undefined {
  if (typeof text !== "string") return undefined;
  const m = CLOCK_TIME.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}
