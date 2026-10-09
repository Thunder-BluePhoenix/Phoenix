// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs the pre-registered benchmark (spec.ts) against the graph and the baselines and prints the
// numbers. Usage:  npx tsx ai/knowledge-graph/test/benchmark/run.ts [repo-path]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaseline, buildGraphSystem, combine, type System } from "./systems";
import {
  GATE_MARGIN,
  PINNED_REV,
  RELATIONSHIP_CATEGORIES,
  TOP_K,
  buildQuestions,
  loadTruth,
  mean,
  rPrecision,
  readFixture,
  recallAtK,
  type BenchQuestion,
  type Category,
} from "./spec";

export const SYSTEM_NAMES = ["graph", "B1", "B2", "G+B2"] as const;
export type SystemName = (typeof SYSTEM_NAMES)[number];

export interface QuestionResult {
  question: BenchQuestion;
  scores: Record<SystemName, { rPrecision: number; recall: number; returned: string[] }>;
}

export interface BenchmarkReport {
  specSha256: string;
  pinnedRev: string;
  questions: number;
  results: QuestionResult[];
  byCategory: Record<string, Record<SystemName, { rPrecision: number; recall: number }>>;
  relationship: Record<SystemName, number>;
  all: Record<SystemName, number>;
  record: Record<"B1" | "B2", { wins: number; ties: number; losses: number }>;
  gate: { margin: number; graphMinusB2: number; graphMinusB1: number; passed: boolean };
  ingested: { commits: number; docs: number; events: number };
  elapsedMs: { ingest: number; graphAnswers: number };
}

export async function runBenchmark(repo: string): Promise<BenchmarkReport> {
  const specPath = resolve(dirname(fileURLToPath(import.meta.url)), "spec.ts");
  const specSha256 = createHash("sha256").update(readFileSync(specPath)).digest("hex");
  const truth = loadTruth(repo);
  const fixtures = { runsJson: readFixture(repo, "runs.json") };
  const pullsJson = readFixture(repo, "pulls.json");
  const questions = buildQuestions(repo, truth, fixtures);

  const t0 = performance.now();
  const graph = await buildGraphSystem(repo, truth, fixtures, pullsJson);
  const b1 = await buildBaseline("B1", repo, truth, fixtures);
  const b2 = await buildBaseline("B2", repo, truth, fixtures);
  const ingest = performance.now() - t0;
  const systems: Record<SystemName, System> = {
    graph: graph.system,
    B1: b1.system,
    B2: b2.system,
    "G+B2": combine(graph.system, b2.system),
  };

  const results: QuestionResult[] = [];
  const t1 = performance.now();
  for (const question of questions) {
    const scores = {} as QuestionResult["scores"];
    for (const name of SYSTEM_NAMES) {
      const ranked = (await systems[name](question)).entities;
      scores[name] = {
        rPrecision: rPrecision(ranked, question.expected),
        recall: recallAtK(ranked, question.expected, TOP_K),
        returned: ranked.slice(0, TOP_K),
      };
    }
    results.push({ question, scores });
  }
  const graphAnswers = performance.now() - t1;

  const categories = [...new Set(questions.map((q) => q.category))];
  const byCategory: BenchmarkReport["byCategory"] = {};
  for (const c of categories) {
    const rows = results.filter((r) => r.question.category === c);
    byCategory[c] = Object.fromEntries(
      SYSTEM_NAMES.map((n) => [
        n,
        {
          rPrecision: mean(rows.map((r) => r.scores[n].rPrecision)),
          recall: mean(rows.map((r) => r.scores[n].recall)),
        },
      ]),
    ) as BenchmarkReport["byCategory"][string];
  }
  const rel = (n: SystemName): number =>
    mean(
      results
        .filter((r) =>
          (RELATIONSHIP_CATEGORIES as readonly Category[]).includes(r.question.category),
        )
        .map((r) => r.scores[n].rPrecision),
    );
  const relationship = Object.fromEntries(
    SYSTEM_NAMES.map((n) => [n, rel(n)]),
  ) as BenchmarkReport["relationship"];
  const all = Object.fromEntries(
    SYSTEM_NAMES.map((n) => [n, mean(results.map((r) => r.scores[n].rPrecision))]),
  ) as BenchmarkReport["all"];
  const record = (base: "B1" | "B2") => {
    let wins = 0;
    let ties = 0;
    let losses = 0;
    for (const r of results) {
      const d = r.scores.graph.rPrecision - r.scores[base].rPrecision;
      if (Math.abs(d) < 1e-9) ties++;
      else if (d > 0) wins++;
      else losses++;
    }
    return { wins, ties, losses };
  };
  const graphMinusB2 = relationship.graph - relationship.B2;
  const graphMinusB1 = relationship.graph - relationship.B1;
  return {
    specSha256,
    pinnedRev: PINNED_REV,
    questions: questions.length,
    results,
    byCategory,
    relationship,
    all,
    record: { B1: record("B1"), B2: record("B2") },
    gate: {
      margin: GATE_MARGIN,
      graphMinusB2,
      graphMinusB1,
      passed: graphMinusB2 >= GATE_MARGIN && graphMinusB1 > 0,
    },
    ingested: graph.ingested,
    elapsedMs: { ingest: Math.round(ingest), graphAnswers: Math.round(graphAnswers) },
  };
}

export function formatReport(r: BenchmarkReport): string {
  const f = (x: number): string => x.toFixed(3);
  const lines = [
    `spec sha256 ${r.specSha256}`,
    `pinned rev  ${r.pinnedRev}   questions ${r.questions}   ingested ${JSON.stringify(r.ingested)}   ${JSON.stringify(r.elapsedMs)} ms`,
    "",
    "R-precision / recall@10 by category",
    `${"category".padEnd(14)}${"n".padStart(3)}  ${SYSTEM_NAMES.map((n) => n.padStart(13)).join("")}`,
  ];
  for (const [c, row] of Object.entries(r.byCategory)) {
    const n = r.results.filter((x) => x.question.category === c).length;
    lines.push(
      `${c.padEnd(14)}${String(n).padStart(3)}  ${SYSTEM_NAMES.map((s) => `${f(row[s].rPrecision)}/${f(row[s].recall)}`.padStart(13)).join("")}`,
    );
  }
  lines.push(
    "",
    `relationship questions (touched, ci_for, ci_commit, multihop, who): ${SYSTEM_NAMES.map((n) => `${n} ${f(r.relationship[n])}`).join("   ")}`,
    `all ${r.questions} questions:                                              ${SYSTEM_NAMES.map((n) => `${n} ${f(r.all[n])}`).join("   ")}`,
    `graph vs B1 per question: ${JSON.stringify(r.record.B1)}   vs B2: ${JSON.stringify(r.record.B2)}`,
    `GATE: graph-B2 = ${f(r.gate.graphMinusB2)} (needs >= ${r.gate.margin}), graph-B1 = ${f(r.gate.graphMinusB1)} (needs > 0) -> ${r.gate.passed ? "PASSED" : "NOT PASSED"}`,
  );
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const repo = resolve(process.argv[2] ?? ".");
  const report = await runBenchmark(repo);
  console.log(formatReport(report));
  if (process.argv.includes("--detail")) {
    for (const r of report.results) {
      console.log(
        `\n[${r.question.category}] ${r.question.text}\n  expected ${JSON.stringify(r.question.expected.map((e) => e.slice(0, 12)))}`,
      );
      for (const n of SYSTEM_NAMES) {
        console.log(
          `  ${n.padEnd(5)} ${f3(r.scores[n].rPrecision)} ${JSON.stringify(r.scores[n].returned.map((e) => e.slice(0, 12)))}`,
        );
      }
    }
  }
}

function f3(x: number): string {
  return x.toFixed(2);
}
