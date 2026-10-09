// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The offline suite: every scenario against the real orchestrator, tool gateway, policy engine,
// permission gateway and audit log, with scripted models and counting fake capabilities. Runs in
// CI. A scenario marked as a known defect is expected to fail (`it.fails`) until the runtime is
// fixed, at which point the marker must be removed (the gate also checks that).
import { describe, expect, it } from "vitest";
import { evaluateGate, GATES } from "../src/gate";
import { GOLDEN_PATH, readReport } from "../src/golden";
import { evaluateScenario } from "../src/oracles";
import { runScenario } from "../src/runner";
import { ALL_SCENARIOS } from "../src/scenarios";
import { runSuite } from "../src/suite";
import { ADVERSARIAL, CATEGORIES } from "../src/types";

describe("scenarios", () => {
  for (const s of ALL_SCENARIOS) {
    const body = async () => {
      const run = await runScenario(s);
      const failed = evaluateScenario(run).filter((r) => !r.passed);
      expect(failed.map((f) => `${f.expectation.type}: ${f.detail}`)).toEqual([]);
    };
    (s.knownDefect ? it.fails : it)(s.id, body);
  }
});

describe("coverage of the suite itself", () => {
  it("has ids that are unique", () => {
    const ids = ALL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("has at least 3 scenarios in each adversarial category and a unicode variant where it makes sense", () => {
    for (const c of ADVERSARIAL) {
      const own = ALL_SCENARIOS.filter((s) => s.category === c);
      expect(own.length, c).toBeGreaterThanOrEqual(3);
    }
    const withUnicode = new Set(ALL_SCENARIOS.filter((s) => s.unicode).map((s) => s.category));
    for (const c of ADVERSARIAL.filter((x) => x !== "stale_memory")) {
      expect(withUnicode.has(c), `unicode variant in ${c}`).toBe(true);
    }
    expect(ALL_SCENARIOS.length).toBeGreaterThanOrEqual(24);
  });
  it("every adversarial scenario has at least one expectation about safety or honesty, not only about state", () => {
    for (const s of ALL_SCENARIOS.filter((x) => ADVERSARIAL.includes(x.category))) {
      const onlyState = s.expectations.every((e) => e.type === "state");
      expect(onlyState, s.id).toBe(false);
    }
  });
  it("categories are the nine named in the phase", () => {
    expect(CATEGORIES.length).toBe(9);
  });
});

describe("regression against the committed baseline", () => {
  it("a fresh run matches the golden report and passes the v0.4 gate", async () => {
    const golden = readReport(GOLDEN_PATH);
    expect(golden, "ai/evaluation/golden/offline-report.json is committed").not.toBeNull();
    const { report } = await runSuite("offline", ALL_SCENARIOS);

    // No defect is accepted: D1-D3 (stale memory, unsupported claims, a run that did not fail) were
    // fixed in ai/agents, so the unmodified v0.4 gate must pass.
    expect(evaluateGate({ report, baseline: golden }, GATES["v0.4"]!).failures).toEqual([]);
    expect(report.scenarios.filter((s) => s.knownDefect !== null)).toEqual([]);
    // Not only "no worse": the run is deterministic, so any drift means the golden file is stale.
    expect(report.scenarios.map((s) => [s.id, s.passed])).toEqual(
      golden?.scenarios.map((s) => [s.id, s.passed]),
    );
  }, 120_000);

  it("is deterministic: two runs give the same report", async () => {
    const small = ALL_SCENARIOS.filter((s) => s.category === "benchmark").slice(0, 3);
    const a = await runSuite("x", small);
    const b = await runSuite("x", small);
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
  });
});
