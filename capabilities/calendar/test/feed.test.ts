// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCalendarCapability,
  googleCalendar,
  instantIn,
  microsoftCalendar,
  safeEvent,
  type CalendarAdapter,
  type CalendarClient,
  type CalendarEvent,
} from "../src";

const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const start = "2026-10-22T13:00:00.000Z";
const end = "2026-10-22T14:00:00.000Z";
const signal = new AbortController().signal;
const event: CalendarEvent = {
  id: "google:one",
  title: "Review",
  start,
  end,
  timezone: "UTC",
  attendees: [],
  private: false,
};

class FakeClient implements CalendarClient {
  constructor(private readonly response: unknown) {}
  async get(): Promise<unknown> {
    return this.response;
  }
}

let h: Harness | undefined;
let now = T0;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

interface Feed {
  configured: boolean;
  events: CalendarEvent[];
  checkedAt: number | null;
  error: string | null;
}

async function start_(
  adapters: Record<string, CalendarAdapter>,
  config: Record<string, boolean>,
  credentials: string[],
) {
  now = T0;
  h = createHarness({
    modules: [
      createCalendarCapability({
        adapters,
        now: () => now,
        sleep: (_ms, abort) => {
          const wait = Promise.withResolvers<void>();
          abort.addEventListener("abort", () => wait.resolve(), { once: true });
          return wait.promise;
        },
      }),
    ],
  });
  h.manager.configure("calendar", config);
  for (const name of credentials)
    await h.manager.setSecret("calendar", `${name}_credential`, "fake-credential-value");
  await h.enable("calendar");
  await h.drain();
  return async (input: unknown = {}): Promise<Feed> => {
    const op = await h!.run("calendar", "upcoming", input);
    expect(op.status).toBe("succeeded");
    return op.result as Feed;
  };
}

describe("feed integrity", () => {
  it("treats a configured provider without its credential as an unavailable feed", async () => {
    const list = vi.fn(async () => [event]);
    const upcoming = await start_({ google: { list } }, { google: true }, []);
    const feed = await upcoming();
    expect(feed).toMatchObject({
      error: "google credential missing",
      checkedAt: null,
      events: [],
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("never presents a partial feed when one of several providers fails", async () => {
    const list = vi.fn(async () => [event]);
    const upcoming = await start_(
      { google: { list }, microsoft: { list } },
      { google: true, microsoft: true },
      ["microsoft"],
    );
    const feed = await upcoming();
    expect(feed.error).toBe("google credential missing");
    expect(feed.events).toEqual([]);
    expect(feed.checkedAt).toBeNull();
  });

  it("does not advance the poll time or keep old events after a failed refresh", async () => {
    let fail = false;
    const adapter: CalendarAdapter = {
      async list() {
        if (fail) throw new Error("boom with details");
        return [event];
      },
    };
    const upcoming = await start_({ google: adapter }, { google: true }, ["google"]);
    expect(await upcoming()).toMatchObject({ error: null, checkedAt: T0, events: [event] });
    fail = true;
    now = T0 + 40_000;
    const feed = await upcoming({ refresh: true });
    expect(feed.checkedAt).toBe(T0);
    expect(feed.events).toEqual([]);
    expect(feed.error).toBe("Calendar feed could not be read");
  });

  it("refreshes a cached feed on request only once it is older than 30 seconds", async () => {
    const list = vi.fn(async () => [event]);
    const upcoming = await start_({ google: { list } }, { google: true }, ["google"]);
    await upcoming();
    expect(list).toHaveBeenCalledTimes(1);
    now = T0 + 29_000;
    await upcoming({ refresh: true });
    expect(list).toHaveBeenCalledTimes(1);
    now = T0 + 31_000;
    await upcoming();
    expect(list).toHaveBeenCalledTimes(1);
    expect((await upcoming({ refresh: true })).checkedAt).toBe(T0 + 31_000);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("marks the feed unavailable when a freeze event is dropped by an adapter", async () => {
    const client = new FakeClient({
      items: [
        {
          id: "freeze",
          summary: "Release freeze",
          start: { dateTime: start, timeZone: "Not/AZone" },
          end: { dateTime: end },
          extendedProperties: { private: { "phoenix.deployFreeze": "true" } },
        },
      ],
    });
    await expect(googleCalendar(client).list(start, end, signal)).rejects.toThrow(
      /could not be read/,
    );
    const upcoming = await start_({ google: googleCalendar(client) }, { google: true }, ["google"]);
    expect(await upcoming()).toMatchObject({
      events: [],
      error: expect.stringContaining("google"),
    });
  });

  it("reports unparseable and unidentifiable events as an unreadable feed", async () => {
    for (const row of [
      { id: "a", start: { dateTime: "garbage" }, end: { dateTime: end } },
      { summary: "no id", start: { dateTime: start }, end: { dateTime: end } },
    ])
      await expect(
        googleCalendar(new FakeClient({ items: [row] })).list(start, end, signal),
      ).rejects.toThrow(/could not be read/);
  });

  it("fails on provider pagination or truncation instead of cutting the feed", async () => {
    await expect(
      googleCalendar(new FakeClient({ items: [], nextPageToken: "more" })).list(start, end, signal),
    ).rejects.toThrow(/incomplete/);
    await expect(
      microsoftCalendar(new FakeClient({ value: [], "@odata.nextLink": "https://x" })).list(
        start,
        end,
        signal,
      ),
    ).rejects.toThrow(/incomplete/);
    const many = Array.from({ length: 501 }, (_, i) => ({
      id: String(i),
      start: { dateTime: start },
      end: { dateTime: end },
    }));
    await expect(
      googleCalendar(new FakeClient({ items: many })).list(start, end, signal),
    ).rejects.toThrow(/incomplete/);
  });
});

describe("freeze events and time zones", () => {
  it("allows freeze holds longer than 31 days but keeps the cap for ordinary events", () => {
    const long = { ...event, end: "2026-12-30T00:00:00.000Z" };
    expect(safeEvent(long)).toBeNull();
    expect(safeEvent({ ...long, deployFreeze: true })).toMatchObject({ deployFreeze: true });
  });

  it("reads offset-less Graph date-times in the event zone", async () => {
    const client = new FakeClient({
      value: [
        {
          id: "g",
          subject: "Local",
          start: { dateTime: "2026-10-22T10:00:00.0000000", timeZone: "America/New_York" },
          end: { dateTime: "2026-10-22T11:00:00.0000000", timeZone: "America/New_York" },
        },
      ],
    });
    const [result] = await microsoftCalendar(client).list(start, end, signal);
    expect(result).toMatchObject({
      start: "2026-10-22T14:00:00.000Z",
      end: "2026-10-22T15:00:00.000Z",
      timezone: "America/New_York",
    });
  });

  it("reads all-day Google dates at local midnight in the event zone", async () => {
    const client = new FakeClient({
      timeZone: "Asia/Tokyo",
      items: [
        {
          id: "allday",
          summary: "Holiday freeze",
          start: { date: "2026-12-24" },
          end: { date: "2026-12-25" },
          extendedProperties: { private: { "phoenix.deployFreeze": "true" } },
        },
      ],
    });
    const [result] = await googleCalendar(client).list(start, end, signal);
    expect(result).toMatchObject({
      start: "2026-12-23T15:00:00.000Z",
      end: "2026-12-24T15:00:00.000Z",
      timezone: "Asia/Tokyo",
      deployFreeze: true,
    });
  });

  it("converts across a DST change using the zone, not the host", () => {
    expect(instantIn("2026-03-08T12:00:00", "America/New_York")).toBe("2026-03-08T16:00:00.000Z");
    expect(instantIn("2026-03-07T12:00:00", "America/New_York")).toBe("2026-03-07T17:00:00.000Z");
    expect(instantIn("2026-10-22T12:00:00", "Not/AZone")).toBe("");
    expect(instantIn("2026-02-31", "UTC")).toBe("");
  });

  it("marks Google deploy freezes by private extended property or title prefix, not categories", async () => {
    const base = { start: { dateTime: start }, end: { dateTime: end } };
    const result = await googleCalendar(
      new FakeClient({
        items: [
          {
            id: "prop",
            summary: "A",
            ...base,
            extendedProperties: { private: { "phoenix.deployFreeze": "true" } },
          },
          {
            id: "prefix",
            summary: "[deploy-freeze] Quarter end",
            organizer: { self: true },
            ...base,
          },
          { id: "invited", summary: "[deploy-freeze] Stranger", ...base },
          { id: "cat", summary: "C", ...base, categories: ["deploy-freeze"] },
          {
            id: "shared",
            summary: "D",
            ...base,
            extendedProperties: { shared: { "phoenix.deployFreeze": "true" } },
          },
        ],
      }),
    ).list(start, end, signal);
    expect(result.map((e) => [e.id, e.deployFreeze])).toEqual([
      ["google:prop", true],
      ["google:prefix", true],
      ["google:invited", false],
      ["google:cat", false],
      ["google:shared", false],
    ]);
  });

  it("treats Graph personal sensitivity as private", async () => {
    const [result] = await microsoftCalendar(
      new FakeClient({
        value: [
          {
            id: "p",
            subject: "Therapy",
            sensitivity: "personal",
            start: { dateTime: start, timeZone: "UTC" },
            end: { dateTime: end, timeZone: "UTC" },
            attendees: [{ emailAddress: { address: "a@example.com" } }],
          },
        ],
      }),
    ).list(start, end, signal);
    expect(result).toMatchObject({ private: true, title: "Busy", attendees: [] });
  });
});
