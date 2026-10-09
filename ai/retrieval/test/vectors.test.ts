// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { MeetingStore, openDatabase } from "@phoenix/persistence";
import { ingestMeetings } from "@phoenix/ai-memory";
import { describe, expect, it } from "vitest";
import { VectorDimensionError, VectorError, VectorStore, normalize } from "../src";
import { rig, type Rig } from "./helpers";

const MODEL = "toy/bow";

/** Adds a memory and stores a vector for it, as the indexer would. */
function addWithVector(r: Rig, key: string, text: string, vector: number[], model = MODEL): string {
  const id = r.add({ text, dedupeKey: key });
  expect(r.vectors.putMany(model, [{ id, text: r.store.get(id)!.text, vector }])).toBe(1);
  return id;
}

describe("normalize", () => {
  it("makes unit vectors and rejects unusable ones", () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(() => normalize([])).toThrow(VectorError);
    expect(() => normalize([0, 0])).toThrow(VectorError);
    expect(() => normalize([1, Number.NaN])).toThrow(VectorError);
    expect(() => normalize([1, Number.POSITIVE_INFINITY])).toThrow(VectorError);
  });
});

describe("VectorStore search", () => {
  it("ranks by cosine similarity, best first, and respects the limit", () => {
    const r = rig();
    const a = addWithVector(r, "a", "alpha", [1, 0, 0]);
    const b = addWithVector(r, "b", "beta", [0.9, 0.1, 0]);
    addWithVector(r, "c", "gamma", [0, 0, 1]);
    const { hits } = r.vectors.search(MODEL, [1, 0, 0], { limit: 2 });
    expect(hits.map((h) => h.memoryId)).toEqual([a, b]);
    expect(hits[0]!.similarity).toBeCloseTo(1);
    expect(hits[1]!.similarity).toBeCloseTo(0.9939, 3);
  });

  it("applies the permission filter before scoring: a refused item is not even scanned", () => {
    const r = rig();
    addWithVector(r, "a", "visible", [1, 0]);
    addWithVector(r, "b", "hidden", [1, 0.001]);
    const seen: string[] = [];
    const res = r.vectors.search(MODEL, [1, 0], {
      limit: 5,
      accept: (item) => {
        seen.push(item.scope);
        return false;
      },
    });
    expect(res).toMatchObject({ hits: [], scanned: 0 });
    expect(seen).toHaveLength(2);
  });

  it("does not let a filtered item use up the scan cap", () => {
    const r = rig();
    addWithVector(r, "old", "old visible", [1, 0], MODEL);
    for (let i = 0; i < 5; i++) {
      const id = r.add({ text: `secret ${i}`, dedupeKey: `s${i}`, scope: "repo:secret" });
      r.vectors.putMany(MODEL, [{ id, text: r.store.get(id)!.text, vector: [1, 0] }]);
    }
    const res = r.vectors.search(MODEL, [1, 0], {
      limit: 3,
      maxScan: 1,
      accept: (i) => i.scope !== "repo:secret",
    });
    expect(res.hits).toHaveLength(1);
  });

  it("says when the scan cap cut candidates off", () => {
    const r = rig();
    for (let i = 0; i < 4; i++) addWithVector(r, `k${i}`, `item ${i}`, [1, i]);
    const res = r.vectors.search(MODEL, [1, 0], { limit: 10, maxScan: 3 });
    expect(res).toMatchObject({ scanned: 3, truncated: true });
    expect(res.hits).toHaveLength(3);
    expect(r.vectors.search(MODEL, [1, 0], { limit: 10, maxScan: 4 }).truncated).toBe(false);
  });

  it("honours domain, time window and minimum similarity", () => {
    const r = rig();
    const old = r.add({
      text: "old doc",
      dedupeKey: "o",
      contentType: "doc",
      observedAt: "2026-01-01T00:00:00.000Z",
    });
    const fresh = addWithVector(r, "f", "fresh commit", [1, 0]);
    r.vectors.putMany(MODEL, [{ id: old, text: "old doc", vector: [1, 0] }]);
    expect(r.vectors.search(MODEL, [1, 0], { limit: 5, domain: "project" }).hits).toHaveLength(1);
    const recent = r.vectors.search(MODEL, [1, 0], {
      limit: 5,
      observedFrom: "2026-10-01T00:00:00.000Z",
    });
    expect(recent.hits.map((h) => h.memoryId)).toEqual([fresh]);
    expect(r.vectors.search(MODEL, [0, 1], { limit: 5, minSimilarity: 0.5 }).hits).toEqual([]);
  });

  it("returns nothing for a model without vectors", () => {
    const r = rig();
    addWithVector(r, "a", "alpha", [1, 0]);
    expect(r.vectors.search("other/model", [1, 0], { limit: 3 })).toEqual({
      hits: [],
      scanned: 0,
      truncated: false,
    });
  });
});

describe("models never mix", () => {
  it("queries only the active model's rows", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    r.vectors.putMany("m1/x", [{ id, text: "alpha", vector: [1, 0] }]);
    r.vectors.putMany("m2/y", [{ id, text: "alpha", vector: [0, 1] }]);
    expect(r.vectors.search("m1/x", [1, 0], { limit: 1 }).hits[0]!.similarity).toBeCloseTo(1);
    expect(r.vectors.search("m2/y", [1, 0], { limit: 1 }).hits[0]!.similarity).toBeCloseTo(0);
    expect(r.vectors.models()).toEqual([
      { model: "m1/x", dim: 2, count: 1 },
      { model: "m2/y", dim: 2, count: 1 },
    ]);
  });

  it("rejects a vector whose width differs from the model's stored width", () => {
    const r = rig();
    const a = r.add({ text: "alpha", dedupeKey: "a" });
    const b = r.add({ text: "beta", dedupeKey: "b" });
    r.vectors.putMany(MODEL, [{ id: a, text: "alpha", vector: [1, 0] }]);
    expect(() => r.vectors.putMany(MODEL, [{ id: b, text: "beta", vector: [1, 0, 0] }])).toThrow(
      VectorDimensionError,
    );
    expect(r.vectors.has(b, MODEL)).toBe(false);
  });

  it("rejects a mixed-width batch whole, and a query of the wrong width", () => {
    const r = rig();
    const a = r.add({ text: "alpha", dedupeKey: "a" });
    const b = r.add({ text: "beta", dedupeKey: "b" });
    expect(() =>
      r.vectors.putMany(MODEL, [
        { id: a, text: "alpha", vector: [1, 0] },
        { id: b, text: "beta", vector: [1, 0, 0] },
      ]),
    ).toThrow(VectorDimensionError);
    expect(r.vectors.count(MODEL)).toBe(0);
    r.vectors.putMany(MODEL, [{ id: a, text: "alpha", vector: [1, 0] }]);
    expect(() => r.vectors.search(MODEL, [1, 0, 0], { limit: 1 })).toThrow(VectorDimensionError);
  });

  it("the database refuses a blob whose length disagrees with dim", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    expect(() =>
      r.db
        .prepare(
          "INSERT INTO memory_vectors (memory_id, model, dim, vector, created_at) VALUES (?, 'm', 3, ?, 'x')",
        )
        .run(id, new Uint8Array(8)),
    ).toThrow(/CHECK/);
  });

  it("dropModel removes one model's rows only", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    r.vectors.putMany("m1/x", [{ id, text: "alpha", vector: [1, 0] }]);
    r.vectors.putMany("m2/y", [{ id, text: "alpha", vector: [1, 0] }]);
    expect(r.vectors.dropModel("m1/x")).toBe(1);
    expect(r.vectors.count("m2/y")).toBe(1);
  });
});

describe("a late embedding cannot resurrect a deleted memory's vector", () => {
  it("skips an item that was forgotten while its embedding was in flight", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    r.store.forget(id);
    expect(r.vectors.putMany(MODEL, [{ id, text: "alpha", vector: [1, 0] }])).toBe(0);
    expect(r.vectors.count(MODEL)).toBe(0);
  });

  it("skips an item whose text changed since it was read", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    expect(r.vectors.putMany(MODEL, [{ id, text: "different", vector: [1, 0] }])).toBe(0);
  });

  it("skips an item that has expired", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a", contentType: "working" });
    r.clock.now = new Date(r.clock.now.getTime() + 2 * 86_400_000);
    expect(r.vectors.putMany(MODEL, [{ id, text: "alpha", vector: [1, 0] }])).toBe(0);
  });
});

describe("deletion propagates to the vector index", () => {
  it("forget (tombstone) removes the vector and the item is never found again", () => {
    const r = rig();
    const id = addWithVector(r, "a", "alpha", [1, 0]);
    const keep = addWithVector(r, "b", "beta", [1, 0]);
    expect(r.store.forget(id)).toBe(true);
    expect(r.vectors.has(id, MODEL)).toBe(false);
    expect(r.vectors.has(keep, MODEL)).toBe(true);
    expect(r.vectors.search(MODEL, [1, 0], { limit: 5 }).hits.map((h) => h.memoryId)).toEqual([
      keep,
    ]);
    expect(r.vectors.orphanCount()).toBe(0);
  });

  it("hard delete (purge) removes the vector", () => {
    const r = rig();
    const id = addWithVector(r, "a", "alpha", [1, 0]);
    expect(r.store.purge({ source: "git" })).toBe(1);
    expect(r.vectors.has(id, MODEL)).toBe(false);
    expect(r.vectors.count(MODEL)).toBe(0);
  });

  it("raw DELETE of the row removes the vector too (the trigger, not the caller, does it)", () => {
    const r = rig();
    const id = addWithVector(r, "a", "alpha", [1, 0]);
    r.db.prepare("DELETE FROM memory_items WHERE id = ?").run(id);
    expect(r.vectors.count(MODEL)).toBe(0);
  });

  it("forgetWhere removes the vectors of exactly the items it tombstones", () => {
    const r = rig();
    const mine = addWithVector(r, "a", "alpha", [1, 0]);
    const other = r.add({ text: "beta", dedupeKey: "b", scope: "repo:other" });
    r.vectors.putMany(MODEL, [{ id: other, text: "beta", vector: [1, 0] }]);
    expect(r.store.forgetWhere({ accept: (i) => i.scope === "repo:phoenix" })).toBe(1);
    expect(r.vectors.has(mine, MODEL)).toBe(false);
    expect(r.vectors.has(other, MODEL)).toBe(true);
  });

  it("retention expire() removes the vectors of expired items", () => {
    const r = rig();
    const id = r.add({ text: "scratch note", dedupeKey: "w", contentType: "working" });
    r.vectors.putMany(MODEL, [{ id, text: "scratch note", vector: [1, 0] }]);
    // Expired but not yet tombstoned: hidden from search already.
    r.clock.now = new Date(r.clock.now.getTime() + 2 * 86_400_000);
    expect(r.vectors.search(MODEL, [1, 0], { limit: 5 }).hits).toEqual([]);
    expect(r.store.expire()).toBe(1);
    expect(r.vectors.has(id, MODEL)).toBe(false);
  });

  it("deleting a meeting removes its memories' vectors (meeting purge)", () => {
    const r = rig();
    const meetings = new MeetingStore(openDatabase(":memory:"));
    meetings.upsert({
      capabilityId: "kage",
      externalId: "7",
      status: "ready",
      title: "Standup",
      startedAt: "2026-10-07T09:00:00.000Z",
    });
    meetings.setSummary("kage:7", { text: "We agreed to ship it.", decisions: ["Ship it"] });
    const options = {
      pipeline: r.pipeline,
      store: r.store,
      meetings,
      capabilities: ["kage"],
    };
    expect(ingestMeetings(options).stored).toBe(2);
    for (const item of r.store.list({ limit: 10 })) {
      r.vectors.putMany(MODEL, [{ id: item.id, text: item.text, vector: [1, 0] }]);
    }
    expect(r.vectors.count(MODEL)).toBe(2);
    meetings.delete("kage:7");
    expect(ingestMeetings(options).removed).toBe(2);
    expect(r.vectors.count(MODEL)).toBe(0);
    expect(r.vectors.orphanCount()).toBe(0);
  });

  it("changing a memory's text drops its vector (the old vector described other text)", () => {
    const r = rig();
    const id = addWithVector(r, "a", "alpha", [1, 0]);
    r.db.prepare("UPDATE memory_items SET text = 'changed' WHERE id = ?").run(id);
    expect(r.vectors.has(id, MODEL)).toBe(false);
  });

  it("failure records go with the item", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    r.vectors.recordFailure(id, MODEL, "boom", () => 1000);
    expect(r.vectors.failures(MODEL)).toHaveLength(1);
    r.store.forget(id);
    expect(r.vectors.failures(MODEL)).toEqual([]);
  });

  it("a duplicate capture refreshes last_confirmed_at and keeps the vector", () => {
    const r = rig();
    const id = addWithVector(r, "a", "alpha", [1, 0]);
    // Capturing the same fact again is a duplicate, not an edit.
    r.pipeline.capture({
      source: "git",
      sourceRef: "phoenix",
      scope: "repo:phoenix",
      contentType: "commit",
      text: "alpha",
      observedAt: "2026-10-07T10:00:00.000Z",
      dedupeKey: "a",
      provenance: {},
    });
    r.store.confirm("git", "phoenix");
    expect(r.vectors.has(id, MODEL)).toBe(true);
  });
});

describe("pending and failure bookkeeping", () => {
  it("lists only live items without a vector for this model, by data class", () => {
    const r = rig();
    const a = r.add({ text: "alpha", dedupeKey: "a" });
    const b = r.add({ text: "beta", dedupeKey: "b" });
    r.add({ text: "meeting", dedupeKey: "m", contentType: "meeting_summary", source: "kage" });
    r.vectors.putMany(MODEL, [{ id: a, text: "alpha", vector: [1, 0] }]);
    expect(r.vectors.pending(MODEL, "internal", 10, 5).map((p) => p.id)).toEqual([b]);
    expect(r.vectors.pending(MODEL, "sensitive", 10, 5)).toHaveLength(1);
    expect(r.vectors.pending("other/model", "internal", 10, 5)).toHaveLength(2);
    expect(r.vectors.unembeddedCount(MODEL)).toBe(2);
  });

  it("backs off, parks after the maximum, and retryParked-style clearing re-enables", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    const f1 = r.vectors.recordFailure(id, MODEL, "x", (n) => 1000 * n);
    expect(f1.attempts).toBe(1);
    expect(r.vectors.pending(MODEL, "internal", 10, 3)).toEqual([]);
    r.clock.now = new Date(r.clock.now.getTime() + 1500);
    expect(r.vectors.pending(MODEL, "internal", 10, 3)).toHaveLength(1);
    r.vectors.recordFailure(id, MODEL, "x", () => 0);
    r.vectors.recordFailure(id, MODEL, "x", () => 0);
    expect(r.vectors.pending(MODEL, "internal", 10, 3)).toEqual([]); // parked at 3 attempts
    expect(r.vectors.clearFailures(MODEL)).toBe(1);
    expect(r.vectors.pending(MODEL, "internal", 10, 3)).toHaveLength(1);
  });

  it("a stored vector clears the item's failure record", () => {
    const r = rig();
    const id = r.add({ text: "alpha", dedupeKey: "a" });
    r.vectors.recordFailure(id, MODEL, "x", () => 0);
    r.vectors.putMany(MODEL, [{ id, text: "alpha", vector: [1, 0] }]);
    expect(r.vectors.failures(MODEL)).toEqual([]);
  });
});
