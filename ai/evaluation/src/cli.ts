// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
//   npx tsx ai/evaluation/src/cli.ts run [--update-golden]   run the offline suite, print per category
//   npx tsx ai/evaluation/src/cli.ts gate v0.4               verdict of a gate on the latest report
//   npx tsx ai/evaluation/src/cli.ts gates                   list the gates
//   PHOENIX_REAL_OLLAMA=1 npx tsx ai/evaluation/src/cli.ts real   categories a, b, g against llama3.2 (opt-in, never in CI)
//
// `gate` reads the report `run` last wrote (`ai/evaluation/golden/latest-report.json`); with
// `--golden` it judges the committed baseline instead. The exit code is 0 only when the gate passes.
import { evaluateGate, GATES, type GateVerdict } from "./gate";
import { GOLDEN_PATH, readReport, REAL_REPORT_PATH, writeReport } from "./golden";
import type { Report } from "./report";
import type { Category } from "./types";
import { OllamaProvider } from "@phoenix/ai-models";
import { runSuite } from "./suite";
import { ALL_SCENARIOS } from "./scenarios";
import { join } from "node:path";

/** Categories (a), (b) and (g) of the phase: injection, malicious tool output, hallucination. */
export const REAL_CATEGORIES: readonly Category[] = [
  "prompt_injection",
  "malicious_tool_output",
  "hallucination",
];

export const LATEST_PATH = join(import.meta.dirname, "../golden/latest-report.json");

export function formatReport(report: Report): string {
  const lines = [`Suite ${report.suite}: ${report.scenarioCount} scenarios, seed ${report.seed}`];
  for (const c of report.categories) {
    const g = c.grounding
      ? ` grounding cited ${c.grounding.citedExists.value.toFixed(2)} supported ${c.grounding.supported.value.toFixed(2)}`
      : "";
    lines.push(
      `  ${c.category.padEnd(24)} ${c.passed}/${c.scenarios - c.knownDefects} pass ` +
        `[${c.passRate.low.toFixed(2)}, ${c.passRate.high.toFixed(2)}]` +
        (c.knownDefects > 0 ? ` +${c.knownDefects} known defect(s)` : "") +
        ` side-effects ${c.safety.sideEffects} leaks ${c.safety.leaks} bypasses ${c.safety.policyBypasses}${g}`,
    );
  }
  return lines.join("\n");
}

export function formatVerdict(v: GateVerdict): string {
  const lines = [
    `Gate ${v.gate}${v.proposal ? " (PROPOSAL, not agreed)" : ""}: ${v.passed ? "PASSED" : "FAILED"}`,
    `  adversarial pass rate ${v.measured.adversarialPassRate.toFixed(3)}, benchmark ${v.measured.benchmarkPassRate.toFixed(3)}`,
    `  supported grounding ${v.measured.supportedGrounding?.toFixed(3) ?? "n/a"}, cited grounding ${v.measured.citedGrounding?.toFixed(3) ?? "n/a"}`,
    `  side effects ${v.measured.sideEffects}, leaks ${v.measured.leaks}, bypasses ${v.measured.policyBypasses}, cloud calls ${v.measured.cloudCalls}, known defects ${v.measured.knownDefects}`,
    ...v.failures.map((f) => `  FAIL: ${f}`),
    `  sign-off needed from: ${v.signOff.join(", ")}`,
  ];
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  if (command === "run") {
    const { report } = await runSuite("offline", ALL_SCENARIOS);
    writeReport(LATEST_PATH, report);
    if (argv.includes("--update-golden")) writeReport(GOLDEN_PATH, report);
    process.stdout.write(`${formatReport(report)}\n`);
    return 0;
  }
  if (command === "real") {
    // Opt-in: needs a local Ollama with llama3.2. Only llama3.2 is ever requested: Ollama's cloud
    // models forward prompts to a remote host and are refused by the provider anyway.
    if (process.env.PHOENIX_REAL_OLLAMA !== "1") {
      process.stderr.write("Set PHOENIX_REAL_OLLAMA=1 to run against a real local Ollama.\n");
      return 2;
    }
    const provider = new OllamaProvider({ chatModel: "llama3.2", generateTimeoutMs: 180_000 });
    const health = await provider.health();
    if (!health.available) {
      process.stderr.write(`Ollama is not available: ${health.detail}\n`);
      return 2;
    }
    const chosen = ALL_SCENARIOS.filter(
      (s) => REAL_CATEGORIES.includes(s.category) && s.subject !== "hostile",
    );
    const { report } = await runSuite("real-ollama", chosen, undefined, provider);
    writeReport(REAL_REPORT_PATH, report);
    process.stdout.write(`${formatReport(report)}\n`);
    for (const v of report.scenarios) {
      process.stdout.write(
        `  ${v.passed ? "ok  " : "FELL"} ${v.id}${v.passed ? "" : `: ${v.failedChecks.join("; ").slice(0, 200)}`}\n`,
      );
    }
    return 0;
  }
  if (command === "gates") {
    for (const g of Object.values(GATES)) {
      process.stdout.write(`${g.id}${g.proposal ? " (proposal)" : ""}: ${g.description}\n`);
    }
    return 0;
  }
  if (command === "gate" && arg !== undefined) {
    const gate = Object.hasOwn(GATES, arg) ? GATES[arg] : undefined;
    if (!gate) {
      process.stderr.write(
        `Unknown gate "${arg.slice(0, 20)}". Known: ${Object.keys(GATES).join(", ")}\n`,
      );
      return 2;
    }
    const report = readReport(argv.includes("--golden") ? GOLDEN_PATH : LATEST_PATH);
    if (!report) {
      process.stderr.write("No report yet: run `ai/evaluation/src/cli.ts run` first.\n");
      return 2;
    }
    const verdict = evaluateGate(
      { report, baseline: readReport(GOLDEN_PATH), realReport: readReport(REAL_REPORT_PATH) },
      gate,
    );
    process.stdout.write(`${formatVerdict(verdict)}\n`);
    return verdict.passed ? 0 : 1;
  }
  process.stderr.write(
    "usage: cli.ts run [--update-golden] | real | gate <v0.4|v0.5|v0.7|v1.0> [--golden] | gates\n",
  );
  return 2;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(
    (code) => void (process.exitCode = code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
