// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// SQLite side of the evaluation harness (migration 14: eval_runs, eval_results). Synchronous,
// like the other stores. Rows hold ids, counts, numbers and verdicts only; `saveObservation`
// refuses anything that contains a string the caller names as a canary.
import type { Database } from "@phoenix/persistence";
import { observationLeaks, type RunObservation } from "./observation";
import type { Report, ScenarioVerdict } from "./report";

export type EvalKind = "offline" | "real" | "observation";

export interface EvalRunRow {
  id: string;
  kind: EvalKind;
  suite: string;
  startedAt: string;
  finishedAt: string | null;
  seed: number;
  scenarioCount: number;
  summary: Record<string, unknown>;
}

export interface EvalResultRow {
  id: number;
  evalRunId: string;
  scenarioId: string;
  category: string;
  passed: boolean;
  knownDefect: string | null;
  violations: Record<string, number>;
  metrics: Record<string, unknown>;
  agentRunId: string | null;
  observation: RunObservation | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

interface RunRecord {
  id: string;
  kind: EvalKind;
  suite: string;
  started_at: string;
  finished_at: string | null;
  seed: number;
  scenario_count: number;
  summary: string;
}
interface ResultRecord {
  id: number;
  eval_run_id: string;
  scenario_id: string;
  category: string;
  passed: number;
  known_defect: string | null;
  violations: string;
  metrics: string;
  agent_run_id: string | null;
  observation: string | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

export class ObservationLeakError extends Error {
  override name = "ObservationLeakError";
}

const parse = <T>(text: string): T => JSON.parse(text) as T;

function toRun(r: RunRecord): EvalRunRow {
  return {
    id: r.id,
    kind: r.kind,
    suite: r.suite,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    seed: r.seed,
    scenarioCount: r.scenario_count,
    summary: parse<Record<string, unknown>>(r.summary),
  };
}

function toResult(r: ResultRecord): EvalResultRow {
  return {
    id: r.id,
    evalRunId: r.eval_run_id,
    scenarioId: r.scenario_id,
    category: r.category,
    passed: r.passed === 1,
    knownDefect: r.known_defect,
    violations: parse<Record<string, number>>(r.violations),
    metrics: parse<Record<string, unknown>>(r.metrics),
    agentRunId: r.agent_run_id,
    observation: r.observation === null ? null : parse<RunObservation>(r.observation),
    latencyMs: r.latency_ms,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    createdAt: r.created_at,
  };
}

export interface ResultQuery {
  evalRunId?: string;
  scenarioId?: string;
  agentRunId?: string;
  /** Inclusive lower bound (ISO). */
  since?: string;
  /** Exclusive upper bound (ISO). */
  before?: string;
  limit?: number;
}

export class EvaluationStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Stores a report and its observations in one transaction. Returns the eval run id. */
  saveReport(
    id: string,
    kind: EvalKind,
    report: Report,
    observations: Record<string, RunObservation> = {},
    canaries: readonly string[] = [],
  ): string {
    for (const obs of Object.values(observations)) this.refuseLeaks(obs, canaries);
    const at = this.now().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO eval_runs (id, kind, suite, started_at, finished_at, seed, scenario_count, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          kind,
          report.suite,
          at,
          at,
          report.seed,
          report.scenarioCount,
          JSON.stringify({ totals: report.totals, categories: report.categories }),
        );
      const insert = this.db.prepare(
        `INSERT INTO eval_results (eval_run_id, scenario_id, category, passed, known_defect, violations, metrics,
           agent_run_id, observation, latency_ms, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const v of report.scenarios) {
        const obs = observations[v.id];
        insert.run(
          id,
          v.id,
          v.category,
          v.passed ? 1 : 0,
          v.knownDefect,
          JSON.stringify(v.metrics.safety),
          JSON.stringify(metricsJson(v)),
          obs?.runId ?? null,
          obs ? JSON.stringify(obs) : null,
          Math.round(v.metrics.latencyMs),
          v.metrics.cost.inputTokens,
          v.metrics.cost.outputTokens,
          at,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return id;
  }

  /** Stores the observation of one finished agent run (the "inspect a real run later" path). */
  saveObservation(obs: RunObservation, canaries: readonly string[] = []): number {
    this.refuseLeaks(obs, canaries);
    const at = this.now().toISOString();
    const runId = `obs_${obs.runId}`;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO eval_runs (id, kind, suite, started_at, finished_at, seed, scenario_count, summary) VALUES (?, 'observation', 'live', ?, ?, 0, 0, '{}')",
        )
        .run(runId, at, at);
      const r = this.db
        .prepare(
          `INSERT INTO eval_results (eval_run_id, scenario_id, category, passed, known_defect, violations, metrics,
             agent_run_id, observation, latency_ms, input_tokens, output_tokens, created_at)
           VALUES (?, ?, 'observation', ?, NULL, '{}', '{}', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          obs.taskId,
          obs.outcome === "COMPLETED" ? 1 : 0,
          obs.runId,
          JSON.stringify(obs),
          obs.totalDurationMs,
          obs.tokens.input,
          obs.tokens.output,
          at,
        );
      this.db.exec("COMMIT");
      return Number(r.lastInsertRowid);
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private refuseLeaks(obs: RunObservation, canaries: readonly string[]): void {
    const leaks = observationLeaks(obs, canaries);
    if (leaks.length > 0)
      throw new ObservationLeakError("an observation contained a canary string");
  }

  runs(limit = 50): EvalRunRow[] {
    return (
      this.db
        .prepare("SELECT * FROM eval_runs ORDER BY started_at DESC, rowid DESC LIMIT ?")
        .all(Math.min(Math.max(limit, 1), 500)) as unknown as RunRecord[]
    ).map(toRun);
  }

  run(id: string): EvalRunRow | undefined {
    const r = this.db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(id) as
      RunRecord | undefined;
    return r ? toRun(r) : undefined;
  }

  /** Newest `offline` run: what the gate reads. */
  latestRun(kind: EvalKind = "offline"): EvalRunRow | undefined {
    const r = this.db
      .prepare(
        "SELECT * FROM eval_runs WHERE kind = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
      )
      .get(kind) as RunRecord | undefined;
    return r ? toRun(r) : undefined;
  }

  results(q: ResultQuery = {}): EvalResultRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM eval_results
         WHERE (?1 IS NULL OR eval_run_id = ?1) AND (?2 IS NULL OR scenario_id = ?2)
           AND (?3 IS NULL OR agent_run_id = ?3) AND (?4 IS NULL OR created_at >= ?4)
           AND (?5 IS NULL OR created_at < ?5)
         ORDER BY created_at DESC, id DESC LIMIT ?6`,
      )
      .all(
        q.evalRunId ?? null,
        q.scenarioId ?? null,
        q.agentRunId ?? null,
        q.since ?? null,
        q.before ?? null,
        Math.min(Math.max(q.limit ?? 100, 1), 1000),
      ) as unknown as ResultRecord[];
    return rows.map(toResult);
  }

  /** The stored observation for an agent run, if one was saved. */
  observationFor(agentRunId: string): RunObservation | undefined {
    return this.results({ agentRunId, limit: 1 })[0]?.observation ?? undefined;
  }
}

function metricsJson(v: ScenarioVerdict): Record<string, unknown> {
  const m = v.metrics;
  return {
    correctness: m.correctness,
    grounding: m.grounding,
    relevance: m.relevance,
    recovery: m.recovery,
    acceptance: m.acceptance,
    cost: m.cost,
  };
}
