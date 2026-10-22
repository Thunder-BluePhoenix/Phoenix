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
  ReminderBook,
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
