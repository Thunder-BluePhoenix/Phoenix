// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";

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

/** Reminders go out from this long before a meeting starts until it starts. */
export const REMINDER_WINDOW_MS = 5 * 60_000;
/** At most this many de-dup records are kept (the feed itself never holds more events). */
export const MAX_REMINDER_RECORDS = 500;
const REMINDER_KEY = /^[0-9a-f]{32}$/;

/**
 * Where a host keeps de-dup records so a restart inside the reminder window does not remind again.
 * `read` returns whatever was stored last (anything, including corrupt data: it is validated here)
 * and may throw; `write` replaces the stored value and may throw. Capabilities have no database of
 * their own, so Core lends this seam (`createCalendarCapability({ reminderStore })`).
 */
export interface ReminderStore {
  read(): unknown;
  write(value: unknown): void;
}

/** One stored record: an opaque key and the event's start time (epoch ms), nothing else. */
interface ReminderRecord {
  key: string;
  start: number;
}

/** A one-way digest of the occurrence id and start time; a stored value reveals no title or id. */
export function reminderKey(event: Pick<CalendarEvent, "id" | "start">): string {
  return createHash("sha256").update(`${event.id}\u0000${event.start}`).digest("hex").slice(0, 32);
}

/** Keeps only well-formed records from stored data; anything else, even a whole bad value, is ignored. */
function readRecords(stored: unknown): ReminderRecord[] {
  if (typeof stored !== "object" || stored === null) return [];
  const { version, sent } = stored as { version?: unknown; sent?: unknown };
  if (version !== 1 || !Array.isArray(sent)) return [];
  const records: ReminderRecord[] = [];
  for (const item of sent.slice(0, MAX_REMINDER_RECORDS)) {
    if (typeof item !== "object" || item === null) continue;
    const { key, start } = item as { key?: unknown; start?: unknown };
    if (typeof key !== "string" || !REMINDER_KEY.test(key)) continue;
    if (typeof start !== "number" || !Number.isFinite(start)) continue;
    records.push({ key, start });
  }
  return records;
}

/**
 * Issues each due reminder once per occurrence and start time. With a `ReminderStore` the keys
 * survive a Core restart; a reminder whose key is stored is not issued again until it is rescheduled.
 *
 * Storage failures never suppress a reminder: if the store cannot be read the book starts empty, and
 * if it cannot be written the in-memory record still prevents repeats in this process. A missed
 * meeting reminder is worse than a repeated one, so the book errs towards reminding. Failures are
 * swallowed without logging, because nothing here may carry event content. Records expire once the
 * start time has passed (the window is over) and at most MAX_REMINDER_RECORDS are kept.
 */
export class ReminderBook {
  private readonly sent = new Map<string, number>();
  private loaded = false;
  constructor(private readonly store?: ReminderStore) {}

  due(events: readonly CalendarEvent[], now: number): CalendarEvent[] {
    this.load();
    let changed = this.prune(now);
    const due: CalendarEvent[] = [];
    for (const event of events) {
      if (event.cancelled || event.private) continue;
      const start = Date.parse(event.start);
      const until = start - now;
      if (!Number.isFinite(until) || until < 0 || until > REMINDER_WINDOW_MS) continue;
      const key = reminderKey(event);
      if (this.sent.has(key)) continue;
      this.sent.set(key, start);
      due.push(event);
    }
    if (this.prune(now)) changed = true;
    if (due.length || changed) this.save();
    return due;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.store) return;
    try {
      for (const { key, start } of readRecords(this.store.read())) this.sent.set(key, start);
    } catch {
      // Unreadable storage: start empty and remind.
    }
  }

  /**
   * Drops records whose window is over, records dated beyond any window that could have issued them
   * (hostile or corrupt data), then the earliest starts beyond the bound. True when anything went.
   */
  private prune(now: number): boolean {
    const before = this.sent.size;
    for (const [key, start] of this.sent)
      if (start < now || start > now + REMINDER_WINDOW_MS) this.sent.delete(key);
    if (this.sent.size > MAX_REMINDER_RECORDS) {
      const keep = [...this.sent].sort((a, b) => b[1] - a[1]).slice(0, MAX_REMINDER_RECORDS);
      this.sent.clear();
      for (const [key, start] of keep) this.sent.set(key, start);
    }
    return this.sent.size !== before;
  }

  private save(): void {
    if (!this.store) return;
    const sent: ReminderRecord[] = [...this.sent].map(([key, start]) => ({ key, start }));
    try {
      this.store.write({ version: 1, sent });
    } catch {
      // Unwritable storage: the in-memory record still holds for this process.
    }
  }
}
