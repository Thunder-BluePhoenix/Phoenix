// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The macOS seam with synthetic snapshots (no EventKit, no Mac): validation, clipping, state
// mapping, staleness, replace-not-append, and the capability reading it through `macosCalendar`.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanText,
  createCalendarCapability,
  MACOS_MAX_AGE_MS,
  MACOS_MAX_EVENTS,
  MacosCalendarFeed,
  MacosSnapshotError,
} from "../src";

const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function event(over: Record<string, unknown> = {}) {
  return {
    uid: "ev1",
    title: "Planning",
    start: iso(T0 + 10 * MIN),
    end: iso(T0 + 40 * MIN),
    timezone: "Europe/Berlin",
    attendees: ["a@example.com"],
    cancelled: false,
    deployFreeze: false,
    ...over,
  };
}
function snapshot(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    state: "authorized",
    from: iso(T0 - MIN),
    to: iso(T0 + 7 * 86_400_000),
    truncated: false,
    events: [event()],
    ...over,
  };
}
const ask = (feed: MacosCalendarFeed, from = T0 - MIN, to = T0 + 7 * 86_400_000) =>
  feed.runner.run(
    "calendar-read",
    ["--from", iso(from), "--to", iso(to), "--expand"],
    new AbortController().signal,
  );

describe("MacosCalendarFeed", () => {
  it("serves the held snapshot in the calendar-read contract", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(snapshot());
    const out = JSON.parse(await ask(feed)) as { events: { uid: string; title: string }[] };
    expect(out.events).toEqual([expect.objectContaining({ uid: "ev1", title: "Planning" })]);
  });

  it("replaces, never appends", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(snapshot());
    feed.submit(snapshot({ events: [event({ uid: "ev2" })] }));
    const out = JSON.parse(await ask(feed)) as { events: { uid: string }[] };
    expect(out.events.map((e) => e.uid)).toEqual(["ev2"]);
  });

  it("keeps the old snapshot when a new one is refused", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(snapshot());
    expect(() => feed.submit({ version: 1, state: "bogus" })).toThrow(MacosSnapshotError);
    expect(JSON.parse(await ask(feed)).events).toHaveLength(1);
  });

  it("refuses malformed, oversized and over-informative snapshots", () => {
    const feed = new MacosCalendarFeed(() => T0);
    const bad: unknown[] = [
      null,
      [],
      { ...snapshot(), version: 2 },
      snapshot({ state: "maybe" }),
      snapshot({ events: "x" }),
      snapshot({ events: Array.from({ length: MACOS_MAX_EVENTS + 1 }, () => event()) }),
      snapshot({ events: [event({ start: "tomorrow" })] }),
      snapshot({ events: [event({ attendees: ["not an email"] })] }),
      snapshot({ events: [event({ attendees: Array(9).fill("a@example.com") })] }),
      snapshot({ events: [event({ timezone: "../../etc" })] }),
      snapshot({ events: [event({ uid: "" })] }),
      snapshot({ events: [event({ cancelled: "no" })] }),
      snapshot({ state: "denied", events: [event()] }),
      snapshot({ from: iso(T0), to: iso(T0 - MIN) }),
      snapshot({ truncated: "x" }),
    ];
    for (const body of bad) expect(() => feed.submit(body), JSON.stringify(body)).toThrow();
    expect(feed.status().state).toBe("none");
  });

  it("clips titles and strips control and bidi characters; keeps nothing but the contract fields", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(
      snapshot({
        events: [
          event({
            title: `\u202eevil\u0007\u2066${"x".repeat(400)}`,
            notes: "secret",
            location: "home",
            attendeeNames: ["Bob"],
          }),
        ],
      }),
    );
    const [row] = JSON.parse(await ask(feed)).events as Record<string, unknown>[];
    expect(row?.title).toBe(`evil${"x".repeat(296)}`);
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["attendees", "cancelled", "deployFreeze", "end", "start", "timezone", "title", "uid"].sort(),
    );
    expect(cleanText("a\u200fb\nc", 10)).toBe("abc");
  });

  it("maps every access state to a fixed, content-free error", async () => {
    for (const [state, text] of [
      ["denied", "denied"],
      ["restricted", "restricted"],
      ["notDetermined", "not been granted"],
      ["writeOnly", "write-only"],
    ] as const) {
      const feed = new MacosCalendarFeed(() => T0);
      feed.submit(snapshot({ state, events: [] }));
      await expect(ask(feed)).rejects.toThrow(text);
    }
  });

  it("fails closed with no snapshot, a stale one, a truncated one or a window it does not cover", async () => {
    let now = T0;
    const feed = new MacosCalendarFeed(() => now);
    await expect(ask(feed)).rejects.toThrow("not received");
    feed.submit(snapshot());
    now = T0 + MACOS_MAX_AGE_MS + 1;
    expect(feed.status().stale).toBe(true);
    await expect(ask(feed)).rejects.toThrow("stale");
    now = T0;
    await expect(ask(feed, T0 - 2 * MIN)).rejects.toThrow("cover");
    feed.submit(snapshot({ truncated: true }));
    await expect(ask(feed)).rejects.toThrow("too many");
  });

  it("refuses any program but calendar-read", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(snapshot());
    await expect(feed.runner.run("sh", ["-c", "id"], new AbortController().signal)).rejects.toThrow(
      "not available",
    );
  });
});

describe("the calendar capability with a macOS feed", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  async function boot(feed: MacosCalendarFeed) {
    h = createHarness({
      modules: [
        createCalendarCapability({
          now: () => T0,
          macosFeed: feed,
          sleep: (_ms, abort) => {
            const w = Promise.withResolvers<void>();
            abort.addEventListener("abort", () => w.resolve(), { once: true });
            return w.promise;
          },
        }),
      ],
    });
    h.manager.configure("calendar", { macos: true });
    await h.enable("calendar");
    await h.drain();
    const op = await h.run("calendar", "upcoming", { refresh: true });
    expect(op.status).toBe("succeeded");
    return op.result as {
      events: { id: string; title: string; attendees: string[] }[];
      error: string | null;
    };
  }

  it("lists the snapshot's events as macos events", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(snapshot());
    const result = await boot(feed);
    expect(result.error).toBeNull();
    expect(result.events).toEqual([
      expect.objectContaining({ id: "macos:ev1", title: "Planning", attendees: ["a@example.com"] }),
    ]);
  });

  it("is unavailable, not empty, until the shell has sent a snapshot", async () => {
    const result = await boot(new MacosCalendarFeed(() => T0));
    expect(result.events).toEqual([]);
    expect(result.error).toContain("snapshot not received");
  });

  it("is unavailable when access was denied", async () => {
    const feed = new MacosCalendarFeed(() => T0);
    feed.submit(snapshot({ state: "denied", events: [] }));
    expect((await boot(feed)).error).toContain("denied");
  });
});
