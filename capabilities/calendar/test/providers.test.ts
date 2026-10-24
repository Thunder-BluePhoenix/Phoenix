// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The production adapters (CalDAV over HTTP, Google, Microsoft Graph) against loopback fake
// servers shaped from the providers' documentation. No real account, server or token is used.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { startMockService, type MockReply, type MockService } from "@phoenix/service-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  caldavCalendar,
  caldavClient,
  caldavLogin,
  caldavTarget,
  createCalendarCapability,
  multistatusCalendarData,
  parseIcsEvents,
  type CalendarAdapter,
  type CalendarClient,
  type CalendarEvent,
} from "../src";

const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const signal = new AbortController().signal;
const PASSWORD = ["app", "pass", "marker", "7"].join("-");
const LOGIN = `me@example.com:${PASSWORD}`;
const BASIC = `Basic ${Buffer.from(LOGIN).toString("base64")}`;
const TOKEN = ["fake", "access", "marker", "9"].join("-");
const REMOTE_MARKER = "REMOTE-TEXT-MUST-NOT-LEAK";

const ics = (...vevents: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...vevents, "END:VCALENDAR", ""].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const multistatus = (...calendars: string[]) =>
  '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
  calendars
    .map(
      (data, i) =>
        `<D:response><D:href>/cal/${i}.ics</D:href><D:propstat><D:prop><C:calendar-data>${xmlEscape(data)}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
    )
    .join("") +
  "</D:multistatus>";

const reviewIcs = ics(
  vevent(
    "UID:series",
    "RECURRENCE-ID:20261022T130000Z",
    "DTSTAMP:20261001T000000Z",
    "DTSTART:20261022T130000Z",
    "DTEND:20261022T140000Z",
    "SUMMARY:Review",
    "ATTENDEE;CN=Alex:mailto:alex@example.com",
    "URL:https://example.com/meet",
  ),
);

let h: Harness | undefined;
const servers: MockService[] = [];
afterEach(async () => {
  await h?.close();
  h = undefined;
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(handler: (req: { method: string; path: string }) => MockReply | undefined) {
  const service = await startMockService(handler);
  servers.push(service);
  return service;
}

interface Feed {
  configured: boolean;
  events: CalendarEvent[];
  checkedAt: number | null;
  error: string | null;
  sends_caldav_credential_to?: string;
}

async function boot(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  options: Parameters<typeof createCalendarCapability>[0] = {},
) {
  h = createHarness({
    modules: [
      createCalendarCapability({
        now: () => T0,
        sleep: (_ms, abort) => {
          const wait = Promise.withResolvers<void>();
          abort.addEventListener("abort", () => wait.resolve(), { once: true });
          return wait.promise;
        },
        ...options,
      }),
    ],
  });
  h.manager.configure("calendar", config);
  for (const [name, value] of Object.entries(secrets))
    await h.manager.setSecret("calendar", name, value);
  await h.enable("calendar");
  await h.drain();
  return async (input: unknown = {}): Promise<Feed> => {
    const op = await h!.run("calendar", "upcoming", input);
    expect(op.status).toBe("succeeded");
    return op.result as Feed;
  };
}

/** Everything a user, log or API consumer could see after a run. */
function visible(feed: unknown): string {
  return JSON.stringify([feed, h!.events, h!.manager.list(), h!.permissions.audit.list?.() ?? []]);
}

describe("iCalendar and multistatus reading", () => {
  it("reads folded lines, escapes, parameters, durations, all-day dates, floating and zoned times", () => {
    const rows = parseIcsEvents(
      ics(
        vevent(
          "UID:a",
          "SUMMARY:Plan\\, review\\; part\\n two with a very long title that is folded across ",
          " two lines",
          'ATTENDEE;CN="Doe, Jane";ROLE=REQ-PARTICIPANT:mailto:jane@example.com',
          "DTSTART;TZID=America/New_York:20261022T100000",
          "DURATION:PT1H30M",
          "CLASS:private",
          "CATEGORIES:deploy-freeze,other",
          "STATUS:CANCELLED",
          "BEGIN:VALARM",
          "SUMMARY:alarm text",
          "END:VALARM",
        ),
        vevent("UID:b", "DTSTART;VALUE=DATE:20261224", "SUMMARY:Holiday"),
        vevent("UID:c", "DTSTART:20261022T090000", "DTEND:20261022T100000"),
      ),
      "Europe/Berlin",
    );
    expect(rows[0]).toMatchObject({
      uid: "a",
      summary: "Plan, review; part\n two with a very long title that is folded across two lines",
      attendees: ["jane@example.com"],
      start: "2026-10-22T14:00:00.000Z",
      end: "2026-10-22T15:30:00.000Z",
      timezone: "America/New_York",
      class: "PRIVATE",
      status: "CANCELLED",
      categories: ["deploy-freeze", "other"],
    });
    expect(rows[1]).toMatchObject({
      start: "2026-12-23T23:00:00.000Z",
      end: "2026-12-24T23:00:00.000Z",
      timezone: "Europe/Berlin",
    });
    expect(rows[2]).toMatchObject({ start: "2026-10-22T07:00:00.000Z" });
    expect(rows).toHaveLength(3);
  });

  it("refuses an unexpanded recurrence instead of guessing occurrences", () => {
    expect(() =>
      parseIcsEvents(
        ics(
          vevent("UID:r", "DTSTART:20261022T130000Z", "RRULE:FREQ=DAILY", "DTEND:20261022T140000Z"),
        ),
        "UTC",
      ),
    ).toThrow(/did not expand/);
  });

  it("fails on an unterminated event and leaves bad times empty so the feed is rejected", () => {
    expect(() => parseIcsEvents("BEGIN:VEVENT\r\nUID:x\r\n", "UTC")).toThrow(/could not be read/);
    const [row] = parseIcsEvents(ics(vevent("UID:x", "DTSTART:garbage", "DTEND:garbage")), "UTC");
    expect(row).toMatchObject({ start: "", end: "" });
    const [bad] = parseIcsEvents(
      ics(
        vevent(
          "UID:y",
          "DTSTART;TZID=Not/AZone:20261022T100000",
          "DTEND;TZID=Not/AZone:20261022T110000",
        ),
      ),
      "UTC",
    );
    expect(bad?.start).toBe("");
  });

  it("reads a multistatus with entities and CDATA, and refuses partial or malformed answers", () => {
    expect(multistatusCalendarData(multistatus("A & B"))).toEqual(["A & B"]);
    const cdata =
      '<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop><C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav"><![CDATA[a < b]]></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
    expect(multistatusCalendarData(cdata)).toEqual(["a < b"]);
    expect(multistatusCalendarData("<D:multistatus xmlns:D='DAV:'/>")).toEqual([]);
    const partial = multistatus("x").replace("200 OK", "507 Insufficient Storage");
    expect(() => multistatusCalendarData(partial)).toThrow(/partial result/);
    const noData =
      '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/x</D:href></D:response></D:multistatus>';
    expect(() => multistatusCalendarData(noData)).toThrow(/could not be read/);
    expect(() => multistatusCalendarData("<D:multistatus><D:response>")).toThrow();
    // An entity declaration is never resolved: the reference stays as literal text.
    const xxe =
      '<!DOCTYPE x [<!ENTITY e "boom">]><D:multistatus xmlns:D="DAV:"><D:response><C:calendar-data>&e;</C:calendar-data></D:response></D:multistatus>';
    expect(multistatusCalendarData(xxe)).toEqual(["&e;"]);
  });
});

describe("CalDAV address and login checks", () => {
  it("accepts https and loopback http collections only, without credentials, query or fragment", () => {
    expect(caldavTarget("https://dav.example.com/calendars/me/work/").collection).toBe(
      "/calendars/me/work/",
    );
    expect(caldavTarget("http://127.0.0.1:8080/cal/").url.host).toBe("127.0.0.1:8080");
    for (const bad of [
      "http://dav.example.com/cal/",
      "https://u:p@dav.example.com/cal/",
      "https://dav.example.com/cal/?x=1",
      "https://dav.example.com/cal/#frag",
      "https://dav.example.com/",
      "https://dav.example.com/a/../b",
      "ftp://dav.example.com/cal/",
      "javascript:alert(1)",
      "not a url",
      "",
      42,
      undefined,
    ])
      expect(() => caldavTarget(bad), String(bad)).toThrow(/caldav_url/);
  });

  it("splits username:password and never echoes a bad value", () => {
    expect(caldavLogin("me:a:b")).toEqual({ user: "me", pass: "a:b" });
    for (const bad of ["", "nopassword", ":x", "x:", `u:${"p".repeat(2000)}`]) {
      let message = "";
      try {
        caldavLogin(bad);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBe("caldav_credential must be username:password");
    }
  });
});

describe("CalDAV through the capability", () => {
  it("sends one REPORT with Basic credentials to the named host and yields the same events and reminder as the fake adapter", async () => {
    const soon = ics(
      vevent(
        "UID:series",
        "RECURRENCE-ID:20261022T120300Z",
        "DTSTART:20261022T120300Z",
        "DTEND:20261022T130000Z",
        "SUMMARY:Standup",
        "ATTENDEE:mailto:alex@example.com",
        "URL:https://example.com/meet",
      ),
    );
    const dav = await serve(() => ({ status: 207, body: multistatus(reviewIcs, soon) }));
    const upcoming = await boot(
      { caldav: true, caldav_url: `${dav.url}/cal/work/` },
      { caldav_credential: LOGIN },
    );
    const feed = await upcoming();
    expect(feed.error).toBeNull();
    expect(feed.sends_caldav_credential_to).toBe(new URL(dav.url).host);

    const fake: CalendarClient = {
      async get() {
        return {
          events: [
            {
              uid: "series",
              recurrenceId: "20261022T130000Z",
              summary: "Review",
              start: "2026-10-22T13:00:00Z",
              end: "2026-10-22T14:00:00Z",
              timezone: "UTC",
              attendees: ["alex@example.com"],
              url: "https://example.com/meet",
            },
            {
              uid: "series",
              recurrenceId: "20261022T120300Z",
              summary: "Standup",
              start: "2026-10-22T12:03:00Z",
              end: "2026-10-22T13:00:00Z",
              timezone: "UTC",
              attendees: ["alex@example.com"],
              url: "https://example.com/meet",
            },
          ],
        };
      },
    };
    const expected = await caldavCalendar(fake, "/cal/work/").list("", "", signal);
    expect(feed.events).toEqual(
      expected
        .filter((e) => Date.parse(e.end) > T0)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    );
    expect(feed.events.map((e) => e.id)).toEqual([
      "caldav:series:20261022T120300Z",
      "caldav:series:20261022T130000Z",
    ]);

    expect(dav.requests).toHaveLength(1);
    const [request] = dav.requests;
    expect(request).toMatchObject({ method: "REPORT", path: "/cal/work/" });
    expect(request?.headers.authorization).toBe(BASIC);
    expect(request?.headers.depth).toBe("1");
    expect(request?.body).toContain('<C:expand start="20261022T115900Z" end="20261029T120000Z"/>');
    expect(request?.body).toContain('<C:time-range start="20261022T115900Z"');

    const reminders = h!.events.filter((e) => e.event_type === "calendar.meeting.starting_soon");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      correlation_id: "caldav:series:20261022T120300Z",
      subject: "Standup",
      payload: { event: { title: "Standup" }, notetaker_offer: true },
    });
    expect(visible(feed)).not.toContain(PASSWORD);
    expect(visible(feed)).not.toContain(Buffer.from(LOGIN).toString("base64"));
  });

  it("marks deploy-freeze, private and cancelled events like the other adapters", async () => {
    const data = ics(
      vevent(
        "UID:f",
        "DTSTART:20261023T100000Z",
        "DTEND:20261023T110000Z",
        "CATEGORIES:deploy-freeze",
        "SUMMARY:Freeze",
      ),
      vevent(
        "UID:p",
        "DTSTART:20261023T120000Z",
        "DTEND:20261023T130000Z",
        "CLASS:PRIVATE",
        "SUMMARY:Therapy",
        "ATTENDEE:mailto:a@example.com",
      ),
      vevent(
        "UID:c",
        "DTSTART:20261023T140000Z",
        "DTEND:20261023T150000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Gone",
      ),
    );
    const dav = await serve(() => ({ status: 207, body: multistatus(data) }));
    const upcoming = await boot(
      { caldav: true, caldav_url: `${dav.url}/cal/`, caldav_timezone: "Europe/Berlin" },
      { caldav_credential: LOGIN },
    );
    const feed = await upcoming();
    expect(feed.events).toEqual([
      expect.objectContaining({ id: "caldav:f", deployFreeze: true }),
      expect.objectContaining({ id: "caldav:p", title: "Busy", private: true, attendees: [] }),
    ]);
  });

  it("fails closed on a server that did not expand a recurring event", async () => {
    const data = ics(
      vevent("UID:r", "DTSTART:20261022T130000Z", "DTEND:20261022T140000Z", "RRULE:FREQ=WEEKLY"),
    );
    const dav = await serve(() => ({ status: 207, body: multistatus(data) }));
    const upcoming = await boot(
      { caldav: true, caldav_url: `${dav.url}/cal/` },
      { caldav_credential: LOGIN },
    );
    expect(await upcoming()).toMatchObject({
      events: [],
      checkedAt: null,
      error: "caldav server did not expand recurring events",
    });
  });

  it("refuses to follow a redirect, so the credential never reaches another host", async () => {
    const other = await serve(() => ({ status: 207, body: multistatus(reviewIcs) }));
    const dav = await serve(() => ({
      status: 302,
      headers: { location: `${other.url}/cal/` },
      body: "",
    }));
    const upcoming = await boot(
      { caldav: true, caldav_url: `${dav.url}/cal/` },
      { caldav_credential: LOGIN },
    );
    const feed = await upcoming();
    expect(feed).toMatchObject({ events: [], checkedAt: null, error: "caldav is unreachable" });
    expect(other.requests).toHaveLength(0);
    expect(dav.requests).toHaveLength(1);
    expect(visible(feed)).not.toContain(PASSWORD);
    expect(visible(feed)).not.toContain(other.url);
  });

  it("reports each refusal with a fixed phrase and none of the server's text or the secret", async () => {
    const cases: [number, string][] = [
      [401, "caldav rejected the credential (401): check the username and app password"],
      [403, "caldav refused the request (403): the account may not read this calendar"],
      [404, "caldav calendar not found (404): check caldav_url"],
      [500, "caldav answered HTTP 500"],
      [200, "caldav answered HTTP 200"],
    ];
    for (const [status, message] of cases) {
      const dav = await serve(() => ({ status, body: `${REMOTE_MARKER} ${PASSWORD}` }));
      const upcoming = await boot(
        { caldav: true, caldav_url: `${dav.url}/cal/` },
        { caldav_credential: LOGIN },
      );
      const feed = await upcoming();
      expect(feed.error, String(status)).toBe(message);
      expect(visible(feed)).not.toContain(REMOTE_MARKER);
      expect(visible(feed)).not.toContain(PASSWORD);
      await h!.close();
      h = undefined;
    }
  });

  it("refuses an answer larger than the cap, by header and by streaming", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 10);
    const declared = await serve(() => ({ status: 207, body: big }));
    const upcoming = await boot(
      { caldav: true, caldav_url: `${declared.url}/cal/` },
      { caldav_credential: LOGIN },
    );
    expect((await upcoming()).error).toBe("caldav response is too large");
    await h!.close();
    h = undefined;

    // No Content-Length: the stream is cut off at the cap.
    const chunked = createServer((_req, res) => {
      res.writeHead(207, { "transfer-encoding": "chunked" });
      const piece = "y".repeat(256 * 1024);
      for (let i = 0; i < 12; i++) res.write(piece);
      res.end();
    });
    await new Promise<void>((resolve) => chunked.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = chunked.address() as AddressInfo;
      const again = await boot(
        { caldav: true, caldav_url: `http://127.0.0.1:${port}/cal/` },
        { caldav_credential: LOGIN },
      );
      expect((await again()).error).toBe("caldav response is too large");
    } finally {
      chunked.closeAllConnections();
      await new Promise<void>((resolve) => chunked.close(() => resolve()));
    }
  });

  it("gives up on a server that never answers or drips its body, within the deadline", async () => {
    const silent = createServer(() => {});
    const dripping = createServer((_req, res) => {
      res.writeHead(207);
      res.write("<D:multistatus");
    });
    for (const server of [silent, dripping])
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      for (const server of [silent, dripping]) {
        const { port } = server.address() as AddressInfo;
        const target = caldavTarget(`http://127.0.0.1:${port}/cal/`);
        const client = caldavClient({
          target,
          credential: LOGIN,
          timezone: "UTC",
          signal,
          timeoutMs: 150,
        });
        const started = Date.now();
        await expect(
          client.get(
            `/cal/?from=${encodeURIComponent("2026-10-22T12:00:00.000Z")}&to=${encodeURIComponent("2026-10-29T12:00:00.000Z")}&expand=true`,
          ),
        ).rejects.toThrow(/timed out/);
        expect(Date.now() - started).toBeLessThan(3000);
      }
    } finally {
      for (const server of [silent, dripping]) {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      }
    }
  });

  it("never reads a collection other than the configured one", async () => {
    const dav = await serve(() => ({ status: 207, body: multistatus(reviewIcs) }));
    const client = caldavClient({
      target: caldavTarget(`${dav.url}/cal/work/`),
      credential: LOGIN,
      timezone: "UTC",
      signal,
    });
    await expect(
      client.get("/other/?from=2026-10-22T12:00:00Z&to=2026-10-23T12:00:00Z"),
    ).rejects.toThrow(/could not be read/);
    await expect(client.get("/cal/work/?from=garbage&to=2026-10-23T12:00:00Z")).rejects.toThrow(
      /could not be read/,
    );
    expect(dav.requests).toHaveLength(0);
  });
});

describe("configuration and secrets", () => {
  it("stays unconfigured, and contacts nobody, until a provider is switched on", async () => {
    const mock = await serve(() => ({ status: 207, body: multistatus(reviewIcs) }));
    const upcoming = await boot(
      {},
      { caldav_credential: LOGIN, google_credential: TOKEN },
      { endpoints: { google: mock.url, microsoft: mock.url } },
    );
    expect(await upcoming()).toMatchObject({ configured: false, events: [], error: null });
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects an unsafe or malformed caldav_url at configuration time without echoing it", () => {
    h = createHarness({ modules: [createCalendarCapability()] });
    for (const url of [
      "http://dav.example.com/cal/",
      "https://me:hunter2pass@dav.example.com/cal/",
      "https://dav.example.com/cal/?token=abc",
      "ftp://dav.example.com/cal/",
      "https://dav example.com/cal/",
    ]) {
      let error: unknown;
      try {
        h.manager.configure("calendar", { caldav: true, caldav_url: url });
      } catch (err) {
        error = err;
      }
      expect(error, url).toBeDefined();
      expect(JSON.stringify(error)).not.toContain(url);
      expect(String((error as Error).message)).toBe("Invalid configuration");
    }
    expect(() => h!.manager.configure("calendar", { caldav_url: "x".repeat(3000) })).toThrow();
    // A secret smuggled into config is refused by the manager, never stored.
    expect(() => h!.manager.configure("calendar", { caldav_credential: LOGIN })).toThrow();
  });

  it("explains a missing url, a bad login or a bad zone, and sends no request", async () => {
    const dav = await serve(() => ({ status: 207, body: multistatus(reviewIcs) }));
    const url = `${dav.url}/cal/`;
    const cases: [Record<string, unknown>, string, string][] = [
      [
        { caldav: true },
        LOGIN,
        "caldav_url must be an https address (http only to localhost) without credentials, query or fragment",
      ],
      [{ caldav: true, caldav_url: url }, "nocolon", "caldav_credential must be username:password"],
      [
        { caldav: true, caldav_url: url, caldav_timezone: "Not/AZone" },
        LOGIN,
        "caldav_timezone must be a valid IANA time zone name",
      ],
    ];
    for (const [config, credential, message] of cases) {
      const upcoming = await boot(config, { caldav_credential: credential });
      const feed = await upcoming();
      expect(feed).toMatchObject({ events: [], checkedAt: null, error: message });
      expect(visible(feed)).not.toContain("nocolon");
      await h!.close();
      h = undefined;
    }
    expect(dav.requests).toHaveLength(0);
  });

  it("does not query a provider whose secret is missing", async () => {
    const dav = await serve(() => ({ status: 207, body: multistatus(reviewIcs) }));
    const upcoming = await boot({ caldav: true, caldav_url: `${dav.url}/cal/` }, {});
    expect(await upcoming()).toMatchObject({ error: "caldav credential missing", events: [] });
    expect(dav.requests).toHaveLength(0);
  });

  it("reports macOS as unavailable (never as an empty calendar) without a host-supplied reader", async () => {
    const upcoming = await boot({ macos: true }, {});
    expect(await upcoming()).toMatchObject({
      configured: true,
      events: [],
      checkedAt: null,
      error: "macos calendar reader is not available in this build",
    });
  });

  it("uses a host-supplied adapter in place of the built-in one", async () => {
    const injected: CalendarAdapter = {
      async list() {
        return [
          {
            id: "macos:local",
            title: "Local",
            start: "2026-10-22T13:00:00.000Z",
            end: "2026-10-22T14:00:00.000Z",
            timezone: "UTC",
            attendees: [],
            private: false,
          },
        ];
      },
    };
    const upcoming = await boot({ macos: true }, {}, { adapters: { macos: injected } });
    expect((await upcoming()).events.map((e) => e.id)).toEqual(["macos:local"]);
  });
});

describe("Google and Microsoft Graph with a stored access token", () => {
  it("reads Google with a bearer token sent only to the Google endpoint", async () => {
    const google = await serve(() => ({
      body: {
        timeZone: "UTC",
        items: [
          {
            id: "g1",
            summary: "Review",
            start: { dateTime: "2026-10-22T13:00:00Z" },
            end: { dateTime: "2026-10-22T14:00:00Z" },
            attendees: [{ email: "alex@example.com" }],
            htmlLink: "https://example.com/meet",
          },
        ],
      },
    }));
    const microsoft = await serve(() => ({ body: { value: [] } }));
    const upcoming = await boot(
      { google: true },
      { google_credential: TOKEN },
      { endpoints: { google: google.url, microsoft: microsoft.url } },
    );
    const feed = await upcoming();
    expect(feed.events).toEqual([
      expect.objectContaining({
        id: "google:g1",
        title: "Review",
        attendees: ["alex@example.com"],
      }),
    ]);
    expect(google.requests).toHaveLength(1);
    expect(google.requests[0]?.path).toContain("/calendar/v3/calendars/primary/events?");
    expect(google.requests[0]?.path).toContain("singleEvents=true");
    expect(google.requests[0]?.method).toBe("GET");
    expect(google.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(microsoft.requests).toHaveLength(0);
    expect(visible(feed)).not.toContain(TOKEN);
  });

  it("reads Graph with the UTC preference and reports a rejected or expired token plainly", async () => {
    let reply: MockReply = {
      body: {
        value: [
          {
            id: "m1",
            subject: "Freeze",
            start: { dateTime: "2026-10-22T13:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-10-22T14:00:00.0000000", timeZone: "UTC" },
            categories: ["deploy-freeze"],
          },
        ],
      },
    };
    const graph = await serve(() => reply);
    const upcoming = await boot(
      { microsoft: true },
      { microsoft_credential: TOKEN },
      { endpoints: { microsoft: graph.url } },
    );
    const feed = await upcoming();
    expect(feed.events).toEqual([
      expect.objectContaining({ id: "microsoft:m1", deployFreeze: true }),
    ]);
    expect(graph.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(graph.requests[0]?.headers.prefer).toBe('outlook.timezone="UTC"');
    expect(graph.requests[0]?.path).toContain("/v1.0/me/calendarView?");

    reply = { status: 401, body: { error: REMOTE_MARKER, echo: TOKEN } };
    const failed = await upcoming({ refresh: true });
    expect(failed.error).toBeNull(); // cached within 30 s: the stale read is not refreshed yet
  });

  it("surfaces a 401 as an explicit, secret-free feed error", async () => {
    const graph = await serve(() => ({ status: 401, body: { error: REMOTE_MARKER, echo: TOKEN } }));
    const upcoming = await boot(
      { microsoft: true },
      { microsoft_credential: TOKEN },
      { endpoints: { microsoft: graph.url } },
    );
    const feed = await upcoming();
    expect(feed.error).toBe(
      "Microsoft Graph rejected the credential (401): check it is valid and not expired",
    );
    expect(feed.events).toEqual([]);
    expect(visible(feed)).not.toContain(REMOTE_MARKER);
    expect(visible(feed)).not.toContain(TOKEN);
  });

  it("does not follow a redirect with the token and refuses pagination", async () => {
    const other = await serve(() => ({ body: { items: [] } }));
    const google = await serve(() => ({
      status: 307,
      headers: { location: `${other.url}/x` },
      body: "",
    }));
    const upcoming = await boot(
      { google: true },
      { google_credential: TOKEN },
      { endpoints: { google: google.url } },
    );
    expect((await upcoming()).error).toBe("Google Calendar is unreachable");
    expect(other.requests).toHaveLength(0);

    await h!.close();
    h = undefined;
    const paged = await serve(() => ({ body: { items: [], nextPageToken: "more" } }));
    const again = await boot(
      { google: true },
      { google_credential: TOKEN },
      { endpoints: { google: paged.url } },
    );
    expect((await again()).error).toBe("google feed incomplete: more pages available");
  });

  it("only accepts https or loopback endpoints when a host builds the capability", () => {
    expect(() =>
      createCalendarCapability({ endpoints: { google: "http://evil.example.com" } }),
    ).toThrow(/https/);
    expect(() =>
      createCalendarCapability({ endpoints: { microsoft: "https://user:pw@x.example.com" } }),
    ).toThrow(/https/);
  });
});
