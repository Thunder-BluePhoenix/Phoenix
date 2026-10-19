// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  addDays,
  assertTimeZone,
  dayKeyOf,
  isDayKey,
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
