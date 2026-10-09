// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs the pre-registered benchmark against this repository's real git history and the committed
// GitHub fixtures, when the pinned revision is present (a full-depth checkout; CI's shallow jobs skip
// it, and the skip is reported by vitest as skipped, not hidden). The assertions are the expectations
// written in spec.ts, not numbers tuned to pass.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runBenchmark } from "./run";
import { PINNED_REV, git, pinnedRevAvailable } from "./spec";

const repo = resolve(__dirname, "../../../..");
const available = pinnedRevAvailable(repo);

describe.skipIf(!available)("pre-registered value benchmark (real data)", () => {
  it("the graph reads the same history the ground truth reads", async () => {
    const report = await runBenchmark(repo);
    expect(report.pinnedRev).toBe(PINNED_REV);
    expect(report.questions).toBe(36);
    expect(report.ingested.commits).toBe(
      Number(git(repo, "rev-list", "--count", PINNED_REV).trim()),
    );
  }, 120_000);

  it("holds the expectations written before the run", async () => {
    const report = await runBenchmark(repo);
    const cat = (c: string, s: "graph" | "B1" | "B2") => report.byCategory[c]?.[s].rPrecision ?? -1;
    // Graph answers what retrieval has no data for, by a wide margin.
    for (const c of ["touched", "multihop", "who"])
      expect(cat(c, "graph")).toBeGreaterThan(cat(c, "B1") + 0.5);
    // Retrieval wins where the graph has no text index: the graph must not claim lexical questions.
    expect(cat("lexical", "graph")).toBe(0);
    expect(cat("lexical", "B1")).toBe(1);
    // An explicit token is what bm25 is good at: the baselines tie the graph on ADR questions.
    expect(cat("adr_docs", "B1")).toBe(cat("adr_docs", "graph"));
    // Every CI commit that is not in the pinned history cannot be answered by the graph.
    expect(cat("ci_commit", "graph")).toBeLessThan(0.5);
    // The gate against best-case retrieval is NOT met by the graph alone; the combination is stronger than either.
    expect(report.gate.passed).toBe(false);
    expect(report.relationship["G+B2"]).toBeGreaterThan(report.relationship.B2);
    expect(report.relationship["G+B2"]).toBeGreaterThan(report.relationship.graph);
    expect(report.relationship.graph).toBeGreaterThan(report.relationship.B1 + 0.5);
  }, 120_000);
});
