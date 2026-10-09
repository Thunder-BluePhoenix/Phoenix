// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ModelProvider } from "@phoenix/ai-models";
import { buildObservation, type ModelUse, type RunObservation } from "./observation";
import { buildReport, verdictOf, type Report, type ScenarioVerdict } from "./report";
import { runScenario, type RunResult } from "./runner";
import type { Scenario } from "./types";

export interface SuiteOutcome {
  report: Report;
  /** One observation per scenario that produced an agent run, by scenario id. */
  observations: Record<string, RunObservation>;
}

export function modelUseOf(run: RunResult): ModelUse | null {
  const log = run.world.modelLog;
  if (log.prompts.length === 0) return null;
  return {
    provider: run.world.providerId,
    model: run.world.modelName,
    locality: "local",
    calls: log.prompts.length,
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
  };
}

/** Runs every scenario in its own fresh world, one after another (deterministic order). */
export async function runSuite(
  suite: string,
  scenarios: readonly Scenario[],
  seed?: number,
  realProvider?: ModelProvider,
): Promise<SuiteOutcome> {
  const verdicts: ScenarioVerdict[] = [];
  const observations: Record<string, RunObservation> = {};
  for (const scenario of scenarios) {
    await runScenario(scenario, {
      ...(realProvider ? { realProvider } : {}),
      inspect: (run) => {
        verdicts.push(verdictOf(run, realProvider !== undefined));
        if (run.trace) {
          observations[scenario.id] = buildObservation({
            trace: run.trace,
            audit: run.audit,
            model: modelUseOf(run),
          });
        }
      },
    });
  }
  return { report: buildReport(suite, verdicts, seed), observations };
}
