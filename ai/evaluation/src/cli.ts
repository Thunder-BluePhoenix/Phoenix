// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
//   npx tsx ai/evaluation/src/cli.ts run [--update-golden] [--repeat N]   run the offline suite, print per category
//                                                            (--repeat N, 1..20: run each case N times, add reliability)
//   npx tsx ai/evaluation/src/cli.ts gate v0.4               verdict of a gate on the latest report
//   npx tsx ai/evaluation/src/cli.ts gates                   list the gates
//   PHOENIX_REAL_OLLAMA=1 npx tsx ai/evaluation/src/cli.ts real [--repeat N]   categories a, b, g against llama3.2 (opt-in, never in CI)
//
// `gate` reads the report `run` last wrote (`ai/evaluation/golden/latest-report.json`); with
// `--golden` it judges the committed baseline instead. The exit code is 0 only when the gate passes.
import { evaluateGate, GATES, type GateVerdict } from "./gate";
import { GOLDEN_PATH, readReport, REAL_REPORT_PATH, writeReport } from "./golden";
import type { Report } from "./report";
import type { Category, Scenario } from "./types";
import { OllamaProvider, type ModelProvider } from "@phoenix/ai-models";
import { checkRepeat, runSuite } from "./suite";
import { ALL_SCENARIOS } from "./scenarios";
import { join } from "node:path";

/** Categories (a), (b) and (g) of the phase: injection, malicious tool output, hallucination. */
export const REAL_CATEGORIES: readonly Category[] = [
  "prompt_injection",
  "malicious_tool_output",
  "hallucination",
];

export const LATEST_PATH = join(import.meta.dirname, "../golden/latest-report.json");
/** A real run is new evidence, not an automatic rewrite of the committed descriptive sample. */
export const REAL_LATEST_PATH = join(import.meta.dirname, "../golden/latest-real-report.json");

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
        ` side-effects ${c.safety.sideEffects} leaks ${c.safety.leaks} bypasses ${c.safety.policyBypasses}${g}` +
        (c.reliability
          ? ` reliability same-outcome ${c.reliability.sameOutcomeRate.toFixed(2)} recovered ${c.reliability.recoveredRate.toFixed(2)} (x${c.reliability.n})`
          : ""),
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
    ...(v.realQuality
      ? [
          `  real quality: ${v.realQuality.claims} claims, supported ${v.realQuality.supportedGrounding?.toFixed(3) ?? "n/a"}, cited ${v.realQuality.citedGrounding?.toFixed(3) ?? "n/a"}`,
          `  real categories: ${v.realQuality.categories.join(", ") || "none"}`,
          `  real scenarios: ${v.realQuality.scenarioIds.join(", ") || "none"}`,
        ]
      : []),
    ...v.failures.map((f) => `  FAIL: ${f}`),
    `  sign-off needed from: ${v.signOff.join(", ")}`,
  ];
  return lines.join("\n");
}

/**
 * Reads `--repeat N` / `--repeat=N`: an integer 1..20, default 1. Anything else throws RangeError.
 */
export function parseRepeat(argv: readonly string[]): number {
  const at = argv.findIndex((a) => a === "--repeat" || a.startsWith("--repeat="));
  if (at < 0) return 1;
  const raw = argv[at]!.startsWith("--repeat=")
    ? argv[at]!.slice("--repeat=".length)
    : argv[at + 1];
  if (raw === undefined || !/^\d+$/.test(raw))
    throw new RangeError("repeat must be an integer from 1 to 20");
  return checkRepeat(Number(raw));
}

/** Seams for tests; the real command passes none. */
export interface CliDeps {
  /** Replaces the scripted model of `run`: every repeat of every case calls this same instance. */
  provider?: ModelProvider;
  /** Fixed wall clock for timing `provider`'s calls. */
  now?: () => number;
  /** Cases to run (default: all). */
  scenarios?: readonly Scenario[];
  /** Where `run` writes its report; `null` writes nothing (default: the gitignored latest report). */
  latestPath?: string | null;
  out?: (text: string) => void;
}

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const [command, arg] = argv;
  const out = deps.out ?? ((t: string) => void process.stdout.write(t));
  if (command === "run") {
    let repeat: number;
    try {
      repeat = parseRepeat(argv);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    // A repeat-run report carries extra fields: it must never replace the committed baseline.
    if (argv.includes("--update-golden") && repeat > 1) {
      process.stderr.write("--update-golden cannot be combined with --repeat above 1\n");
      return 2;
    }
    const { report } = await runSuite(
      deps.provider ? "injected-provider" : "offline",
      deps.scenarios ?? ALL_SCENARIOS,
      undefined,
      deps.provider,
      undefined,
      { repeat, ...(deps.now ? { now: deps.now } : {}) },
    );
    const latest = deps.latestPath === undefined ? LATEST_PATH : deps.latestPath;
    if (latest !== null) writeReport(latest, report);
    if (argv.includes("--update-golden")) writeReport(GOLDEN_PATH, report);
    out(`${formatReport(report)}\n`);
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
    let repeat: number;
    try {
      repeat = parseRepeat(argv);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    const { report } = await runSuite("real-ollama", chosen, undefined, provider, undefined, {
      repeat,
    });
    writeReport(REAL_LATEST_PATH, report);
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
    const quality = argv.includes("--real-quality");
    const realCategories = argv
      .filter((x) => x.startsWith("--real-category="))
      .map((x) => x.slice("--real-category=".length));
    const realScenarioIds = argv
      .filter((x) => x.startsWith("--real-scenario="))
      .map((x) => x.slice("--real-scenario=".length));
    if (
      quality &&
      (!gate.proposal ||
        realCategories.length === 0 ||
        realScenarioIds.length === 0 ||
        realCategories.some((c) => !REAL_CATEGORIES.includes(c as Category)))
    ) {
      process.stderr.write(
        "Real quality needs a proposed gate, --real-category=<prompt_injection|malicious_tool_output|hallucination> and --real-scenario=<id>; owner acceptance is still required.\n",
      );
      return 2;
    }
    const verdict = evaluateGate(
      {
        report,
        baseline: readReport(GOLDEN_PATH),
        realReport: quality
          ? readReport(REAL_LATEST_PATH)
          : (readReport(REAL_LATEST_PATH) ?? readReport(REAL_REPORT_PATH)),
        ...(quality
          ? {
              realQuality: {
                requiredCategories: realCategories as Category[],
                requiredScenarioIds: realScenarioIds,
              },
            }
          : {}),
      },
      gate,
    );
    process.stdout.write(`${formatVerdict(verdict)}\n`);
    return verdict.passed ? 0 : 1;
  }
  process.stderr.write(
    "usage: cli.ts run [--update-golden] [--repeat N] | real [--repeat N] | gate <v0.4|v0.5|v0.7|v1.0> [--golden] [--real-quality --real-category=<category> --real-scenario=<id>] | gates\n",
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
