// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS, openDatabase, RECAP_OTHER_KEY, RecapStore, type Database } from "../src";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
function store() {
  const db = openDatabase(":memory:");
  dbs.push(db);
  return { db, recap: new RecapStore(db) };
}

describe("migration 28 and RecapStore", () => {
  it("is the head migration and the table holds counts only", () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 28, name: "recap_daily" });
    const { db } = store();
    const columns = (db.prepare("PRAGMA table_info(recap_daily)").all() as { name: string }[])
      .map((c) => c.name)
      .sort();
    expect(columns).toEqual(["day", "key", "metric", "value"]);
  });

  it("adds, takes the maximum, and rolls back a failed batch", () => {
    const { recap } = store();
    recap.bump("2026-10-26", [
      { metric: "steps", value: 2 },
      { metric: "longest_session_ms", value: 500, mode: "max" },
    ]);
    recap.bump("2026-10-26", [
      { metric: "steps", value: 3 },
      { metric: "longest_session_ms", value: 300, mode: "max" },
    ]);
    recap.bump("2026-10-26", [{ metric: "longest_session_ms", value: 900, mode: "max" }]);
    expect(recap.range("2026-10-26", "2026-10-26")).toEqual([
      { day: "2026-10-26", metric: "longest_session_ms", key: "", value: 900 },
      { day: "2026-10-26", metric: "steps", key: "", value: 5 },
    ]);
    // The second bump is invalid (negative): the first of the same batch must not stay.
    expect(() =>
      recap.bump("2026-10-27", [
        { metric: "steps", value: 1 },
        { metric: "files", value: -1 },
      ]),
    ).toThrow();
    expect(recap.range("2026-10-27", "2026-10-27")).toEqual([]);
  });

  it("range is inclusive on both ends and ordered", () => {
    const { recap } = store();
    for (const day of ["2026-10-25", "2026-10-26", "2026-11-01", "2026-11-02"])
      recap.bump(day, [{ metric: "steps", value: 1 }]);
    expect(recap.range("2026-10-26", "2026-11-01").map((r) => r.day)).toEqual([
      "2026-10-26",
      "2026-11-01",
    ]);
  });

  it("bounds the names kept per day: the rest is counted as (other)", () => {
    const { recap } = store();
    for (let i = 0; i < 5; i++)
      recap.bump("2026-10-26", [{ metric: "project_steps", key: `p${i}`, value: 1, maxKeys: 3 }]);
    // A known name keeps counting after the cap; a new name does not get a row.
    recap.bump("2026-10-26", [{ metric: "project_steps", key: "p0", value: 4, maxKeys: 3 }]);
    const rows = recap.range("2026-10-26", "2026-10-26");
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      [RECAP_OTHER_KEY, 2],
      ["p0", 5],
      ["p1", 1],
      ["p2", 1],
    ]);
    // The cap is per day: the next day starts fresh.
    recap.bump("2026-10-27", [{ metric: "project_steps", key: "p4", value: 1, maxKeys: 3 }]);
    expect(recap.range("2026-10-27", "2026-10-27")[0]!.key).toBe("p4");
  });

  it("deleteBefore and deleteAll report what they removed", () => {
    const { recap } = store();
    for (const day of ["2026-01-01", "2026-06-01", "2026-10-26"])
      recap.bump(day, [{ metric: "steps", value: 1 }]);
    expect(recap.deleteBefore("2026-06-01")).toBe(1);
    expect(recap.count()).toBe(2);
    expect(recap.deleteAll()).toBe(2);
    expect(recap.count()).toBe(0);
  });
});
