// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** The injected "now" and the user's time zone (IANA name, e.g. "Europe/Berlin"). */
export interface Clock {
  now(): Date;
  timeZone: string;
}

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

export interface TimeWindow {
  /** Inclusive (ISO, UTC). */
  from: string;
  /** Exclusive (ISO, UTC). */
  before: string;
  /** Human wording for answers: "yesterday", "last week", "the last 3 days". */
  label: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const WEEKDAY_PATTERN = WEEKDAYS.join("|");

export function weekdayIndex(name: string): number {
  return WEEKDAYS.indexOf(name.toLowerCase());
}

/** The calendar day an instant falls on in `timeZone`. */
export function calendarDay(instant: Date, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

/** Day of week (0 = Sunday) of a calendar day. */
export function dayOfWeek(d: CalendarDay): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function addDays(d: CalendarDay, n: number): CalendarDay {
  const moved = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** The instant a calendar day starts in `timeZone` (handles days with DST changes). */
export function startOfDay(d: CalendarDay, timeZone: string): Date {
  const guess = Date.UTC(d.year, d.month - 1, d.day);
  const first = offsetMs(guess, timeZone);
  let start = guess - first;
  const second = offsetMs(start, timeZone);
  if (second !== first) start = guess - second;
  return new Date(start);
}

/** [start of `from`, start of `before`) as a window. */
export function dayRange(
  from: CalendarDay,
  before: CalendarDay,
  timeZone: string,
  label: string,
): TimeWindow {
  return {
    from: startOfDay(from, timeZone).toISOString(),
    before: startOfDay(before, timeZone).toISOString(),
    label,
  };
}
