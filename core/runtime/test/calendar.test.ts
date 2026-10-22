// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ItemStore } from "@phoenix/ai-meetings";
import { prepareMeeting, type CalendarEvent } from "@phoenix/capability-calendar";
import { MeetingStore, openDatabase } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { assertDeployAllowed, StoreMeetingPrepQuery } from "../src/calendar";

const AT = "2026-10-22T12:00:00.000Z";
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "cal:event",
  title: "Planning",
  start: AT,
  end: "2026-10-22T13:00:00.000Z",
  timezone: "UTC",
  attendees: ["Ada@example.com"],
  private: false,
  ...over,
});

describe("store-backed calendar prep", () => {
  it("returns only earlier, unarchived matching meetings and accepted decisions/open actions while allowed", async () => {
    const db = openDatabase(":memory:");
    try {
      const meetings = new MeetingStore(db);
      const items = new ItemStore(db);
      let allowed = false;
      const query = new StoreMeetingPrepQuery(
        meetings,
        { list: (id: string) => items.list(id) },
        () => allowed,
      );
      const addMeeting = (id: string, startedAt: string, participants: string[]) =>
        meetings.upsert({
          capabilityId: "kage",
          externalId: id,
          status: "ready",
          title: `Meeting ${id}`,
          startedAt,
          participants,
        })!.id;
      const earlier = addMeeting("prior", "2026-10-21T10:00:00.000Z", ["ada@example.com"]);
      const future = addMeeting("future", "2026-10-23T10:00:00.000Z", ["ada@example.com"]);
      const other = addMeeting("other", "2026-10-21T10:00:00.000Z", ["someone@example.com"]);
      const archived = addMeeting("archived", "2026-10-21T10:00:00.000Z", ["ada@example.com"]);
      meetings.archive(archived);
      const decision = items.insertManual(
        earlier,
        { kind: "decision", text: "Ship release", owner: null, due: null },
        "owner",
      )!;
      items.insertManual(
        earlier,
        { kind: "action_item", text: "Write docs", owner: null, due: null },
        "owner",
      );
      items.insertManual(
        other,
        { kind: "decision", text: "Private choice", owner: null, due: null },
        "owner",
      );
      items.insertManual(
        future,
        { kind: "decision", text: "Tomorrow", owner: null, due: null },
        "owner",
      );
      items.insertManual(
        archived,
        { kind: "decision", text: "Archived", owner: null, due: null },
        "owner",
      );
      expect(await prepareMeeting(event(), query)).toEqual({ decisions: [], actionItems: [] });
      expect(await query.reviewedItems([earlier])).toEqual([]);
      allowed = true;
      const prep = await prepareMeeting(event(), query);
      expect(prep).toEqual({
        decisions: [
          {
            text: "Ship release",
            href: `#/meetings/${encodeURIComponent(earlier)}`,
            meetingTitle: "Meeting prior",
          },
        ],
        actionItems: [
          {
            text: "Write docs",
            href: `#/meetings/${encodeURIComponent(earlier)}`,
            meetingTitle: "Meeting prior",
          },
        ],
      });
      expect(
        (await query.reviewedItems([earlier, other, future, archived])).some(
          (i) => i.id === decision.id,
        ),
      ).toBe(true);
      allowed = false;
      expect(
        await query.meetings({ participants: ["ada@example.com"], before: AT, limit: 40 }),
      ).toEqual([]);
      expect(await query.reviewedItems([earlier])).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("never treats a project label as evidence of a persisted project association", async () => {
    const db = openDatabase(":memory:");
    try {
      const meetings = new MeetingStore(db);
      meetings.upsert({
        capabilityId: "kage",
        externalId: "1",
        title: "Project Atlas",
        status: "ready",
        startedAt: "2026-10-21T10:00:00Z",
      });
      const query = new StoreMeetingPrepQuery(meetings, { list: () => [] }, () => true);
      expect(
        await query.meetings({ participants: [], project: "Atlas", before: AT, limit: 40 }),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("calendar deployment freeze", () => {
  const start = Date.parse(AT);
  const window = event({ deployFreeze: true });
  it("allows by default when no feed or freeze disabled", () => {
    expect(() => assertDeployAllowed(undefined, start)).not.toThrow();
    expect(() =>
      assertDeployAllowed({ enabled: false, checkedAt: 0, events: [window] }, start),
    ).not.toThrow();
  });
  it("blocks an enabled stale or future-dated feed", () => {
    for (const checkedAt of [start - 300_001, start + 1, Number.NaN]) {
      expect(() => assertDeployAllowed({ enabled: true, checkedAt, events: [] }, start)).toThrow(
        /stale/,
      );
    }
    expect(() =>
      assertDeployAllowed({ enabled: true, checkedAt: start - 300_000, events: [] }, start),
    ).not.toThrow();
  });
  it("blocks an enabled feed that is unavailable", () => {
    expect(() => assertDeployAllowed({ enabled: true, checkedAt: start }, start)).toThrow(
      /unavailable or stale/,
    );
  });
  it("applies adjacent half-open freeze windows", () => {
    const next = event({
      id: "next",
      start: window.end,
      end: "2026-10-22T14:00:00.000Z",
      deployFreeze: true,
    });
    const feed = { enabled: true, checkedAt: start, events: [window, next] };
    expect(() => assertDeployAllowed(feed, start - 1)).toThrow(/stale/);
    expect(() => assertDeployAllowed(feed, start)).toThrow(/freeze until/);
    expect(() =>
      assertDeployAllowed({ ...feed, checkedAt: Date.parse(window.end) }, Date.parse(window.end)),
    ).toThrow(/freeze until/);
    expect(() =>
      assertDeployAllowed({ ...feed, checkedAt: Date.parse(next.end) }, Date.parse(next.end)),
    ).not.toThrow();
    expect(() =>
      assertDeployAllowed(
        { ...feed, checkedAt: Date.parse(window.end), events: [window] },
        Date.parse(window.end),
      ),
    ).not.toThrow();
  });
  it("blocks with a typed SECURITY_POLICY_BLOCKED error, not a plain Error", () => {
    const blocked = (run: () => void) => {
      try {
        run();
      } catch (error) {
        return error;
      }
      return undefined;
    };
    for (const error of [
      blocked(() => assertDeployAllowed({ enabled: true, checkedAt: start }, start)),
      blocked(() =>
        assertDeployAllowed({ enabled: true, checkedAt: start, events: [window] }, start),
      ),
      blocked(() =>
        assertDeployAllowed(
          {
            enabled: true,
            checkedAt: start,
            events: [event({ deployFreeze: true, end: window.start })],
          },
          start,
        ),
      ),
    ]) {
      expect(error).toBeInstanceOf(PhoenixError);
      expect((error as PhoenixError).code).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
    }
  });
});
