// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createCalendarCapability, type CalendarEvent } from "@phoenix/capability-calendar";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const MINUTE = 60_000;

const meeting = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "fake:standup",
  title: "Daily standup",
  start: new Date(NOW + 3 * MINUTE).toISOString(),
  end: new Date(NOW + 33 * MINUTE).toISOString(),
  timezone: "UTC",
  attendees: [],
  private: false,
  ...over,
});

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

/** A real Core with the real calendar capability reading a fake in-memory calendar. */
async function boot(events: CalendarEvent[], enabled = true) {
  const capability = createCalendarCapability({
    adapters: { macos: { list: () => Promise.resolve(events) } },
    now: () => NOW,
    sleep: (_ms, abort) => {
      const wait = Promise.withResolvers<void>();
      abort.addEventListener("abort", () => wait.resolve(), { once: true });
      return wait.promise;
    },
  });
  core = await startCore({}, { capabilities: [capability] });
  const configured = await core.api("POST", "/api/capabilities/calendar/config", {
    config: { macos: true },
  });
  expect(configured.status).toBe(200);
  if (enabled)
    expect((await core.api("POST", "/api/capabilities/calendar/enable", {})).status).toBe(200);
  return core;
}

async function notifications(c: TestCore) {
  const res = await c.api("GET", "/api/notifications");
  return res.json.notifications as { title: string; body: string | null; eventType: string }[];
}

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 2_000; i++) {
    if (await done()) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  expect(await done()).toBe(true);
}

describe("a calendar reminder becomes a notification", () => {
  it("tells the user a meeting starts soon, once, and keeps it out of event history", async () => {
    const c = await boot([meeting()]);
    await until(async () => (await notifications(c)).length > 0);
    const [first] = await notifications(c);
    expect(first).toMatchObject({
      eventType: "calendar.meeting.starting_soon",
      title: "A meeting is starting soon",
    });
    expect(first!.body).toContain("Daily standup");
    // The reminder is ephemeral: it must not be stored as a durable event.
    const history = await c.api("GET", "/api/events?limit=200");
    expect(JSON.stringify(history.json).includes("calendar.meeting.starting_soon")).toBe(false);
    // Reading the feed again must not remind a second time.
    await c.api("POST", "/api/capabilities/calendar/commands/upcoming", {
      input: { refresh: true },
    });
    for (let i = 0; i < 200; i++) await new Promise<void>((r) => setImmediate(r));
    expect(await notifications(c)).toHaveLength(1);
  });

  it("stays silent for a private meeting, a cancelled one, one too far away, and a disabled calendar", async () => {
    const far = meeting({ id: "fake:far", start: new Date(NOW + 30 * MINUTE).toISOString() });
    const quiet = await boot([
      meeting({ id: "fake:private", private: true }),
      meeting({ id: "fake:cancelled", cancelled: true }),
      far,
    ]);
    // Give the first poll time to run; nothing must be announced.
    for (let i = 0; i < 300; i++) await new Promise<void>((r) => setImmediate(r));
    expect(await notifications(quiet)).toEqual([]);
    await quiet.runtime.stop();
    core = undefined;

    const off = await boot([meeting()], false);
    for (let i = 0; i < 300; i++) await new Promise<void>((r) => setImmediate(r));
    expect(await notifications(off)).toEqual([]);
  });

  it("shows the title only in the body and never more than the capability keeps of it", async () => {
    const c = await boot([meeting({ title: "T".repeat(400) })]);
    await until(async () => (await notifications(c)).length > 0);
    const [first] = await notifications(c);
    expect(first!.title).toBe("A meeting is starting soon");
    expect(first!.body).toBe(`calendar · ${"T".repeat(300)}`);
  });

  it("respects a muted calendar source", async () => {
    const c = await boot([meeting()], false);
    const muted = await c.api("POST", "/api/notifications/preferences", {
      muted_sources: ["calendar"],
    });
    expect(muted.status).toBe(200);
    expect((await c.api("POST", "/api/capabilities/calendar/enable", {})).status).toBe(200);
    for (let i = 0; i < 300; i++) await new Promise<void>((r) => setImmediate(r));
    expect(await notifications(c)).toEqual([]);
  });
});
