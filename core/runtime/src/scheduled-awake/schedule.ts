// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Schedule windows: validation, expansion into concrete instants, and the merge rule. Pure; no
// clock, no timers, no OS. The input may come from a person, a stored file or a phone, so every
// field is checked and unknown fields are refused.
import { AwakeError, parseLabel } from "@phoenix/capability-awake";
import {
  MINUTE_MS,
  addDays,
  formatDate,
  isValidTimeZone,
  localParts,
  parseClockTime,
  parseDate,
  zonedToEpoch,
  type LocalDate,
} from "./time";

export const MAX_SCHEDULES = 16;
export const MIN_WINDOW_MINUTES = 5;
/** One window is at most 12 hours of wall-clock time (23:00-07:00 is 8). */
export const MAX_WINDOW_MINUTES = 12 * 60;
export const DEFAULT_MIN_BATTERY_PERCENT = 20;
export const MIN_BATTERY_PERCENT = 5;
export const MAX_BATTERY_PERCENT = 90;
/** How far ahead windows are expanded; also bounds how long a merged chain can run. */
export const PLAN_HORIZON_DAYS = 8;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type Recurrence =
  /** `days` are weekdays of the local date the window STARTS on: 0 = Sunday .. 6 = Saturday. */
  { kind: "weekly"; days: number[] } | { kind: "once"; date: string };

export interface PowerPolicy {
  /** Hold only on mains power (or a machine with no battery). */
  requireCharger: boolean;
  /** On battery, hold only while the level is at or above this. */
  minBatteryPercent: number;
  /** Hold while Low Power Mode is on. Default false: low power mode means "save energy". */
  allowLowPowerMode: boolean;
}

export interface ScheduleSpec {
  id: string;
  label: string | undefined;
  enabled: boolean;
  timeZone: string;
  /** `HH:MM`, 24 hour, in `timeZone`. */
  start: string;
  /** `HH:MM`; earlier than or equal to `start` means the window ends the next day. */
  end: string;
  recurrence: Recurrence;
  /** Ask the OS to wake the machine shortly before each window (needs a `WakeScheduler`). */
  wake: boolean;
  power: PowerPolicy;
}

/** One concrete occurrence of a schedule. `key` names it for skips: `<schedule id>@<start date>`. */
export interface ScheduleWindow {
  key: string;
  scheduleId: string;
  startsAt: number;
  endsAt: number;
}

export interface MergedWindow {
  startsAt: number;
  endsAt: number;
  scheduleIds: string[];
  keys: string[];
}

const SPEC_FIELDS = new Set([
  "id",
  "label",
  "enabled",
  "timeZone",
  "start",
  "end",
  "days",
  "date",
  "wake",
  "requireCharger",
  "minBatteryPercent",
  "allowLowPowerMode",
]);

function invalid(message: string): AwakeError {
  return new AwakeError("invalid", message);
}

function bool(raw: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw invalid(`${field} must be true or false`);
  return value;
}

export function isScheduleId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Minutes of wall-clock time between two `HH:MM` values; an end at or before the start is next day. */
export function nominalMinutes(start: string, end: string): number {
  const s = parseClockTime(start) ?? 0;
  const e = parseClockTime(end) ?? 0;
  return e > s ? e - s : e + 1440 - s;
}

/**
 * Checks untrusted input and returns a schedule. Throws `AwakeError("invalid")` with a message that never echoes the offending text back.
 */
export function parseScheduleInput(input: unknown): ScheduleSpec {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalid("A schedule must be an object");
  }
  const raw = Object.fromEntries(Object.entries(input));
  for (const key of Object.keys(raw)) {
    if (!SPEC_FIELDS.has(key)) throw invalid("A schedule has a field that is not recognised");
  }
  const id = raw.id;
  if (!isScheduleId(id)) {
    throw invalid("id must be 1 to 40 lowercase letters, digits or dashes");
  }
  const timeZone = raw.timeZone;
  if (!isValidTimeZone(timeZone)) throw invalid("timeZone must be an IANA time zone name");
  const start = raw.start;
  const end = raw.end;
  if (parseClockTime(start) === undefined) throw invalid("start must be HH:MM (24 hour)");
  if (parseClockTime(end) === undefined) throw invalid("end must be HH:MM (24 hour)");
  if (typeof start !== "string" || typeof end !== "string" || start === end) {
    throw invalid("start and end must differ");
  }
  const minutes = nominalMinutes(start, end);
  if (minutes < MIN_WINDOW_MINUTES || minutes > MAX_WINDOW_MINUTES) {
    throw invalid(`A window must last ${MIN_WINDOW_MINUTES} to ${MAX_WINDOW_MINUTES} minutes`);
  }
  let recurrence: Recurrence;
  if (raw.days !== undefined && raw.date !== undefined) {
    throw invalid("Give days (repeating) or date (once), not both");
  } else if (raw.date !== undefined) {
    if (parseDate(raw.date) === undefined) throw invalid("date must be a real day, YYYY-MM-DD");
    recurrence = { kind: "once", date: String(raw.date) };
  } else {
    const days = raw.days;
    if (!Array.isArray(days) || days.length === 0 || days.length > 7) {
      throw invalid("days must list 1 to 7 weekdays (0 = Sunday .. 6 = Saturday)");
    }
    const seen = new Set<number>();
    for (const day of days) {
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
        throw invalid("days must list weekdays 0 (Sunday) to 6 (Saturday)");
      }
      seen.add(day);
    }
    recurrence = { kind: "weekly", days: [...seen].sort((a, b) => a - b) };
  }
  const minBattery = raw.minBatteryPercent ?? DEFAULT_MIN_BATTERY_PERCENT;
  if (
    typeof minBattery !== "number" ||
    !Number.isInteger(minBattery) ||
    minBattery < MIN_BATTERY_PERCENT ||
    minBattery > MAX_BATTERY_PERCENT
  ) {
    throw invalid(
      `minBatteryPercent must be a whole number from ${MIN_BATTERY_PERCENT} to ${MAX_BATTERY_PERCENT}`,
    );
  }
  return {
    id,
    label: parseLabel(raw.label),
    enabled: bool(raw, "enabled", true),
    timeZone,
    start,
    end,
    recurrence,
    wake: bool(raw, "wake", false),
    power: {
      requireCharger: bool(raw, "requireCharger", false),
      minBatteryPercent: minBattery,
      allowLowPowerMode: bool(raw, "allowLowPowerMode", false),
    },
  };
}

/** The flat input shape `parseScheduleInput` accepts, for storing a schedule. */
export function scheduleToInput(spec: ScheduleSpec): Record<string, unknown> {
  return {
    id: spec.id,
    ...(spec.label === undefined ? {} : { label: spec.label }),
    enabled: spec.enabled,
    timeZone: spec.timeZone,
    start: spec.start,
    end: spec.end,
    ...(spec.recurrence.kind === "weekly"
      ? { days: spec.recurrence.days }
      : { date: spec.recurrence.date }),
    wake: spec.wake,
    requireCharger: spec.power.requireCharger,
    minBatteryPercent: spec.power.minBatteryPercent,
    allowLowPowerMode: spec.power.allowLowPowerMode,
  };
}

function matches(recurrence: Recurrence, date: LocalDate, weekday: number): boolean {
  return recurrence.kind === "weekly"
    ? recurrence.days.includes(weekday)
    : recurrence.date === formatDate(date);
}

/**
 * Every occurrence that overlaps [from, to), in start order. Times are resolved per date in the
 * schedule's own zone, so a 23:00 window stays at 23:00 local across a DST change and its real
 * length is the elapsed time between the two local readings (7 or 9 hours on a clock-change night,
 * not a fixed count of minutes).
 */
export function occurrencesOf(spec: ScheduleSpec, from: number, to: number): ScheduleWindow[] {
  const startClock = parseClockTime(spec.start) ?? 0;
  const endClock = parseClockTime(spec.end) ?? 0;
  const overnight = endClock <= startClock;
  const first = localParts(spec.timeZone, from);
  const out: ScheduleWindow[] = [];
  // A window that began up to a day before `from` can still be running; one that starts after
  // `to` is irrelevant. Dates are local to the zone, so pad both ends by a day.
  const last = localParts(spec.timeZone, to);
  let date: LocalDate = addDays(first, -2);
  const stop = formatDate(addDays(last, 1));
  while (formatDate(date) <= stop) {
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    if (matches(spec.recurrence, date, weekday)) {
      const startsAt = zonedToEpoch(
        spec.timeZone,
        date,
        Math.floor(startClock / 60),
        startClock % 60,
      );
      const endDate = overnight ? addDays(date, 1) : date;
      const endsAt = zonedToEpoch(spec.timeZone, endDate, Math.floor(endClock / 60), endClock % 60);
      if (endsAt > startsAt && endsAt > from && startsAt < to) {
        out.push({
          key: `${spec.id}@${formatDate(date)}`,
          scheduleId: spec.id,
          startsAt,
          endsAt,
        });
      }
    }
    date = addDays(date, 1);
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Merge rule: windows that overlap OR touch (one ends the instant another starts) become one
 * continuous window, so the machine is held once and never released between them. The merged
 * window lists every schedule and occurrence that contributed.
 */
export function mergeWindows(windows: readonly ScheduleWindow[]): MergedWindow[] {
  const sorted = [...windows].sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt);
  const merged: MergedWindow[] = [];
  for (const w of sorted) {
    const tail = merged.at(-1);
    if (tail && w.startsAt <= tail.endsAt) {
      tail.endsAt = Math.max(tail.endsAt, w.endsAt);
      if (!tail.scheduleIds.includes(w.scheduleId)) tail.scheduleIds.push(w.scheduleId);
      tail.keys.push(w.key);
    } else {
      merged.push({
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        scheduleIds: [w.scheduleId],
        keys: [w.key],
      });
    }
  }
  return merged;
}

export function minutesBetween(from: number, to: number): number {
  return Math.ceil((to - from) / MINUTE_MS);
}
