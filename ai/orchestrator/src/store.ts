// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import {
  isAgentRunState,
  type AgentRun,
  type AgentRunState,
  type AgentTask,
  type Evidence,
  type EvidenceKind,
} from "@phoenix/protocol";
import type { Conclusion } from "./types";
import type { Verification } from "@phoenix/protocol";

export type StepKind = "stage" | "tool_call";

export interface StoredStep {
  seq: number;
  runId: string;
  kind: StepKind;
  /** Stage name, or tool name for a tool call. */
  name: string;
  status: string;
  /** Ids, counts and names only. */
  detail: Record<string, unknown>;
  policyAuditId: number | null;
  decision: string | null;
  risk: string | null;
  stageAuditId: number | null;
  startedAt: string;
  finishedAt: string;
}

export type NewStep = Omit<StoredStep, "seq">;

/** What a finished run concluded. Stored as JSON on the run. */
export interface StoredOutcome {
  conclusion: Conclusion | null;
  verification: Verification | null;
  toolCalls: number;
}

export interface StoredRun extends AgentRun {
  agentVersion: string;
  outcome: StoredOutcome | null;
}

interface TaskRow {
  id: string;
  kind: string;
  input: string;
  requested_by: string;
  correlation_id: string;
  created_at: string;
}

interface RunRow {
  id: string;
  task_id: string;
  agent_id: string;
  agent_version: string;
  state: string;
  failure_reason: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

interface RunIdRow {
  run_id: string;
}

interface StepRow {
  seq: number;
  run_id: string;
  kind: StepKind;
  name: string;
  status: string;
  detail: string;
  policy_audit_id: number | null;
  decision: string | null;
  risk: string | null;
  stage_audit_id: number | null;
  started_at: string;
  finished_at: string;
}

interface EvidenceRow {
  id: string;
  kind: EvidenceKind;
  source: string;
  excerpt_hash: string;
  excerpt: string;
  truncated: number;
}

const toTask = (r: TaskRow): AgentTask => ({
  id: r.id,
  kind: r.kind,
  input: JSON.parse(r.input) as Record<string, unknown>,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  correlationId: r.correlation_id,
});

function toRun(r: RunRow): StoredRun {
  if (!isAgentRunState(r.state)) throw new Error(`Stored run ${r.id} has an unknown state`);
  return {
    id: r.id,
    taskId: r.task_id,
    agentId: r.agent_id,
    agentVersion: r.agent_version,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.failure_reason === null ? {} : { failureReason: r.failure_reason }),
    outcome: r.outcome === null ? null : (JSON.parse(r.outcome) as StoredOutcome),
  };
}

/** SQLite side of the agent trace (migration 8). Synchronous, like the other stores. */
export class AgentStore {
  constructor(private readonly db: Database) {}

  insertTask(task: AgentTask): void {
    this.db
      .prepare(
        "INSERT INTO agent_tasks (id, kind, input, requested_by, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        task.id,
        task.kind,
        JSON.stringify(task.input),
        task.requestedBy,
        task.correlationId,
        task.createdAt,
      );
  }

  insertRun(run: AgentRun, agentVersion: string): void {
    this.db
      .prepare(
        "INSERT INTO agent_runs (id, task_id, agent_id, agent_version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(run.id, run.taskId, run.agentId, agentVersion, run.state, run.createdAt, run.updatedAt);
  }

  setRunState(runId: string, state: AgentRunState, at: string, failureReason?: string): void {
    this.db
      .prepare(
        "UPDATE agent_runs SET state = ?, updated_at = ?, failure_reason = COALESCE(?, failure_reason) WHERE id = ?",
      )
      .run(state, at, failureReason ?? null, runId);
  }

  setOutcome(runId: string, outcome: StoredOutcome): void {
    this.db
      .prepare("UPDATE agent_runs SET outcome = ? WHERE id = ?")
      .run(JSON.stringify(outcome), runId);
  }

  addStep(step: NewStep): number {
    const result = this.db
      .prepare(
        `INSERT INTO agent_steps
           (run_id, kind, name, status, detail, policy_audit_id, decision, risk, stage_audit_id, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        step.runId,
        step.kind,
        step.name,
        step.status,
        JSON.stringify(step.detail),
        step.policyAuditId,
        step.decision,
        step.risk,
        step.stageAuditId,
        step.startedAt,
        step.finishedAt,
      );
    return Number(result.lastInsertRowid);
  }

  addEvidence(runId: string, evidence: Evidence, at: string): void {
    this.db
      .prepare(
        "INSERT INTO agent_evidence (run_id, id, kind, source, excerpt_hash, excerpt, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        runId,
        evidence.id,
        evidence.kind,
        evidence.source,
        evidence.excerptHash,
        evidence.excerpt,
        evidence.truncated ? 1 : 0,
        at,
      );
  }

  task(id: string): AgentTask | undefined {
    const row = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id) as
      TaskRow | undefined;
    return row ? toTask(row) : undefined;
  }

  /** The most recent run of a task. */
  runForTask(taskId: string): StoredRun | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(taskId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  /** Newest first. `state` filters on the task's latest run. */
  list(query: { state?: AgentRunState; limit: number }): { task: AgentTask; run: StoredRun }[] {
    const rows = this.db
      .prepare(
        `SELECT r.id AS run_id FROM agent_runs r JOIN agent_tasks t ON t.id = r.task_id
         WHERE (?1 IS NULL OR r.state = ?1)
         ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?2`,
      )
      .all(query.state ?? null, query.limit) as unknown as RunIdRow[];
    const out: { task: AgentTask; run: StoredRun }[] = [];
    for (const { run_id } of rows) {
      const run = this.run(run_id);
      const task = run ? this.task(run.taskId) : undefined;
      if (run && task) out.push({ task, run });
    }
    return out;
  }

  run(id: string): StoredRun | undefined {
    const row = this.db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as
      RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  steps(runId: string): StoredStep[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY seq")
      .all(runId) as unknown as StepRow[];
    return rows.map((r) => ({
      seq: r.seq,
      runId: r.run_id,
      kind: r.kind,
      name: r.name,
      status: r.status,
      detail: JSON.parse(r.detail) as Record<string, unknown>,
      policyAuditId: r.policy_audit_id,
      decision: r.decision,
      risk: r.risk,
      stageAuditId: r.stage_audit_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
  }

  evidence(runId: string): Evidence[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_evidence WHERE run_id = ? ORDER BY rowid")
      .all(runId) as unknown as EvidenceRow[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      excerptHash: r.excerpt_hash,
      excerpt: r.excerpt,
      truncated: r.truncated === 1,
    }));
  }

  /** Runs that were still going when the process stopped. */
  interruptedRuns(): StoredRun[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_runs WHERE state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')")
      .all() as unknown as RunRow[];
    return rows.map(toRun);
  }
}
