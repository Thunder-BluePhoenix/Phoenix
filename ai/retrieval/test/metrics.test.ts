// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  distinctKeys,
  evaluateRetrieval,
  metricsForQuery,
  sliceByKind,
  sourceKey,
  type EvalQuery,
} from "../src";

const q = (relevant: string[], over: Partial<EvalQuery> = {}): EvalQuery => ({
  id: "q",
  query: "text",
  relevant,
  ...over,
});

describe("metricsForQuery", () => {
  it("computes recall@k, reciprocal rank and nDCG@k by hand-checked values", () => {
    // relevant a,b; returned: x a y b. k=3 -> only `a` (rank 2) is in the top 3.
    const m = metricsForQuery(q(["a", "b"]), ["x", "a", "y", "b"], 3);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.reciprocalRank).toBeCloseTo(0.5);
    expect(m.firstRelevantRank).toBe(2);
    // DCG = 1/log2(3); IDCG = 1/log2(2) + 1/log2(3)
    const dcg = 1 / Math.log2(3);
    const idcg = 1 + 1 / Math.log2(3);
    expect(m.ndcg).toBeCloseTo(dcg / idcg, 10);
  });

  it("a perfect ranking scores 1 on every metric", () => {
    const m = metricsForQuery(q(["a", "b"]), ["a", "b", "c"], 5);
    expect([m.recall, m.reciprocalRank, m.ndcg]).toEqual([1, 1, 1]);
  });

  it("a miss scores 0 and reports no rank", () => {
    const m = metricsForQuery(q(["a"]), ["x", "y"], 5);
    expect([m.recall, m.reciprocalRank, m.ndcg, m.firstRelevantRank]).toEqual([0, 0, 0, null]);
  });

  it("repeated sources count once: a second chunk of the same file is not a second hit", () => {
    expect(distinctKeys(["a", "a", "b", "a"])).toEqual(["a", "b"]);
    const m = metricsForQuery(q(["a", "b"]), ["a", "a", "a", "b"], 2);
    expect(m.recall).toBe(1);
    expect(m.firstRelevantRank).toBe(1);
  });

  it("rank beyond k still gives a reciprocal rank but no recall", () => {
    const m = metricsForQuery(q(["a"]), ["x", "y", "z", "a"], 2);
    expect(m.recall).toBe(0);
    expect(m.reciprocalRank).toBeCloseTo(0.25);
    expect(m.ndcg).toBe(0);
  });

  it("nDCG is at most 1 when more results are relevant than k", () => {
    const m = metricsForQuery(q(["a", "b", "c"]), ["a", "b", "c"], 2);
    expect(m.ndcg).toBeCloseTo(1);
    expect(m.recall).toBeCloseTo(2 / 3);
  });

  it("duplicate relevant keys do not inflate the denominator", () => {
    const m = metricsForQuery(q(["a", "a"]), ["a"], 5);
    expect(m.recall).toBe(1);
  });
});

describe("evaluateRetrieval", () => {
  const queries: EvalQuery[] = [
    { id: "1", query: "one", relevant: ["a"], kind: "exact" },
    { id: "2", query: "two", relevant: ["b"], kind: "paraphrase" },
  ];

  it("averages over queries and keeps per-query results", async () => {
    const answers: Record<string, string[]> = { one: ["a"], two: ["x", "b"] };
    const out = await evaluateRetrieval(
      queries,
      (query) => Promise.resolve(answers[query.query] ?? []),
      5,
    );
    expect(out).toMatchObject({ k: 5, queries: 2 });
    expect(out.recallAtK).toBe(1);
    expect(out.mrr).toBeCloseTo(0.75);
    expect(out.perQuery.map((p) => p.firstRelevantRank)).toEqual([1, 2]);
    expect(sliceByKind(out, "paraphrase")).toMatchObject({ queries: 1, mrr: 0.5 });
    expect(sliceByKind(out, "none").queries).toBe(0);
  });

  it("rejects a query without relevant sources, a bad k, and propagates retriever errors", async () => {
    await expect(
      evaluateRetrieval([{ id: "x", query: "x", relevant: [] }], () => Promise.resolve([])),
    ).rejects.toThrow(/no relevant source/);
    await expect(evaluateRetrieval(queries, () => Promise.resolve([]), 0)).rejects.toThrow(
      RangeError,
    );
    await expect(
      evaluateRetrieval(queries, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });

  it("an empty query list gives zeros, not NaN", async () => {
    const out = await evaluateRetrieval([], () => Promise.resolve([]));
    expect([out.recallAtK, out.mrr, out.ndcgAtK]).toEqual([0, 0, 0]);
  });

  it("sourceKey joins source and reference", () => {
    expect(sourceKey({ source: "git", sourceRef: "phoenix" })).toBe("git:phoenix");
  });
});
