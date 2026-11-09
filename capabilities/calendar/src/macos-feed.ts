// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The macOS Calendar seam. Core cannot call the desktop shell, and EventKit only runs inside the
// signed app that holds the Calendar permission, so the shell reads EventKit (recurrences already
// expanded by EventKit) and POSTs a bounded snapshot to Core. This class holds the latest snapshot
// in memory (replace, never append), stamps it with Core's own clock, and serves it to the existing
// `macosCalendar(runner)` adapter through a `CalendarRunner` that speaks the `calendar-read` JSON
// contract (`{ events: [...] }`). Nothing is persisted and nothing here touches the OS.
import { CalendarFeedError, type CalendarRunner } from "./adapters";

/** Most events one snapshot may carry; the shell reports `truncated` beyond it and the feed then fails. */
export const MACOS_MAX_EVENTS = 100;
/** A snapshot older than this (Core's clock) is never served: the shell sends one every minute. */
export const MACOS_MAX_AGE_MS = 3 * 60_000;
/** The shell's window may end this much earlier than the one Core asks for (one reminder poll). */
const WINDOW_SLACK_MS = 10 * 60_000;
const MAX_TITLE = 300;
const MAX_ATTENDEES = 8;
const MAX_EMAIL = 120;
const MAX_URL = 300;
const MAX_UID = 200;

/** What EventKit says about calendar access; only `authorized` (full access) carries events. */
export const MACOS_STATES = [
  "authorized",
  "denied",
  "restricted",
  "notDetermined",
  "writeOnly",
] as const;
export type MacosCalendarState = (typeof MACOS_STATES)[number];

/** Raised for a snapshot Core refuses; the message is fixed text, never the snapshot's content. */
export class MacosSnapshotError extends Error {
  override readonly name = "MacosSnapshotError";
}

interface Row {
  uid: string;
  recurrenceId?: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
  url?: string;
  cancelled: boolean;
  deployFreeze: boolean;
}

interface Snapshot {
  state: MacosCalendarState;
  from: number;
  to: number;
  truncated: boolean;
  events: Row[];
  receivedAt: number;
}

export interface MacosFeedStatus {
  /** `none` until the shell has sent a snapshot since Core started. */
  state: MacosCalendarState | "none";
  /** Core's clock, epoch ms; null before the first snapshot. */
  receivedAt: number | null;
  events: number;
  truncated: boolean;
  stale: boolean;
}

const HIDDEN = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Control and bidirectional-override characters removed, then at most `max` code points. */
export function cleanText(value: string, max: number): string {
  return [...value.replace(HIDDEN, "")].slice(0, max).join("").trim();
}

function fail(message: string): never {
  throw new MacosSnapshotError(message);
}
function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${what} must be an object`);
  return value as Record<string, unknown>;
}
function str(value: unknown, what: string, max: number, required = true): string {
  if (typeof value !== "string") fail(`${what} must be text`);
  const clean = cleanText(value, max);
  if (required && !clean) fail(`${what} must not be empty`);
  return clean;
}
function instant(value: unknown, what: string): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value)))
    fail(`${what} must be an ISO UTC time`);
  return value;
}
function flag(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") fail(`${what} must be true or false`);
  return value;
}

function row(raw: unknown): Row {
  const r = record(raw, "event");
  const attendees = r.attendees;
  if (!Array.isArray(attendees) || attendees.length > MAX_ATTENDEES)
    fail("event attendees must be a short list");
  const emails = attendees.map((a) => str(a, "attendee", MAX_EMAIL));
  if (!emails.every((a) => EMAIL.test(a))) fail("attendee must look like an email address");
  const zone = str(r.timezone, "timezone", 64);
  if (!ZONE.test(zone)) fail("timezone is not an IANA name");
  const out: Row = {
    uid: str(r.uid, "uid", MAX_UID),
    title: str(r.title, "title", MAX_TITLE, false),
    start: instant(r.start, "start"),
    end: instant(r.end, "end"),
    timezone: zone,
    attendees: emails,
    cancelled: flag(r.cancelled, "cancelled"),
    deployFreeze: flag(r.deployFreeze, "deployFreeze"),
  };
  if (r.recurrenceId !== undefined) out.recurrenceId = instant(r.recurrenceId, "recurrenceId");
  if (r.url !== undefined) out.url = str(r.url, "url", MAX_URL);
  return out;
}

/** Validates a snapshot body from the shell. Throws MacosSnapshotError with a fixed message. */
function parse(body: unknown, receivedAt: number): Snapshot {
  const b = record(body, "snapshot");
  if (b.version !== 1) fail("snapshot version is not supported");
  const state = b.state;
  if (typeof state !== "string" || !MACOS_STATES.includes(state as MacosCalendarState))
    fail("snapshot state is not one of the known access states");
  const events = b.events === undefined ? [] : b.events;
  if (!Array.isArray(events)) fail("events must be a list");
  if (events.length > MACOS_MAX_EVENTS) fail("too many events in one snapshot");
  if (state !== "authorized" && events.length > 0)
    fail("events are only accepted with full access");
  const truncated = flag(b.truncated, "truncated");
  const from = Date.parse(instant(b.from, "from"));
  const to = Date.parse(instant(b.to, "to"));
  if (to <= from) fail("the window must end after it starts");
  return {
    state: state as MacosCalendarState,
    from,
    to,
    truncated,
    events: events.map(row),
    receivedAt,
  };
}

const STATE_MESSAGE: Record<Exclude<MacosCalendarState, "authorized">, string> = {
  denied: "macos calendar access was denied in System Settings",
  restricted: "macos calendar access is restricted on this Mac",
  notDetermined: "macos calendar access has not been granted yet",
  writeOnly: "macos calendar access is write-only, full access is needed",
};

export class MacosCalendarFeed {
  private snapshot: Snapshot | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /** Replaces the held snapshot. A refused snapshot changes nothing (the old one keeps ageing). */
  submit(body: unknown): MacosFeedStatus {
    this.snapshot = parse(body, this.now());
    return this.status();
  }

  status(): MacosFeedStatus {
    const s = this.snapshot;
    if (!s) return { state: "none", receivedAt: null, events: 0, truncated: false, stale: false };
    const age = this.now() - s.receivedAt;
    return {
      state: s.state,
      receivedAt: s.receivedAt,
      events: s.events.length,
      truncated: s.truncated,
      stale: age < 0 || age > MACOS_MAX_AGE_MS,
    };
  }

  /** The `calendar-read` seam: what `macosCalendar` runs instead of a helper binary. */
  readonly runner: CalendarRunner = {
    run: async (program, args) => {
      if (program !== "calendar-read") throw new CalendarFeedError("macos reader not available");
      const s = this.snapshot;
      if (!s)
        throw new CalendarFeedError(
          "macos calendar snapshot not received (the Phoenix desktop app has not sent one)",
        );
      if (this.status().stale) throw new CalendarFeedError("macos calendar snapshot is stale");
      if (s.state !== "authorized") throw new CalendarFeedError(STATE_MESSAGE[s.state]);
      if (s.truncated) throw new CalendarFeedError("feed incomplete: too many macos events");
      const at = (flagName: string) => {
        const i = args.indexOf(flagName);
        return i >= 0 ? Date.parse(args[i + 1] ?? "") : Number.NaN;
      };
      const from = at("--from");
      const to = at("--to");
      if (!Number.isFinite(from) || !Number.isFinite(to))
        throw new CalendarFeedError("macos calendar window is invalid");
      if (s.from > from || s.to < to - WINDOW_SLACK_MS)
        throw new CalendarFeedError("macos calendar snapshot does not cover the window");
      return JSON.stringify({ events: s.events });
    },
  };
}
