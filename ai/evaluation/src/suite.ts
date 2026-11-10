// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ModelProvider } from "@phoenix/ai-models";
import { reliabilityOf } from "./metrics";
import { buildObservation, type ModelUse, type RunObservation } from "./observation";
import { buildReport, outcomeOf, verdictOf, type Report, type ScenarioVerdict } from "./report";
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

export const MIN_REPEAT = 1;
export const MAX_REPEAT = 20;

/** Validates a repeat count: an integer in 1..20. */
export function checkRepeat(n: number): number {
  if (!Number.isInteger(n) || n < MIN_REPEAT || n > MAX_REPEAT)
    throw new RangeError(`repeat must be an integer from ${MIN_REPEAT} to ${MAX_REPEAT}`);
  return n;
}

export interface SuiteOptions {
  /**
   * Runs each scenario this many times (1..20, default 1) against the SAME `realProvider`
   * instance, each run in its own fresh world, and adds `reliabilityOf` over the repeats to the
   * report. With 1 the report is byte-identical to a plain run. The verdict, metrics and
   * observation of a repeated scenario are those of its first run.
   */
  repeat?: number;
  /** Wall clock that times a real provider's calls. Inject a fixed one for byte-stable output. */
  now?: () => number;
}

/** Runs every scenario in its own fresh world, one after another (deterministic order). */
export async function runSuite(
  suite: string,
  scenarios: readonly Scenario[],
  seed?: number,
  realProvider?: ModelProvider,
  candidate?: { promptAddendum?: string; retrievalLimit?: number; maxFollowUps?: number },
  options: SuiteOptions = {},
): Promise<SuiteOutcome> {
  const repeat = checkRepeat(options.repeat ?? 1);
  const real = realProvider !== undefined;
  const verdicts: ScenarioVerdict[] = [];
  const observations: Record<string, RunObservation> = {};
  for (const scenario of scenarios) {
    const outcomes: ReturnType<typeof outcomeOf>[] = [];
    for (let i = 0; i < repeat; i++) {
      const first = i === 0;
      await runScenario(scenario, {
        ...(realProvider ? { realProvider } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(candidate ? { candidate } : {}),
        inspect: (run) => {
          if (repeat > 1) outcomes.push(outcomeOf(run));
          if (!first) return;
          verdicts.push(verdictOf(run, real));
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
    if (repeat > 1) {
      const verdict = verdicts[verdicts.length - 1]!;
      verdict.reliability = reliabilityOf(outcomes);
    }
  }
  return {
    report: buildReport(suite, verdicts, seed, repeat > 1 ? repeat : undefined),
    observations,
  };
}
