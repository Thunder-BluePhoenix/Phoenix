// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface CalendarEvent {
  /** Provider-qualified stable occurrence id (recurrence exceptions have their own id). */
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
  project?: string;
  url?: string;
  private: boolean;
  cancelled?: boolean;
  /** Only explicitly marked freeze events impose a deployment hold. */
  deployFreeze?: boolean;
}

/** Ordinary events longer than this are rejected; deploy-freeze holds may be arbitrarily long. */
const MAX_ORDINARY_MS = 31 * 86_400_000;
const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/;

function zoneOffset(zone: string, utc: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utc));
  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return wall - Math.floor(utc / 1000) * 1000;
}

/**
 * Normalises a provider date to an ISO instant. A value with an explicit offset is taken as is. An
 * offset-less date-time, or an all-day date (midnight), is read as wall-clock time in `zone`, never
 * in the host's zone. Returns "" when the value or zone is unusable so the caller can drop it loudly.
 */
export function instantIn(value: string, zone: string): string {
  if (value.includes("T") && OFFSET.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  }
  const match = LOCAL.exec(value);
  if (!match) return "";
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map((part) => Number(part ?? 0));
  const millis = match[7] ? Math.floor(Number(`0.${match[7]}`) * 1000) : 0;
  const wall = Date.UTC(year!, month! - 1, day!, hour, minute, second, millis);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month! - 1 || check.getUTCDate() !== day!) return "";
  try {
    const first = wall - zoneOffset(zone, wall);
    return new Date(wall - zoneOffset(zone, first)).toISOString();
  } catch {
    return "";
  }
}

export function safeEvent(input: CalendarEvent): CalendarEvent | null {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    (end - start > MAX_ORDINARY_MS && input.deployFreeze !== true)
  )
    return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    return null;
  }
  if (!input.id || input.id.length > 512) return null;
  const privateEvent = input.private;
  return {
    id: input.id,
    title: privateEvent ? "Busy" : input.title.slice(0, 300),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    timezone: input.timezone,
    attendees: privateEvent
      ? []
      : input.attendees.filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)).slice(0, 50),
    ...(privateEvent ? {} : { project: input.project?.slice(0, 120), url: safeLink(input.url) }),
    private: privateEvent,
    cancelled: input.cancelled === true,
    deployFreeze: !privateEvent && input.deployFreeze === true,
  };
}

export function safeLink(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
}

/** Adjacent windows are allowed: [start, end), in absolute epoch milliseconds. */
export function freezeAt(events: readonly CalendarEvent[], at: number): CalendarEvent | undefined {
  return events.find(
    (event) =>
      event.deployFreeze &&
      !event.cancelled &&
      !event.private &&
      Date.parse(event.start) <= at &&
      at < Date.parse(event.end),
  );
}

export class ReminderBook {
  private readonly sent = new Set<string>();
  due(events: readonly CalendarEvent[], now: number): CalendarEvent[] {
    const due: CalendarEvent[] = [];
    for (const event of events) {
      if (event.cancelled || event.private || this.sent.has(event.id)) continue;
      const until = Date.parse(event.start) - now;
      if (until < 0 || until > 5 * 60_000) continue;
      this.sent.add(event.id);
      due.push(event);
    }
    return due;
  }
}
