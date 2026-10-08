// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { parseQuestion, type Clock } from "../src";

/** 2026-10-08 is a Thursday. */
const at = (iso: string, timeZone = "UTC"): Clock => ({ now: () => new Date(iso), timeZone });
const THU = at("2026-10-08T12:00:00.000Z");

describe("parseQuestion", () => {
  it("what did we decide about X yesterday → topic X, yesterday's calendar day", () => {
    const p = parseQuestion("What did we decide about the database lock yesterday?", THU);
    expect(p.topicWords).toEqual(["database", "lock"]);
    expect(p.window).toEqual({
      from: "2026-10-07T00:00:00.000Z",
      before: "2026-10-08T00:00:00.000Z",
      label: "yesterday",
    });
    expect(p.topicText).not.toMatch(/yesterday/i);
  });

  it("today covers the whole local day, including later hours", () => {
    expect(parseQuestion("what happened today", THU).window).toMatchObject({
      from: "2026-10-08T00:00:00.000Z",
      before: "2026-10-09T00:00:00.000Z",
    });
  });

  it("last week is the previous Monday-to-Sunday week; this week starts at this Monday", () => {
    expect(parseQuestion("what changed last week", THU).window).toMatchObject({
      from: "2026-09-28T00:00:00.000Z",
      before: "2026-10-05T00:00:00.000Z",
    });
    expect(parseQuestion("what changed this week", THU).window).toMatchObject({
      from: "2026-10-05T00:00:00.000Z",
      before: "2026-10-09T00:00:00.000Z",
    });
    // On a Sunday, "last week" is still the week that ended the Sunday before.
    expect(parseQuestion("last week", at("2026-10-11T12:00:00.000Z")).window).toMatchObject({
      from: "2026-09-28T00:00:00.000Z",
      before: "2026-10-05T00:00:00.000Z",
    });
  });

  it("in the last N days runs from N days ago through today", () => {
    const p = parseQuestion("anything about kage in the last 3 days?", THU);
    expect(p.window).toEqual({
      from: "2026-10-05T00:00:00.000Z",
      before: "2026-10-09T00:00:00.000Z",
      label: "the last 3 days",
    });
    expect(p.topicWords).toEqual(["kage"]);
    expect(parseQuestion("last 1 day", THU).window?.label).toBe("the last 1 day");
    expect(parseQuestion("in the last 0 days", THU).window).toBeNull();
    expect(parseQuestion("in the last 99999 days", THU).window).toBeNull();
  });

  it("on <weekday> is the most recent such day before today; on the same weekday it is a week back", () => {
    expect(parseQuestion("what did we decide on Monday", THU).window).toMatchObject({
      from: "2026-10-05T00:00:00.000Z",
      before: "2026-10-06T00:00:00.000Z",
      label: "on monday",
    });
    expect(parseQuestion("on thursday", THU).window).toMatchObject({
      from: "2026-10-01T00:00:00.000Z",
      before: "2026-10-02T00:00:00.000Z",
    });
    expect(parseQuestion("on Friday", THU).window).toMatchObject({
      from: "2026-10-02T00:00:00.000Z",
    });
  });

  it("no time phrase → no window and the whole question is the topic", () => {
    const p = parseQuestion("how does the Kage bot supervisor work", THU);
    expect(p.window).toBeNull();
    expect(p.topicWords).toEqual(["kage", "bot", "supervisor", "work"]);
  });

  it("uses the user's time zone, not UTC, for where days begin", () => {
    // 2026-10-08 23:30 UTC is already Friday 2026-10-09 08:30 in Tokyo.
    const tokyo = at("2026-10-08T23:30:00.000Z", "Asia/Tokyo");
    expect(parseQuestion("yesterday", tokyo).window).toMatchObject({
      from: "2026-10-07T15:00:00.000Z",
      before: "2026-10-08T15:00:00.000Z",
    });
    // And the same instant in Los Angeles is still Thursday afternoon (UTC-7 in October).
    const la = at("2026-10-08T23:30:00.000Z", "America/Los_Angeles");
    expect(parseQuestion("yesterday", la).window).toMatchObject({
      from: "2026-10-07T07:00:00.000Z",
      before: "2026-10-08T07:00:00.000Z",
    });
  });

  it("handles a day with a daylight-saving change (25-hour day in Berlin)", () => {
    // Clocks went back on Sunday 2026-10-25; "yesterday" on Monday is that 25-hour Sunday.
    const berlin = at("2026-10-26T10:00:00.000Z", "Europe/Berlin");
    expect(parseQuestion("yesterday", berlin).window).toMatchObject({
      from: "2026-10-24T22:00:00.000Z",
      before: "2026-10-25T23:00:00.000Z",
    });
  });
});
