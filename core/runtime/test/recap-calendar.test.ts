// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  addDays,
  assertTimeZone,
  dayKeyOf,
  isDayKey,
  startOfDayMs,
  utcWindow,
  weekDays,
  weekStartOf,
} from "../src/recap-calendar";

const NY = "America/New_York";

describe("day keys", () => {
  it("are local to the zone, including the 25-hour day when clocks go back", () => {
    // 2026-11-01 is the US fall-back day: 00:30 EDT and 23:59 EST are the same local day.
    expect(dayKeyOf(Date.parse("2026-11-01T04:30:00Z"), NY)).toBe("2026-11-01");
    expect(dayKeyOf(Date.parse("2026-11-02T04:59:59Z"), NY)).toBe("2026-11-01");
    expect(dayKeyOf(Date.parse("2026-11-02T05:00:00Z"), NY)).toBe("2026-11-02");
    expect(dayKeyOf(Date.parse("2026-11-01T03:59:59Z"), NY)).toBe("2026-10-31");
  });

  it("are local to the zone, including the 23-hour day when clocks go forward", () => {
    // 2026-03-08: 02:00 EST jumps to 03:00 EDT.
    expect(dayKeyOf(Date.parse("2026-03-08T04:59:59Z"), NY)).toBe("2026-03-07");
    expect(dayKeyOf(Date.parse("2026-03-08T05:00:00Z"), NY)).toBe("2026-03-08");
    expect(dayKeyOf(Date.parse("2026-03-09T03:59:59Z"), NY)).toBe("2026-03-08");
    expect(dayKeyOf(Date.parse("2026-03-09T04:00:00Z"), NY)).toBe("2026-03-09");
  });

  it("differ from the UTC date east of Greenwich", () => {
    expect(dayKeyOf(Date.parse("2026-10-25T11:30:00Z"), "Pacific/Auckland")).toBe("2026-10-26");
    expect(dayKeyOf(Date.parse("2026-10-25T11:30:00Z"), "UTC")).toBe("2026-10-25");
  });

  it("rejects an unknown zone and invented dates", () => {
    expect(() => assertTimeZone("Mars/Olympus")).toThrow(RangeError);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-2-3")).toBe(false);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey(20261026)).toBe(false);
  });
});

describe("weeks start on Monday", () => {
  it("maps every day of a week to the same Monday, Sunday included", () => {
    for (const day of weekDays("2026-10-26")) expect(weekStartOf(day)).toBe("2026-10-26");
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
  });

  it("does not skip or repeat a day across a DST change", () => {
    expect(weekDays("2026-03-02")).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    expect(weekDays("2026-10-26").at(-1)).toBe("2026-11-01");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("reads a window wide enough for the most extreme zones", () => {
    const { since, until } = utcWindow("2026-10-26", "2026-11-01");
    // Auckland (+13) and Kiritimati (+14) midnight of the 26th is the 25th in UTC.
    expect(Date.parse("2026-10-25T10:00:00Z")).toBeGreaterThanOrEqual(Date.parse(since));
    // Honolulu (-10): the evening of the 1st is the 2nd in UTC.
    expect(Date.parse("2026-11-02T09:59:00Z")).toBeLessThan(Date.parse(until));
  });
});

describe("startOfDayMs", () => {
  const iso = (day: string, zone: string) => new Date(startOfDayMs(day, zone)).toISOString();

  it("is local midnight, in UTC terms, for fixed-offset and ordinary zones", () => {
    expect(iso("2026-10-21", "UTC")).toBe("2026-10-21T00:00:00.000Z");
    expect(iso("2026-10-21", NY)).toBe("2026-10-21T04:00:00.000Z");
    expect(iso("2026-12-21", NY)).toBe("2026-12-21T05:00:00.000Z");
    expect(iso("2026-10-21", "Asia/Kolkata")).toBe("2026-10-20T18:30:00.000Z");
    expect(iso("2026-10-21", "Pacific/Kiritimati")).toBe("2026-10-20T10:00:00.000Z");
    expect(iso("2026-10-21", "Pacific/Pago_Pago")).toBe("2026-10-21T11:00:00.000Z");
  });

  it("follows DST: the day after a 23- and a 25-hour day starts at the right instant", () => {
    // Spring forward: 2026-03-08 is 23 hours long, so the 9th starts 23 h after the 8th.
    expect(iso("2026-03-08", NY)).toBe("2026-03-08T05:00:00.000Z");
    expect(iso("2026-03-09", NY)).toBe("2026-03-09T04:00:00.000Z");
    // Fall back: 2026-11-01 is 25 hours long.
    expect(iso("2026-11-01", NY)).toBe("2026-11-01T04:00:00.000Z");
    expect(iso("2026-11-02", NY)).toBe("2026-11-02T05:00:00.000Z");
  });

  it("starts a day at 01:00 where the clocks skip midnight", () => {
    // Asia/Beirut moves 00:00 to 01:00 on the last Sunday of March (2026-03-29).
    expect(dayKeyOf(startOfDayMs("2026-03-29", "Asia/Beirut"), "Asia/Beirut")).toBe("2026-03-29");
    expect(dayKeyOf(startOfDayMs("2026-03-29", "Asia/Beirut") - 1, "Asia/Beirut")).toBe(
      "2026-03-28",
    );
    expect(iso("2026-03-29", "Asia/Beirut")).toBe("2026-03-28T22:00:00.000Z");
  });

  it("is the exact boundary of dayKeyOf in every tested zone", () => {
    for (const zone of [NY, "Europe/London", "Australia/Lord_Howe", "Pacific/Chatham", "UTC"]) {
      for (const day of ["2026-03-08", "2026-04-05", "2026-10-04", "2026-10-25", "2026-11-01"]) {
        const start = startOfDayMs(day, zone);
        expect(dayKeyOf(start, zone)).toBe(day);
        expect(dayKeyOf(start - 1, zone) < day).toBe(true);
      }
    }
  });
});
