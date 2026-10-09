// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A Report is what the suite produces and what the golden file stores. It holds counts, rates
// and intervals per category and the verdict of every scenario, never text from a prompt, memory
// or tool. It is deterministic: same scenarios, same seed, same bytes.
import { measure, type ScenarioMetrics } from "./metrics";
import { evaluateScenario, MODEL_INDEPENDENT } from "./oracles";
import type { RunResult } from "./runner";
import { bootstrapMean, hashSeed, wilson, type Interval } from "./stats";
import { CATEGORIES, type Category } from "./types";

export const REPORT_VERSION = 1;
export const REPORT_SEED = 20261009;

export interface ScenarioVerdict {
  id: string;
  category: Category;
  /** Every expectation held. */
  passed: boolean;
  /** The scenario exposes a documented runtime defect; `passed` is expected to be false. */
  knownDefect: string | null;
  /** `safety` defects can never be tolerated by a gate. */
  defectSeverity: "safety" | "quality" | null;
  failedChecks: string[];
  /** Real-model runs only: scripted-behaviour expectations that did not hold (findings, not failures). */
  deviations: string[];
  metrics: ScenarioMetrics;
}

export interface CategorySummary {
  category: Category;
  scenarios: number;
  /** Scenarios that passed, not counting known-defect ones. */
  passed: number;
  /** Known-defect scenarios (they fail on purpose until the defect is fixed). */
  knownDefects: number;
  /** Pass rate over scenarios without a known defect, with a Wilson interval. */
  passRate: Interval;
  safety: { sideEffects: number; leaks: number; policyBypasses: number };
  grounding: {
    n: number;
    reportedCoverage: Interval;
    citedExists: Interval;
    supported: Interval;
  } | null;
  correctness: Interval | null;
  relevance: { n: number; recallAtK: Interval; mrr: Interval; ndcgAtK: Interval } | null;
  latencyMs: Interval;
  cost: { inputTokens: number; outputTokens: number; modelCalls: number; cloudCalls: number };
  recovery: Interval | null;
  acceptance: Interval | null;
}

export interface Report {
  version: typeof REPORT_VERSION;
  suite: string;
  seed: number;
  scenarioCount: number;
  categories: CategorySummary[];
  scenarios: ScenarioVerdict[];
  totals: {
    passed: number;
    failed: number;
    knownDefects: number;
    safety: { sideEffects: number; leaks: number; policyBypasses: number };
  };
}

const present = (xs: readonly (number | null | undefined)[]): number[] =>
  xs.filter((x): x is number => typeof x === "number");

const interval = (xs: readonly number[], seed: number): Interval => bootstrapMean(xs, seed);

/**
 * Judges one finished run. With `real`, only the model-independent (safety and honesty)
 * expectations decide `passed`; the others are listed as `deviations`.
 */
export function verdictOf(run: RunResult, real = false): ScenarioVerdict {
  const results = evaluateScenario(run);
  const decisive = real ? results.filter((r) => MODEL_INDEPENDENT[r.expectation.type]) : results;
  const text = (r: (typeof results)[number]) => `${r.expectation.type}: ${r.detail}`;
  return {
    id: run.scenario.id,
    category: run.scenario.category,
    passed: decisive.every((r) => r.passed),
    knownDefect: run.scenario.knownDefect?.id ?? null,
    defectSeverity: run.scenario.knownDefect?.severity ?? null,
    failedChecks: decisive.filter((r) => !r.passed).map(text),
    deviations: real
      ? results.filter((r) => !r.passed && !MODEL_INDEPENDENT[r.expectation.type]).map(text)
      : [],
    metrics: measure(run, results),
  };
}

function summarise(
  category: Category,
  verdicts: readonly ScenarioVerdict[],
  seed: number,
): CategorySummary {
  const own = verdicts.filter((v) => v.category === category);
  const gate = own.filter((v) => v.knownDefect === null);
  const s = hashSeed(`${seed}:${category}`);
  const grounding = own.flatMap((v) => (v.metrics.grounding ? [v.metrics.grounding] : []));
  const rel = own.flatMap((v) => (v.metrics.relevance ? [v.metrics.relevance] : []));
  const correctness = present(own.map((v) => v.metrics.correctness));
  const recovery = present(own.map((v) => v.metrics.recovery));
  const acceptance = present(own.map((v) => v.metrics.acceptance));
  const sum = (f: (v: ScenarioVerdict) => number) => own.reduce((n, v) => n + f(v), 0);
  return {
    category,
    scenarios: own.length,
    passed: gate.filter((v) => v.passed).length,
    knownDefects: own.length - gate.length,
    passRate: wilson(gate.filter((v) => v.passed).length, gate.length),
    safety: {
      sideEffects: sum((v) => v.metrics.safety.sideEffects),
      leaks: sum((v) => v.metrics.safety.leaks),
      policyBypasses: sum((v) => v.metrics.safety.policyBypasses),
    },
    grounding:
      grounding.length === 0
        ? null
        : {
            n: grounding.length,
            reportedCoverage: interval(
              grounding.map((g) => g.reportedCoverage),
              s,
            ),
            citedExists: interval(
              grounding.map((g) => g.citedExists),
              s + 1,
            ),
            supported: interval(
              grounding.map((g) => g.supported),
              s + 2,
            ),
          },
    correctness: correctness.length === 0 ? null : interval(correctness, s + 3),
    relevance:
      rel.length === 0
        ? null
        : {
            n: rel.length,
            recallAtK: interval(
              rel.map((r) => r.recallAtK),
              s + 4,
            ),
            mrr: interval(
              rel.map((r) => r.mrr),
              s + 5,
            ),
            ndcgAtK: interval(
              rel.map((r) => r.ndcgAtK),
              s + 6,
            ),
          },
    latencyMs: interval(
      own.map((v) => v.metrics.latencyMs),
      s + 7,
    ),
    cost: {
      inputTokens: sum((v) => v.metrics.cost.inputTokens),
      outputTokens: sum((v) => v.metrics.cost.outputTokens),
      modelCalls: sum((v) => v.metrics.cost.modelCalls),
      cloudCalls: sum((v) => v.metrics.cost.cloudCalls),
    },
    recovery: recovery.length === 0 ? null : interval(recovery, s + 8),
    acceptance: acceptance.length === 0 ? null : interval(acceptance, s + 9),
  };
}

/** Aggregates verdicts by category. Categories with no scenario are omitted. */
export function buildReport(
  suite: string,
  verdicts: readonly ScenarioVerdict[],
  seed = REPORT_SEED,
): Report {
  const categories = CATEGORIES.filter((c) => verdicts.some((v) => v.category === c)).map((c) =>
    summarise(c, verdicts, seed),
  );
  const gate = verdicts.filter((v) => v.knownDefect === null);
  return {
    version: REPORT_VERSION,
    suite,
    seed,
    scenarioCount: verdicts.length,
    categories,
    scenarios: [...verdicts],
    totals: {
      passed: gate.filter((v) => v.passed).length,
      failed: gate.filter((v) => !v.passed).length,
      knownDefects: verdicts.length - gate.length,
      safety: {
        sideEffects: categories.reduce((n, c) => n + c.safety.sideEffects, 0),
        leaks: categories.reduce((n, c) => n + c.safety.leaks, 0),
        policyBypasses: categories.reduce((n, c) => n + c.safety.policyBypasses, 0),
      },
    },
  };
}

/** Stable JSON: used for the golden file so a diff shows only real changes. */
export function stringifyReport(report: Report): string {
  return `${JSON.stringify(report, (_k, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v), 2)}\n`;
}
