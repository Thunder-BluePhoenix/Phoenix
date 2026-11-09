// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A real Core: the desktop shell's EventKit snapshot arrives on POST /api/calendar/macos with the
// session token and the calendar capability serves it. Synthetic snapshots only; EventKit never ran.
import { MacosCalendarFeed } from "@phoenix/capability-calendar";
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

const iso = (ms: number) => new Date(ms).toISOString();
function snapshot(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    version: 1,
    state: "authorized",
    from: iso(now - 60_000),
    to: iso(now + 7 * 86_400_000),
    truncated: false,
    events: [
      {
        uid: "standup",
        recurrenceId: iso(now + 30 * 60_000),
        title: "Standup",
        start: iso(now + 30 * 60_000),
        end: iso(now + 60 * 60_000),
        timezone: "UTC",
        attendees: ["a@example.com"],
        cancelled: false,
        deployFreeze: false,
      },
    ],
    ...over,
  };
}

async function boot() {
  const feed = new MacosCalendarFeed();
  core = await startCore(
    {},
    {
      capabilities: builtinCapabilities("prod", undefined, undefined, { calendarMacos: feed }),
      runtime: { calendarMacos: feed },
    },
  );
  return core;
}

describe("POST /api/calendar/macos", () => {
  it("needs the session token", async () => {
    const c = await boot();
    const res = await c.api("POST", "/api/calendar/macos", snapshot(), { authorization: "" });
    expect(res.status).toBe(401);
    const get = await c.api("GET", "/api/calendar/macos", undefined, { authorization: "" });
    expect(get.status).toBe(401);
  });

  it("accepts a snapshot, reports status, and the calendar feed shows it", async () => {
    const c = await boot();
    expect((await c.api("GET", "/api/calendar/macos")).json).toMatchObject({ state: "none" });
    expect((await c.api("POST", "/api/calendar/macos", snapshot())).status).toBe(200);
    expect((await c.api("GET", "/api/calendar/macos")).json).toMatchObject({
      state: "authorized",
      events: 1,
      stale: false,
    });
    await c.api("POST", "/api/capabilities/calendar/config", { config: { macos: true } });
    await c.api("POST", "/api/capabilities/calendar/enable", {});
    let view: any;
    for (let i = 0; i < 100 && view?.status !== "ready"; i++) {
      view = (await c.api("GET", "/api/calendar/upcoming")).json;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(view.status).toBe("ready");
    expect(view.events.map((e: { title: string }) => e.title)).toEqual(["Standup"]);
  });

  it("refuses a bad snapshot with 400 and a fixed message, keeping the old one", async () => {
    const c = await boot();
    await c.api("POST", "/api/calendar/macos", snapshot());
    const bad = await c.api("POST", "/api/calendar/macos", snapshot({ state: "bogus" }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).not.toContain("Standup");
    expect((await c.api("GET", "/api/calendar/macos")).json).toMatchObject({ events: 1 });
    const big = await c.api("POST", "/api/calendar/macos", {
      ...snapshot(),
      events: Array.from({ length: 101 }, () => snapshot().events[0]),
    });
    expect(big.status).toBe(400);
  });

  it("a denied state is reported as an unavailable feed, never an empty calendar", async () => {
    const c = await boot();
    await c.api("POST", "/api/calendar/macos", snapshot({ state: "denied", events: [] }));
    await c.api("POST", "/api/capabilities/calendar/config", { config: { macos: true } });
    await c.api("POST", "/api/capabilities/calendar/enable", {});
    let view: any;
    for (let i = 0; i < 100 && view?.status !== "unavailable"; i++) {
      view = (await c.api("GET", "/api/calendar/upcoming")).json;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(view.status).toBe("unavailable");
    expect(view.events).toEqual([]);
  });
});
