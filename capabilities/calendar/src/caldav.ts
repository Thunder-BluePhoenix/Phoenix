// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real CalDAV transport behind `caldavCalendar`: one read-only REPORT (`calendar-query` with
// server-side `<expand>`) to the collection the owner named, with HTTP Basic credentials (an app
// password) that are sent ONLY to that URL's host. No method other than REPORT is ever sent, no
// redirect is followed (so the credential can not travel to another host), the body is bounded and
// the whole call has a deadline. Every error message is a fixed phrase: never the URL, the
// credential or anything the server sent.
import { readCapped, safeBaseUrl, ServiceError } from "@phoenix/service-kit";
import { CalendarFeedError, type CalendarClient } from "./adapters";
import { multistatusCalendarData, parseIcsEvents } from "./ics";

/** Largest answer read; a week of events is far smaller. */
export const CALDAV_MAX_BYTES = 2 * 1024 * 1024;
export const CALDAV_TIMEOUT_MS = 15_000;
const MAX_CREDENTIAL = 1024;
const COLLECTION = /^\/[a-zA-Z0-9_./%-]+$/;

export interface CalDavTarget {
  /** Full collection URL, e.g. https://dav.example.com/calendars/me/work/ */
  url: URL;
  /** The path of `url` (percent-encoded), which `caldavCalendar` accepts as the collection. */
  collection: string;
}

/**
 * Checks the owner's `caldav_url` and returns the target, or throws a CalendarFeedError whose
 * message never contains the value. https only (plain http only to loopback), no embedded
 * credentials, query or fragment, and a plain collection path.
 */
export function caldavTarget(value: unknown): CalDavTarget {
  if (typeof value !== "string" || safeBaseUrl(value) === undefined)
    throw new CalendarFeedError(
      "caldav_url must be an https address (http only to localhost) without credentials, query or fragment",
    );
  const url = new URL(value);
  // `new URL` resolves dot segments, so the raw text is checked too.
  if (!COLLECTION.test(url.pathname) || /\.\.|%2e/i.test(value))
    throw new CalendarFeedError("caldav_url must name one calendar collection path");
  return { url, collection: url.pathname };
}

/** Splits `username:password` at the first colon; fixed error text, never the value. */
export function caldavLogin(value: string): { user: string; pass: string } {
  const colon = value.indexOf(":");
  if (colon < 1 || colon === value.length - 1 || value.length > MAX_CREDENTIAL)
    throw new CalendarFeedError("caldav_credential must be username:password");
  return { user: value.slice(0, colon), pass: value.slice(colon + 1) };
}

export interface CalDavClientOptions {
  target: CalDavTarget;
  /** `username:password` from the secret store. */
  credential: string;
  /** Zone for all-day and floating times (expanded instances are UTC). */
  timezone: string;
  /** Aborted when the capability is disabled. */
  signal: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
}

/** `20261022T120000Z` for CalDAV time ranges; throws on anything that is not an ISO instant. */
function davTime(iso: string | null): string {
  const ms = iso === null ? NaN : Date.parse(iso);
  if (!Number.isFinite(ms)) throw new CalendarFeedError("caldav events could not be read");
  return new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function reportBody(from: string, to: string): string {
  const range = `start="${from}" end="${to}"`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    `<D:prop><C:calendar-data><C:expand ${range}/></C:calendar-data></D:prop>` +
    `<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range ${range}/>` +
    "</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>"
  );
}

/** HTTP statuses that carry a specific, safe explanation. */
const REFUSALS: Record<number, string> = {
  401: "caldav rejected the credential (401): check the username and app password",
  403: "caldav refused the request (403): the account may not read this calendar",
  404: "caldav calendar not found (404): check caldav_url",
  429: "caldav rate limit reached",
};

/**
 * A `CalendarClient` for `caldavCalendar(client, target.collection)`. Its `get` receives the
 * adapter's `<collection>?from=&to=&expand=true` request and turns it into the REPORT; it answers
 * `{ events }` in the shape the adapter reads.
 */
export function caldavClient(options: CalDavClientOptions): CalendarClient {
  const { target, signal } = options;
  const maxBytes = options.maxBytes ?? CALDAV_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? CALDAV_TIMEOUT_MS;
  const login = caldavLogin(options.credential);
  const authorization = `Basic ${Buffer.from(`${login.user}:${login.pass}`, "utf8").toString("base64")}`;
  return {
    async get(path) {
      const query = new URL(path, target.url.origin);
      if (query.pathname !== target.collection)
        throw new CalendarFeedError("caldav events could not be read");
      const body = reportBody(
        davTime(query.searchParams.get("from")),
        davTime(query.searchParams.get("to")),
      );
      const deadline = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetch(target.url, {
          method: "REPORT",
          headers: {
            authorization,
            depth: "1",
            "content-type": "application/xml; charset=utf-8",
            accept: "application/xml, text/xml",
            "user-agent": "phoenix-capability",
          },
          body,
          redirect: "error",
          signal: AbortSignal.any([signal, deadline]),
        });
      } catch {
        throw new CalendarFeedError(
          deadline.aborted ? "caldav timed out" : "caldav is unreachable",
        );
      }
      if (res.status !== 207) {
        await res.body?.cancel().catch(() => {});
        throw new CalendarFeedError(REFUSALS[res.status] ?? `caldav answered HTTP ${res.status}`);
      }
      let xml: string;
      try {
        xml = await readCapped("caldav", res, maxBytes, timeoutMs);
      } catch (err) {
        // The request's own deadline also errors the body stream, so check it before the error type.
        throw new CalendarFeedError(
          deadline.aborted
            ? "caldav timed out"
            : err instanceof ServiceError
              ? err.message
              : "caldav events could not be read",
        );
      }
      const events = multistatusCalendarData(xml).flatMap((ics) => {
        const rows = parseIcsEvents(ics, options.timezone);
        // A time-range query only returns objects with a VEVENT; one without is not a complete answer.
        if (rows.length === 0) throw new CalendarFeedError("caldav events could not be read");
        return rows;
      });
      return { events };
    },
  };
}
