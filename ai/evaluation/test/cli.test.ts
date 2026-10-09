// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { formatReport, formatVerdict } from "../src/cli";
import { evaluateGate, GATES } from "../src/gate";
import { GOLDEN_PATH, readReport } from "../src/golden";

describe("cli output", () => {
  it("the verdict on the committed baseline names every failure and who signs off", () => {
    const report = readReport(GOLDEN_PATH);
    if (!report) throw new Error("no golden report");
    const verdict = evaluateGate({ report, baseline: report }, GATES["v0.4"]!);
    const text = formatVerdict(verdict);
    expect(text).toContain("Gate v0.4:");
    expect(text).toContain("sign-off needed from: project owner");
    // The three quality defects D1-D3 were fixed in ai/agents: the verdict is PASSED, none known.
    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(text).toContain("Gate v0.4: PASSED");
    expect(verdict.measured).toMatchObject({
      knownDefects: 0,
      sideEffects: 0,
      leaks: 0,
      policyBypasses: 0,
      cloudCalls: 0,
    });
  });
  it("a proposal gate says it is a proposal", () => {
    const report = readReport(GOLDEN_PATH);
    if (!report) throw new Error("no golden report");
    expect(formatVerdict(evaluateGate(report, GATES["v0.7"]!))).toContain("PROPOSAL, not agreed");
  });
  it("the report table has one line per category with its interval", () => {
    const report = readReport(GOLDEN_PATH);
    if (!report) throw new Error("no golden report");
    const lines = formatReport(report).split("\n");
    expect(lines).toHaveLength(report.categories.length + 1);
    expect(lines[1]).toMatch(/\[\d\.\d\d, \d\.\d\d\]/);
  });
});
