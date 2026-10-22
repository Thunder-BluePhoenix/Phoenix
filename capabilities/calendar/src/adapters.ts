// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CalendarEvent } from "./events";
import { instantIn, safeEvent } from "./events";

/** Clients are injected by Core; adapters never acquire a network or OS handle themselves. */
export interface CalendarClient {
  get(path: string, headers?: Readonly<Record<string, string>>): Promise<unknown>;
}
export interface CalendarRunner {
  run(program: string, args: readonly string[], signal: AbortSignal): Promise<string>;
}
export interface CalendarAdapter {
  list(from: string, to: string, signal: AbortSignal): Promise<CalendarEvent[]>;
}

/** Most events one provider read may contain. More is treated as truncation, never silently cut. */
export const MAX_PROVIDER_EVENTS = 500;

/**
 * The feed cannot be trusted as complete. Messages contain only a provider name and a fixed phrase,
 * never provider content, so they are safe to surface. A deploy freeze must fail closed on this.
 */
export class CalendarFeedError extends Error {
  override readonly name = "CalendarFeedError";
}

/**
 * Google deploy-freeze marker. Preferred: the private extended property `phoenix.deployFreeze=true`
 * (invisible to other calendar users, set by the owner's tooling). Fallback: a title starting with
 * `[deploy-freeze]` on an event the owner organises. Titles of invited events are ignored, so a
 * stranger's invitation cannot impose or lift a hold. Google has no `categories` field.
 */
export const GOOGLE_FREEZE_PROPERTY = "phoenix.deployFreeze";
export const FREEZE_TITLE_PREFIX = "[deploy-freeze]";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
/** The raw provider date string, used for stable occurrence ids. */
function date(value: unknown): string {
  const row = object(value);
  return text(row?.dateTime ?? row?.date);
}
/** The provider date as an ISO instant, offset-less and all-day values read in `zone`. */
function when(value: unknown, zone: string): string {
  return instantIn(date(value), text(object(value)?.timeZone) || zone);
}
/**
 * Maps rows to safe events. Cancelled occurrences are skipped. Any other row that cannot be read
 * (not an object, no id, invalid time or zone) makes the whole read fail: a dropped row could be a
 * deploy freeze, and a feed missing one must not look complete.
 */
function collect(
  rows: unknown[],
  provider: string,
  map: (row: Record<string, unknown>) => CalendarEvent | null,
): CalendarEvent[] {
  if (rows.length > MAX_PROVIDER_EVENTS)
    throw new CalendarFeedError(`${provider} feed incomplete: too many events`);
  const result: CalendarEvent[] = [];
  for (const raw of rows) {
    const row = object(raw);
    const event = row && map(row);
    if (event?.cancelled) continue;
    const safe = event?.id && safeEvent({ ...event, id: `${provider}:${event.id}` });
    if (!safe) throw new CalendarFeedError(`${provider} events could not be read`);
    result.push(safe);
  }
  return result;
}

/** Google singleEvents expands recurrences and exceptions server-side in the requested UTC range. */
export function googleCalendar(client: CalendarClient): CalendarAdapter {
  return {
    async list(from, to) {
      const query = new URLSearchParams({
        timeMin: from,
        timeMax: to,
        singleEvents: "true",
        maxResults: String(MAX_PROVIDER_EVENTS),
        orderBy: "startTime",
      });
      const response = object(await client.get(`/calendar/v3/calendars/primary/events?${query}`));
      if (response?.nextPageToken)
        throw new CalendarFeedError("google feed incomplete: more pages available");
      const calendarZone = text(response?.timeZone) || "UTC";
      return collect(entries(response?.items), "google", (row) => {
        const start = object(row.start);
        const end = object(row.end);
        const zone = text(start?.timeZone) || calendarZone;
        const id =
          text(row.recurringEventId) && date(row.originalStartTime)
            ? `${text(row.recurringEventId)}:${date(row.originalStartTime)}`
            : text(row.id);
        const title = text(row.summary);
        const marked = object(object(row.extendedProperties)?.private)?.[GOOGLE_FREEZE_PROPERTY];
        const owned = object(row.organizer)?.self === true;
        return {
          id,
          title,
          start: when(start, zone),
          end: when(end, zone),
          timezone: zone,
          attendees: entries(row.attendees).map((item) => text(object(item)?.email)),
          url: text(row.htmlLink),
          private: row.visibility === "private" || row.visibility === "confidential",
          cancelled: row.status === "cancelled",
          deployFreeze:
            marked === "true" || (owned && title.toLowerCase().startsWith(FREEZE_TITLE_PREFIX)),
        };
      });
    },
  };
}

/** Graph calendarView provides expanded recurring instances and exception dates. */
export function microsoftCalendar(client: CalendarClient): CalendarAdapter {
  return {
    async list(from, to) {
      const query = new URLSearchParams({
        startDateTime: from,
        endDateTime: to,
        $top: String(MAX_PROVIDER_EVENTS),
        $select: "id,subject,start,end,attendees,webLink,sensitivity,isCancelled,categories",
      });
      const response = object(
        await client.get(`/v1.0/me/calendarView?${query}`, { Prefer: 'outlook.timezone="UTC"' }),
      );
      if (response?.["@odata.nextLink"])
        throw new CalendarFeedError("microsoft feed incomplete: more pages available");
      return collect(entries(response?.value), "microsoft", (row) => {
        const zone = text(object(row.start)?.timeZone) || "UTC";
        return {
          id: text(row.id),
          title: text(row.subject),
          start: when(row.start, zone),
          end: when(row.end, zone),
          timezone: zone,
          attendees: entries(row.attendees).map((item) =>
            text(object(object(item)?.emailAddress)?.address),
          ),
          url: text(row.webLink),
          private:
            row.sensitivity === "private" ||
            row.sensitivity === "personal" ||
            row.sensitivity === "confidential",
          cancelled: row.isCancelled === true,
          deployFreeze: entries(row.categories).includes("deploy-freeze"),
        };
      });
    },
  };
}

/** CalDAV transport performs a read-only REPORT and returns expanded calendar objects as JSON.
 * The injected transport must restrict its target origin and calendar collection and parse XML/ICS;
 * this adapter never delegates a write request or silently guesses recurrence occurrences. */
export function caldavCalendar(client: CalendarClient, collection: string): CalendarAdapter {
  if (!/^\/[a-zA-Z0-9_./%-]+$/.test(collection) || collection.includes(".."))
    throw new TypeError("Invalid CalDAV collection");
  return {
    async list(from, to) {
      const query = new URLSearchParams({ from, to, expand: "true" });
      const response = object(await client.get(`${collection}?${query}`));
      return collect(entries(response?.events), "caldav", (row) => {
        const zone = text(row.timezone) || "UTC";
        return {
          id: text(row.uid) + (row.recurrenceId ? `:${text(row.recurrenceId)}` : ""),
          title: text(row.summary),
          start: instantIn(text(row.start), zone),
          end: instantIn(text(row.end), zone),
          timezone: zone,
          attendees: entries(row.attendees).map(text),
          url: text(row.url),
          private: row.class === "PRIVATE" || row.class === "CONFIDENTIAL",
          cancelled: row.status === "CANCELLED",
          deployFreeze: entries(row.categories).includes("deploy-freeze"),
        };
      });
    },
  };
}

/** macOS access is opt-in and scoped to an injected permission-checked runner. No shell or writes. */
export function macosCalendar(runner: CalendarRunner): CalendarAdapter {
  return {
    async list(from, to, signal) {
      const output = await runner.run(
        "calendar-read",
        ["--from", from, "--to", to, "--expand"],
        signal,
      );
      const response = object(JSON.parse(output) as unknown);
      return collect(entries(response?.events), "macos", (row) => {
        const zone = text(row.timezone) || "UTC";
        return {
          id: text(row.uid) + (row.recurrenceId ? `:${text(row.recurrenceId)}` : ""),
          title: text(row.title),
          start: instantIn(text(row.start), zone),
          end: instantIn(text(row.end), zone),
          timezone: zone,
          attendees: entries(row.attendees).map(text),
          url: text(row.url),
          private: row.private === true,
          cancelled: row.cancelled === true,
          deployFreeze: row.deployFreeze === true,
        };
      });
    },
  };
}
