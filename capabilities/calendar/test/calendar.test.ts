// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  caldavCalendar,
  freezeAt,
  googleCalendar,
  macosCalendar,
  microsoftCalendar,
  prepareMeeting,
  MAX_REMINDER_RECORDS,
  ReminderBook,
  reminderKey,
  type ReminderStore,
  safeEvent,
  type CalendarClient,
  type CalendarEvent,
} from "../src";

const start = "2026-10-22T10:00:00.000Z";
const end = "2026-10-22T11:00:00.000Z";
const event: CalendarEvent = {
  id: "meeting:1",
  title: "Project review",
  start,
  end,
  timezone: "UTC",
  attendees: ["alex@example.com"],
  project: "phoenix",
  url: "https://example.com/meet",
  private: false,
};

class FakeClient implements CalendarClient {
  readonly requests: { path: string; headers?: Readonly<Record<string, string>> }[] = [];
  constructor(private readonly response: unknown) {}
  async get(path: string, headers?: Readonly<Record<string, string>>): Promise<unknown> {
    this.requests.push({ path, headers });
    return this.response;
  }
}

describe("provider adapters with injected fake clients", () => {
  it("reads expanded Google instances and skips cancelled occurrences", async () => {
    const client = new FakeClient({
      items: [
        {
          id: "original",
          recurringEventId: "series",
          originalStartTime: { dateTime: start },
          summary: "Standup",
          start: { dateTime: start },
          end: { dateTime: end },
          attendees: [{ email: "alex@example.com" }],
          htmlLink: "https://example.com/meeting",
        },
        { id: "gone", status: "cancelled", start: { dateTime: start }, end: { dateTime: end } },
      ],
    });
    const result = await googleCalendar(client).list(start, end, new AbortController().signal);
    expect(result).toEqual([
      expect.objectContaining({ id: `google:series:${start}`, title: "Standup" }),
    ]);
    expect(client.requests[0]?.path).toContain("singleEvents=true");
    expect(client.requests[0]?.path).toContain("timeMin=");
  });

  it("reads Microsoft calendarView with UTC preference and no cancelled entries", async () => {
    const client = new FakeClient({
      value: [
        {
          id: "instance",
          subject: "Freeze",
          start: { dateTime: start, timeZone: "UTC" },
          end: { dateTime: end, timeZone: "UTC" },
          categories: ["deploy-freeze"],
          attendees: [{ emailAddress: { address: "alex@example.com" } }],
        },
        { id: "cancelled", isCancelled: true, start: { dateTime: start }, end: { dateTime: end } },
      ],
    });
    expect(await microsoftCalendar(client).list(start, end, new AbortController().signal)).toEqual([
      expect.objectContaining({ id: "microsoft:instance", deployFreeze: true }),
    ]);
    expect(client.requests[0]?.path).toContain("calendarView?");
    expect(client.requests[0]?.headers).toEqual({ Prefer: 'outlook.timezone="UTC"' });
  });

  it("uses a restricted collection path for expanded CalDAV data", async () => {
    expect(() => caldavCalendar(new FakeClient({}), "/../private")).toThrow();
    const client = new FakeClient({
      events: [
        {
          uid: "series",
          recurrenceId: start,
          summary: "Busy",
          start,
          end,
          class: "PRIVATE",
          url: "javascript:alert(1)",
        },
      ],
    });
    const result = await caldavCalendar(client, "/calendars/primary").list(
      start,
      end,
      new AbortController().signal,
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: `caldav:series:${start}`,
        title: "Busy",
        private: true,
        attendees: [],
      }),
    ]);
    expect(client.requests[0]?.path).toContain("expand=true");
  });

  it("invokes only the injected macOS read runner with an abort signal", async () => {
    const signal = new AbortController().signal;
    const calls: unknown[][] = [];
    const adapter = macosCalendar({
      async run(program, args, passedSignal) {
        calls.push([program, args, passedSignal]);
        return JSON.stringify({ events: [{ uid: "local", title: "Local", start, end }] });
      },
    });
    expect(await adapter.list(start, end, signal)).toEqual([
      expect.objectContaining({ id: "macos:local", title: "Local" }),
    ]);
    expect(calls).toEqual([["calendar-read", ["--from", start, "--to", end, "--expand"], signal]]);
  });
});

describe("calendar event boundaries", () => {
  it("redacts private details and rejects unsafe links and invalid dates/timezones", () => {
    expect(safeEvent({ ...event, private: true, deployFreeze: true })).toEqual({
      id: event.id,
      title: "Busy",
      start,
      end,
      timezone: "UTC",
      attendees: [],
      private: true,
      cancelled: false,
      deployFreeze: false,
    });
    expect(safeEvent({ ...event, url: "https://user:secret@example.com/" })?.url).toBeUndefined();
    expect(
      safeEvent({
        ...event,
        url: "javascript:alert(1)",
        attendees: ["valid@example.com", "not-an-email"],
      })?.attendees,
    ).toEqual(["valid@example.com"]);
    expect(safeEvent({ ...event, end: start })).toBeNull();
    expect(safeEvent({ ...event, timezone: "Invalid/Zone" })).toBeNull();
    expect(safeEvent({ ...event, id: "" })).toBeNull();
  });

  it("honors half-open freeze windows and excludes private and cancelled holds", () => {
    const freeze = { ...event, deployFreeze: true };
    expect(freezeAt([freeze], Date.parse(start))).toEqual(freeze);
    expect(freezeAt([freeze], Date.parse(end))).toBeUndefined();
    expect(
      freezeAt(
        [
          { ...freeze, private: true },
          { ...freeze, cancelled: true },
        ],
        Date.parse(start),
      ),
    ).toBeUndefined();
  });

  it("issues each due reminder once, not after start or for private/cancelled events", () => {
    const book = new ReminderBook();
    const now = Date.parse(start) - 5 * 60_000;
    expect(
      book.due(
        [
          event,
          { ...event, id: "private", private: true },
          { ...event, id: "cancelled", cancelled: true },
        ],
        now,
      ),
    ).toEqual([event]);
    expect(book.due([event], now + 60_000)).toEqual([]);
    expect(new ReminderBook().due([event], Date.parse(start) + 1)).toEqual([]);
    expect(new ReminderBook().due([event], now - 1)).toEqual([]);
  });

  describe("persisted reminder keys", () => {
    const now = Date.parse(start) - 3 * 60_000;
    const memoryStore = (initial: unknown = null) => {
      const box = { value: initial, writes: 0 };
      const store: ReminderStore = {
        read: () => box.value,
        write: (value) => {
          box.value = JSON.parse(JSON.stringify(value));
          box.writes++;
        },
      };
      return { box, store };
    };

    it("does not remind again from a new book on the same store, but does for a new occurrence", () => {
      const { store } = memoryStore();
      expect(new ReminderBook(store).due([event], now)).toEqual([event]);
      const other = { ...event, id: "meeting:2" };
      expect(new ReminderBook(store).due([event, other], now + 1_000)).toEqual([other]);
      // A rescheduled occurrence (same id, new start) is a different reminder.
      const moved = { ...event, start: new Date(Date.parse(start) + 60_000).toISOString() };
      expect(new ReminderBook(store).due([moved], now + 1_000)).toEqual([moved]);
    });

    it("stores only a digest and the start time", () => {
      const { box, store } = memoryStore();
      new ReminderBook(store).due([event], now);
      expect(box.value).toEqual({
        version: 1,
        sent: [{ key: reminderKey(event), start: Date.parse(start) }],
      });
      const raw = JSON.stringify(box.value);
      for (const text of [event.title, event.id, "alex@example.com", "example.com/meet"])
        expect(raw).not.toContain(text);
    });

    it("drops records once the start has passed", () => {
      const { box, store } = memoryStore();
      const book = new ReminderBook(store);
      book.due([event], now);
      book.due([], Date.parse(start) + 1);
      expect(box.value).toEqual({ version: 1, sent: [] });
    });

    it("ignores corrupt or hostile stored values and bad entries", () => {
      const good = { key: reminderKey(event), start: Date.parse(start) };
      for (const bad of [
        undefined,
        null,
        "text",
        7,
        [],
        { version: 2, sent: [good] },
        { version: 1, sent: "x" },
        { version: 1, sent: [null, 3, "x", { key: "../../etc", start: 1 }, { key: good.key }] },
        { version: 1, sent: [{ key: good.key, start: Number.NaN }] },
        // A record dated far in the future must not suppress a real reminder forever.
        { version: 1, sent: [{ key: good.key, start: Date.parse(start) + 365 * 86_400_000 }] },
      ])
        expect(new ReminderBook(memoryStore(bad).store).due([event], now)).toEqual([event]);
      // A good entry next to bad ones still counts.
      expect(
        new ReminderBook(memoryStore({ version: 1, sent: [null, good] }).store).due([event], now),
      ).toEqual([]);
    });

    it("still reminds once when the store cannot be read or written, and never throws", () => {
      const store: ReminderStore = {
        read: () => {
          throw new Error("disk says Project review");
        },
        write: () => {
          throw new Error("disk full");
        },
      };
      const book = new ReminderBook(store);
      expect(book.due([event], now)).toEqual([event]);
      expect(book.due([event], now + 1_000)).toEqual([]);
    });

    it("keeps at most MAX_REMINDER_RECORDS records", () => {
      const { box, store } = memoryStore();
      const many = Array.from({ length: MAX_REMINDER_RECORDS + 40 }, (_, i) => ({
        ...event,
        id: `meeting:${i}`,
      }));
      expect(new ReminderBook(store).due(many, now)).toHaveLength(many.length);
      expect((box.value as { sent: unknown[] }).sent).toHaveLength(MAX_REMINDER_RECORDS);
    });
  });

  it("returns only reviewed accepted decisions and open actions from matching prior meetings", async () => {
    const prep = await prepareMeeting(event, {
      async meetings() {
        return [
          {
            id: "prior",
            title: "Earlier",
            at: "2026-10-21T10:00:00Z",
            participants: ["ALEX@example.com"],
          },
          {
            id: "unrelated",
            title: "Other",
            at: "2026-10-21T10:00:00Z",
            participants: ["other@example.com"],
          },
        ];
      },
      async reviewedItems() {
        return [
          {
            id: "1",
            meetingId: "prior",
            kind: "decision" as const,
            text: "Ship",
            status: "accepted" as const,
          },
          {
            id: "2",
            meetingId: "prior",
            kind: "action_item" as const,
            text: "Follow up",
            status: "edited" as const,
          },
          {
            id: "3",
            meetingId: "prior",
            kind: "action_item" as const,
            text: "Done",
            status: "accepted" as const,
            closed: true,
          },
          {
            id: "4",
            meetingId: "unrelated",
            kind: "decision" as const,
            text: "No",
            status: "accepted" as const,
          },
        ];
      },
    });
    expect(prep).toEqual({
      decisions: [{ text: "Ship", meetingTitle: "Earlier", href: "#/meetings/prior" }],
      actionItems: [{ text: "Follow up", meetingTitle: "Earlier", href: "#/meetings/prior" }],
    });
  });
});
