// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { buildMatchQuery, freshnessOf } from "../src";
import { T0, capture, rig } from "./helpers";

const find = (r: ReturnType<typeof rig>, words: string) =>
  r.store.search({ match: buildMatchQuery(words)!, limit: 10 });

describe("MemoryStore index", () => {
  it("finds stored text with stemming and ranks the better match first", () => {
    const r = rig();
    r.pipeline.capture(capture({ dedupeKey: "a", text: "database lock held during migration" }));
    r.pipeline.capture(capture({ dedupeKey: "b", text: "database lock lock lock everywhere" }));
    r.pipeline.capture(capture({ dedupeKey: "c", text: "unrelated styling change" }));
    const hits = find(r, "locks");
    expect(hits.map((h) => h.item.dedupeKey)).toEqual(["b", "a"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("forgetting an item removes it from the index, not just from the table", () => {
    const r = rig();
    r.pipeline.capture(capture({ dedupeKey: "a", text: "secret roadmap decision" }));
    r.pipeline.capture(capture({ dedupeKey: "b", text: "roadmap review notes" }));
    const id = find(r, "decision")[0]!.item.id;
    expect(r.store.forget(id)).toBe(true);
    expect(find(r, "decision")).toEqual([]);
    expect(find(r, "roadmap").map((h) => h.item.dedupeKey)).toEqual(["b"]);
    expect(r.store.indexedCount()).toBe(1);
    // The tombstone keeps no text or provenance.
    expect(r.store.get(id)).toMatchObject({ text: "", provenance: {}, deletedAt: T0 });
  });

  it("a forgotten fact is not captured again when its source repeats it", () => {
    const r = rig();
    r.pipeline.capture(capture());
    r.store.forget(find(r, "database")[0]!.item.id);
    expect(r.pipeline.capture(capture())).toEqual({ status: "tombstoned" });
    expect(find(r, "database")).toEqual([]);
    expect(r.store.indexedCount()).toBe(0);
  });

  it("the index and the live items stay the same size through insert, purge, forget and expire", () => {
    const r = rig();
    for (const k of ["a", "b", "c", "d"]) {
      r.pipeline.capture(capture({ dedupeKey: k, text: `note ${k}${k}`, sourceRef: k }));
    }
    r.pipeline.capture(
      capture({ dedupeKey: "w", text: "working note", contentType: "working", sourceRef: "w" }),
    );
    expect(r.store.indexedCount()).toBe(5);
    expect(r.store.purge({ source: "git", sourceRef: "a" })).toBe(1);
    r.store.forget(find(r, "bb")[0]!.item.id);
    r.clock.now = new Date("2026-10-10T10:00:00.000Z"); // working layer lives 1 day
    expect(r.store.expire()).toBe(1);
    expect(r.store.count()).toBe(2);
    expect(r.store.indexedCount()).toBe(2);
  });

  it("expired items disappear from search even before expire() runs", () => {
    const r = rig();
    r.pipeline.capture(capture({ text: "scratch idea", contentType: "working" }));
    expect(find(r, "scratch")).toHaveLength(1);
    r.clock.now = new Date("2026-10-09T10:00:01.000Z");
    expect(find(r, "scratch")).toEqual([]);
  });

  it("a permission filter runs before the limit, so hidden items never take a slot", () => {
    const r = rig();
    for (let i = 0; i < 5; i++) {
      r.pipeline.capture(
        capture({ dedupeKey: `h${i}`, scope: "repo:hidden", text: "needle needle needle" }),
      );
    }
    r.pipeline.capture(capture({ dedupeKey: "v", scope: "repo:visible", text: "needle" }));
    const hits = r.store.search({
      match: buildMatchQuery("needle")!,
      limit: 1,
      accept: (i) => i.scope === "repo:visible",
    });
    expect(hits.map((h) => h.item.dedupeKey)).toEqual(["v"]);
  });

  it("filters by domain and by observed window (end exclusive)", () => {
    const r = rig();
    r.pipeline.capture(capture({ dedupeKey: "a", observedAt: "2026-10-07T23:59:59.000Z" }));
    r.pipeline.capture(capture({ dedupeKey: "b", observedAt: "2026-10-08T00:00:00.000Z" }));
    r.pipeline.capture(capture({ dedupeKey: "c", observedAt: "2026-10-09T00:00:00.000Z" }));
    const hits = r.store.search({
      match: buildMatchQuery("database")!,
      limit: 10,
      domain: "git",
      observedFrom: "2026-10-08T00:00:00.000Z",
      observedBefore: "2026-10-09T00:00:00.000Z",
    });
    expect(hits.map((h) => h.item.dedupeKey)).toEqual(["b"]);
    expect(
      r.store.search({ match: buildMatchQuery("database")!, limit: 10, domain: "meeting" }),
    ).toEqual([]);
  });

  it("user text can never be read as FTS syntax", () => {
    const r = rig();
    r.pipeline.capture(capture({ text: "lock the database" }));
    expect(buildMatchQuery('lock" OR NEAR( * ) NOT -x')).toBe('"lock" OR "near" OR "not"');
    expect(() => find(r, 'lock" AND (')).not.toThrow();
    expect(buildMatchQuery("what did we decide about the")).toBeNull();
  });

  it("derives freshness from the last confirmation", () => {
    const item = { lastConfirmedAt: T0, freshnessTtlDays: 30 };
    expect(freshnessOf(item, new Date("2026-11-06T10:00:00.000Z"))).toBe("fresh");
    expect(freshnessOf(item, new Date("2026-11-07T10:00:00.000Z"))).toBe("stale");
    expect(freshnessOf({ ...item, freshnessTtlDays: null }, new Date("2030-01-01"))).toBe("fresh");
  });

  it("re-capturing confirms an item instead of duplicating it", () => {
    const r = rig();
    r.pipeline.capture(capture());
    r.clock.now = new Date("2026-10-20T10:00:00.000Z");
    const again = r.pipeline.capture(capture());
    expect(again).toMatchObject({
      status: "duplicate",
      item: { lastConfirmedAt: "2026-10-20T10:00:00.000Z", createdAt: T0 },
    });
    expect(r.store.count()).toBe(1);
    expect(r.store.indexedCount()).toBe(1);
  });
});
