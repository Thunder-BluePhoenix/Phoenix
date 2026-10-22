// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ItemStore } from "@phoenix/ai-meetings";
import type { CalendarEvent } from "@phoenix/capability-calendar";
import { MeetingStore, openDatabase } from "@phoenix/persistence";
import { describe, expect, it, vi } from "vitest";
import { StoreMeetingPrepQuery } from "../src/calendar/prep-query";
import { CalendarService, type CalendarCapabilityHost } from "../src/calendar/service";
import { assertDeployAllowed } from "../src/calendar/freeze";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "provider:event",
  title: "Release review",
  start: "2026-10-22T13:00:00.000Z",
  end: "2026-10-22T14:00:00.000Z",
  timezone: "UTC",
  attendees: ["ada@example.com"],
  private: false,
  ...over,
});

function host(result: unknown, status = "enabled", freeze = true) {
  const get = vi.fn(() => ({ status, config: { freeze } }));
  const invokeAndWait = vi.fn(async () => ({ status: "succeeded", result }));
  return { get, invokeAndWait } satisfies CalendarCapabilityHost;
}

const noPrep = {
  meetings: vi.fn(async () => []),
  reviewedItems: vi.fn(async () => []),
};

const service = (capabilities: CalendarCapabilityHost) =>
  new CalendarService({ capabilities, prep: noPrep, now: () => NOW });

describe("authenticated calendar API service feed", () => {
  it("never invokes disabled capability or invents calendar events", async () => {
    const capabilities = host({ events: [event()], configured: true, checkedAt: NOW }, "disabled");
    expect(await service(capabilities).upcoming()).toMatchObject({
      enabled: false,
      events: [],
      prep: {},
    });
    expect(capabilities.invokeAndWait).not.toHaveBeenCalled();
    expect(await service(capabilities).freezeSnapshot()).toMatchObject({ enabled: false });
    expect(capabilities.invokeAndWait).not.toHaveBeenCalled();
  });

  it("holds no deployment unless the owner enabled calendar freeze", async () => {
    const capabilities = host(
      { configured: true, events: [event({ deployFreeze: true })], checkedAt: NOW, error: "down" },
      "enabled",
      false,
    );
    const snapshot = await service(capabilities).freezeSnapshot();
    expect(snapshot).toMatchObject({ enabled: false });
    expect(() => assertDeployAllowed(snapshot, NOW)).not.toThrow();
    expect(capabilities.invokeAndWait).not.toHaveBeenCalled();
  });

  it("reports unconfigured, unavailable and stale reads instead of showing old events", async () => {
    const unavailable = host({
      configured: true,
      events: [event()],
      checkedAt: NOW,
      error: "read failed",
    });
    expect(await service(unavailable).upcoming()).toMatchObject({
      status: "unavailable",
      events: [],
    });
    const snapshot = await service(unavailable).freezeSnapshot();
    expect(snapshot).toMatchObject({ enabled: true });
    expect(() => assertDeployAllowed(snapshot, NOW)).toThrow(/unavailable or stale/);
    expect(
      await service(
        host({ configured: true, events: [event()], checkedAt: NOW - 300_001, error: null }),
      ).upcoming(),
    ).toMatchObject({ status: "stale", events: [] });
    expect(
      await service(
        host({ configured: false, events: [], checkedAt: NOW, error: null }),
      ).upcoming(),
    ).toMatchObject({ enabled: true, status: "unconfigured", events: [] });
    expect(
      await service(
        host({ configured: true, events: [event()], checkedAt: NOW + 1, error: null }),
      ).upcoming(),
    ).toMatchObject({ status: "stale", events: [] });
    expect(await service(host(undefined)).upcoming()).toMatchObject({
      status: "unavailable",
      events: [],
    });
  });

  it("uses stored reviewed meeting items for public events, redacts private events", async () => {
    const db = openDatabase(":memory:");
    try {
      const meetings = new MeetingStore(db);
      const items = new ItemStore(db);
      const prior = meetings.upsert({
        capabilityId: "kage",
        externalId: "prior",
        status: "ready",
        title: "Prior review",
        startedAt: "2026-10-21T10:00:00.000Z",
        participants: ["ada@example.com"],
      })!.id;
      items.insertManual(
        prior,
        { kind: "decision", text: "Ship release", owner: null, due: null },
        "owner",
      );
      const capabilities = host({
        configured: true,
        checkedAt: NOW,
        error: null,
        events: [
          event({ deployFreeze: true, url: "https://calendar.example/meeting" }),
          event({
            id: "secret-id",
            private: true,
            title: "Private board meeting",
            url: "https://private.example/secret",
            deployFreeze: true,
            attendees: ["ada@example.com"],
          }),
          event({ id: "leaky", url: "https://user:password@calendar.example/secret" }),
          event({ id: "cancelled", cancelled: true }),
        ],
      });
      const calendar = new CalendarService({
        capabilities,
        prep: new StoreMeetingPrepQuery(meetings, { list: (id) => items.list(id) }, () => true),
        now: () => NOW,
      });
      const view = await calendar.upcoming();
      expect(view).toMatchObject({ enabled: true, status: "ready", prepComplete: true });
      expect(view.events).toHaveLength(3);
      expect(view.events[0]).toMatchObject({
        title: "Release review",
        deployFreeze: true,
        url: "https://calendar.example/meeting",
      });
      expect(view.prep["provider:event"]?.decisions).toEqual([
        {
          text: "Ship release",
          href: `#/meetings/${encodeURIComponent(prior)}`,
          meetingTitle: "Prior review",
        },
      ]);
      expect(view.events[1]).toMatchObject({ title: "Busy", private: true });
      expect(JSON.stringify(view)).not.toMatch(
        /secret-id|Private board meeting|private\.example|password/,
      );
      expect(view.events[1]).not.toHaveProperty("url");
      expect(view.events[1]).not.toHaveProperty("deployFreeze");
      expect(view.prep).not.toHaveProperty("secret-id");
      expect(view.events[2]).not.toHaveProperty("url");
      expect(capabilities.invokeAndWait).toHaveBeenCalledWith("calendar", "upcoming", {}, "user");
      const freeze = await calendar.freezeSnapshot();
      expect(() => assertDeployAllowed(freeze, NOW)).not.toThrow();
      expect(() => assertDeployAllowed(freeze, Date.parse(event().start))).toThrow(/stale/);
      expect(() =>
        assertDeployAllowed(
          { ...freeze, checkedAt: Date.parse(event().start) },
          Date.parse(event().start),
        ),
      ).toThrow(/freeze/);
    } finally {
      db.close();
    }
  });

  it("asks the capability for a refreshed feed whenever a freeze snapshot is needed", async () => {
    const capabilities = host({ configured: true, events: [], checkedAt: NOW, error: null });
    await service(capabilities).freezeSnapshot();
    expect(capabilities.invokeAndWait).toHaveBeenCalledWith(
      "calendar",
      "upcoming",
      { refresh: true },
      "user",
    );
  });

  it("exposes status, checkedAt and prepComplete for every feed state", async () => {
    const view = await service(
      host({ configured: true, events: [event()], checkedAt: NOW, error: null }),
    ).upcoming();
    expect(view).toMatchObject({ status: "ready", checkedAt: NOW, prepComplete: true });
  });

  it("marks the feed unavailable when the capability returns an event Core cannot read", async () => {
    const bad = host({
      configured: true,
      checkedAt: NOW,
      error: null,
      events: [event(), { id: "x", title: 5 }, event({ id: "tz", timezone: "Not/AZone" })],
    });
    expect(await service(bad).upcoming()).toMatchObject({ status: "unavailable", events: [] });
    const snapshot = await service(bad).freezeSnapshot();
    expect(snapshot.events).toBeUndefined();
    expect(() => assertDeployAllowed(snapshot, NOW)).toThrow(/unavailable or stale/);
  });

  it("keeps a freeze window longer than 31 days", async () => {
    const long = event({ deployFreeze: true, end: "2026-12-30T00:00:00.000Z" });
    const snapshot = await service(
      host({ configured: true, events: [long], checkedAt: NOW, error: null }),
    ).freezeSnapshot();
    expect(snapshot.events).toHaveLength(1);
  });
});
