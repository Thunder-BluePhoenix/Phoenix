// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The hybrid relevance harness with a deterministic FAKE embedder (always runs in CI). It proves
// the wiring: the six docs are indexed, the hybrid retriever's vector leg contributes, and the same
// relevance metric scores lexical and hybrid. It says nothing about how good a real embedding model
// is: that is test/real-hybrid-relevance.test.ts (PHOENIX_REAL_OLLAMA=1, a release check).
import { describe, expect, it } from "vitest";
import {
  FakeParaphraseEmbedder,
  HYBRID_QUERIES,
  PARAPHRASE_QUERIES,
  runHybridRelevance,
} from "../src/hybrid-relevance";
import { evaluateScenario } from "../src/oracles";
import { runScenario } from "../src/runner";
import { ALL_SCENARIOS } from "../src/scenarios";
import { RELEVANCE_DOCS } from "../src/scenarios/benchmark";

describe("hybrid relevance harness (fake embedder)", () => {
  it("shares the six docs and the lexical scenario with the offline suite", () => {
    expect(RELEVANCE_DOCS).toHaveLength(6);
    const lexical = ALL_SCENARIOS.find((s) => s.id === "bench-retrieval-relevance");
    expect(lexical?.setup.memory).toBe(RELEVANCE_DOCS);
    expect(lexical?.retrieval?.k).toBe(3);
    expect(lexical?.retrieval?.queries.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
  });

  it("leaves the lexical scenario's numbers unchanged (recall@3 1.0, MRR 1.0)", async () => {
    const lexical = ALL_SCENARIOS.find((s) => s.id === "bench-retrieval-relevance")!;
    const run = await runScenario(lexical);
    expect(run.retrieval).toMatchObject({ recallAtK: 1, mrr: 1 });
    expect(evaluateScenario(run).filter((r) => !r.passed)).toEqual([]);
  });

  it("has paraphrase queries that lexical retrieval cannot answer", async () => {
    const r = await runHybridRelevance(new FakeParaphraseEmbedder());
    const lexical = r.byKind.paraphrase!.lexical;
    expect(lexical.queries).toBe(PARAPHRASE_QUERIES.length);
    expect(lexical.recallAtK).toBe(0);
    expect(lexical.mrr).toBe(0);
  });

  it("indexes every doc and uses the vector leg for every query", async () => {
    const r = await runHybridRelevance(new FakeParaphraseEmbedder());
    expect(r.indexed).toMatchObject({ embedded: 6, failed: 0, remaining: 0 });
    expect(r.vectorSkipped).toEqual([]);
    expect(r.hybrid.queries).toBe(HYBRID_QUERIES.length);
  });

  it("hybrid >= lexical on the paraphrase queries, and strictly better with the fake", async () => {
    const r = await runHybridRelevance(new FakeParaphraseEmbedder());
    const { lexical, hybrid } = r.byKind.paraphrase!;
    expect(hybrid.recallAtK).toBeGreaterThanOrEqual(lexical.recallAtK);
    expect(hybrid.mrr).toBeGreaterThanOrEqual(lexical.mrr);
    expect(hybrid.ndcgAtK).toBeGreaterThanOrEqual(lexical.ndcgAtK);
    expect(hybrid.recallAtK).toBe(1);
    expect(hybrid.mrr).toBe(1);
    expect(hybrid.recallAtK).toBeGreaterThan(lexical.recallAtK);
  });

  it("keeps the exact-keyword queries at least as good as lexical", async () => {
    const r = await runHybridRelevance(new FakeParaphraseEmbedder());
    const { lexical, hybrid } = r.byKind.exact!;
    expect(lexical.recallAtK).toBe(1);
    expect(hybrid.recallAtK).toBeGreaterThanOrEqual(lexical.recallAtK);
    expect(hybrid.mrr).toBeGreaterThanOrEqual(lexical.mrr);
    expect(r.hybrid.recallAtK).toBeGreaterThanOrEqual(r.lexical.recallAtK);
  });

  it("reports the fake's identity and a vector hit for each paraphrase", async () => {
    const embedder = new FakeParaphraseEmbedder();
    const r = await runHybridRelevance(embedder);
    expect(r.embedderKey).toBe("fake/paraphrase-table");
    for (const q of r.hybrid.perQuery.filter((m) => m.kind === "paraphrase")) {
      expect(q.firstRelevantRank, q.id).toBe(1);
    }
  });

  it("the fake maps each paraphrase near its doc and far from the other docs", async () => {
    const e = new FakeParaphraseEmbedder();
    const docs = await e.embedDocuments(RELEVANCE_DOCS.map((d) => d.text));
    const cos = (a: number[], b: number[]) => {
      const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
      return dot / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));
    };
    for (const [i, doc] of RELEVANCE_DOCS.entries()) {
      const q = PARAPHRASE_QUERIES.find((p) => p.relevant[0] === `project-docs:${doc.key}`)!;
      const qv = await e.embedQuery(q.query);
      expect(cos(qv, docs[i]!), q.id).toBeGreaterThan(0.95);
      docs.forEach((d, j) => {
        if (j !== i) expect(cos(qv, d), `${q.id} vs ${j}`).toBeLessThan(0.3);
      });
    }
  });
});
