// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// SQLite persistence (migrations 12 and 13). The write methods of this class are only reachable
// from `WorkflowAdmin` (definitions, authorisations) and `WorkflowEngine` (runs, counters);
// nothing else in Phoenix is given a store.
import type { Database } from "@phoenix/persistence";
import { boundValue } from "./bound";
import { definitionHash } from "./canonical";
import type { Value } from "./expr";
import { checkShape } from "./schema";
import type { RunStatus, StepStatus, WorkflowDefinition } from "./types";

type Row = Record<string, string | number | null>;

/** Runs `fn` in a transaction (a savepoint when one is already open). */
export function transaction<T>(db: Database, fn: () => T): T {
  const nested = db.isTransaction;
  const name = `wf_${Math.random().toString(36).slice(2, 10)}`;
  db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec(nested ? `RELEASE ${name}` : "COMMIT");
    return out;
  } catch (err) {
    db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : "ROLLBACK");
    throw err;
  }
}

export interface StoredDefinition {
  definition: WorkflowDefinition;
  hash: string;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
}

export type DefinitionRead =
  ({ ok: true } & StoredDefinition) | { ok: false; id: string; problems: string[] };

export interface RunRecord {
  id: string;
  workflowId: string;
  definitionHash: string;
  definition: WorkflowDefinition;
  status: RunStatus;
  triggerEventId: string;
  triggerEvent: Value;
  correlationId: string;
  chainDepth: number;
  currentStep: string | null;
  reason: string | null;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
}

export interface StepRecord {
  runId: string;
  seq: number;
  stepId: string;
  phase: "step" | "compensation";
  stepType: string;
  status: StepStatus;
  attempts: number;
  destructive: boolean;
  tool: string | null;
  input: Value | null;
  output: Value | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface Authorisation {
  id: string;
  workflowId: string;
  definitionHash: string;
  authorisedBy: string;
  authorisedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
}

export interface NewRun {
  id: string;
  workflow: WorkflowDefinition;
  hash: string;
  status: RunStatus;
  triggerEventId: string;
  triggerEvent: Value;
  chainDepth: number;
  reason?: string;
  now: number;
}

const parse = (text: unknown): Value | null => {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text) as Value;
  } catch {
    return null;
  }
};

export class WorkflowStore {
  constructor(private readonly db: Database) {}

  /** For `transaction()` around several store calls. */
  get database(): Database {
    return this.db;
  }

  // ── Definitions ───────────────────────────────────────────────────────────

  /**
   * Reads one definition. The shape is re-checked and the hash recomputed on every read, so a row
   * edited outside `WorkflowAdmin` is reported as invalid and never runs.
   */
  readDefinition(id: string): DefinitionRead | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_definitions WHERE id = ?").get(id) as
      Row | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  /** Cheap change detector for caches: id, recorded hash and enabled flag of every definition. */
  definitionStamps(): { id: string; hash: string; enabled: boolean }[] {
    const rows = this.db
      .prepare("SELECT id, hash, enabled FROM workflow_definitions ORDER BY id LIMIT 500")
      .all() as { id: string; hash: string; enabled: number }[];
    return rows.map((r) => ({ id: r.id, hash: r.hash, enabled: r.enabled === 1 }));
  }

  listDefinitions(): DefinitionRead[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_definitions ORDER BY id LIMIT 500")
      .all() as Row[];
    return rows.map((r) => this.fromRow(r));
  }

  private fromRow(row: Row): DefinitionRead {
    const id = String(row["id"]);
    const parsed = parse(row["definition"]);
    const problems = parsed === null ? ["stored definition is not JSON"] : checkShape(parsed);
    if (problems.length > 0) return { ok: false, id, problems };
    const definition: WorkflowDefinition = {
      ...(parsed as unknown as WorkflowDefinition), // shape checked just above
      enabled: row["enabled"] === 1,
    };
    const hash = definitionHash(definition);
    if (hash !== row["hash"] || definition.id !== id)
      return { ok: false, id, problems: ["stored definition does not match its recorded hash"] };
    return {
      ok: true,
      definition,
      hash,
      createdBy: String(row["created_by"]),
      createdAt: Number(row["created_at"]),
      updatedBy: String(row["updated_by"]),
      updatedAt: Number(row["updated_at"]),
    };
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  /** Returns false when this workflow already has a run for this trigger event (dedupe). */
  insertRun(run: NewRun): boolean {
    return transaction(this.db, () => {
      const r = this.db
        .prepare(
          `INSERT OR IGNORE INTO workflow_runs
             (id, workflow_id, definition_hash, definition, status, trigger_event_id, trigger_event,
              correlation_id, chain_depth, reason, created_at, updated_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.workflow.id,
          run.hash,
          JSON.stringify(run.workflow),
          run.status,
          run.triggerEventId,
          JSON.stringify(run.triggerEvent),
          `workflow-${run.id}`,
          run.chainDepth,
          run.reason ?? null,
          run.now,
          run.now,
          run.status === "refused" ? run.now : null,
        );
      if (Number(r.changes) === 0) return false;
      this.bump(run.workflow.id, run.status === "refused" ? "runs_refused" : "runs_queued");
      return true;
    });
  }

  /** Moves a run to a non-terminal state (counters are bumped in the same transaction). */
  markRun(
    id: string,
    workflowId: string,
    status: RunStatus,
    now: number,
    extra: { currentStep?: string | null; reason?: string | null; started?: boolean } = {},
    counters: readonly string[] = [],
  ): void {
    transaction(this.db, () => {
      const r = this.db
        .prepare(
          `UPDATE workflow_runs SET status = ?, updated_at = ?,
             current_step = COALESCE(?, current_step), reason = COALESCE(?, reason),
             started_at = CASE WHEN ? = 1 AND started_at IS NULL THEN ? ELSE started_at END
           WHERE id = ? AND finished_at IS NULL`,
        )
        .run(
          status,
          now,
          extra.currentStep ?? null,
          extra.reason ?? null,
          extra.started ? 1 : 0,
          now,
          id,
        );
      if (Number(r.changes) > 0) for (const name of counters) this.bump(workflowId, name);
    });
  }

  /** Ends a run and bumps its counters in one transaction. A finished run is never changed again. */
  finishRun(
    run: Pick<RunRecord, "id" | "workflowId">,
    status: RunStatus,
    reason: string | null,
    now: number,
    counters: readonly string[],
  ): boolean {
    return transaction(this.db, () => {
      const r = this.db
        .prepare(
          `UPDATE workflow_runs SET status = ?, reason = ?, updated_at = ?, finished_at = ?
           WHERE id = ? AND finished_at IS NULL`,
        )
        .run(status, reason, now, now, run.id);
      if (Number(r.changes) === 0) return false;
      for (const name of counters) this.bump(run.workflowId, name);
      return true;
    });
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as
      Row | undefined;
    return row ? this.runFromRow(row) : undefined;
  }

  listRuns(query: { workflowId?: string; status?: RunStatus; limit?: number } = {}): RunRecord[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (query.workflowId !== undefined) {
      where.push("workflow_id = ?");
      args.push(query.workflowId);
    }
    if (query.status !== undefined) {
      where.push("status = ?");
      args.push(query.status);
    }
    const limit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), 200);
    const rows = this.db
      .prepare(
        `SELECT * FROM workflow_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...args, limit) as Row[];
    return rows.map((r) => this.runFromRow(r));
  }

  runsInStatus(...statuses: RunStatus[]): RunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM workflow_runs WHERE status IN (${statuses.map(() => "?").join(",")})
         ORDER BY created_at, rowid`,
      )
      .all(...statuses) as Row[];
    return rows.map((r) => this.runFromRow(r));
  }

  /** Runs of one workflow created at or after `since` (rate limiting), refused runs excluded. */
  countStartedSince(workflowId: string, since: number): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ? AND created_at >= ? AND status != 'refused'",
      )
      .get(workflowId, since) as { n: number };
    return row.n;
  }

  countRefusedSince(workflowId: string, since: number): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ? AND created_at >= ? AND status = 'refused'",
      )
      .get(workflowId, since) as { n: number };
    return row.n;
  }

  private runFromRow(row: Row): RunRecord {
    return {
      id: String(row["id"]),
      workflowId: String(row["workflow_id"]),
      definitionHash: String(row["definition_hash"]),
      definition: JSON.parse(String(row["definition"])) as WorkflowDefinition, // written by insertRun
      status: String(row["status"]) as RunStatus,
      triggerEventId: String(row["trigger_event_id"]),
      triggerEvent: parse(row["trigger_event"]),
      correlationId: String(row["correlation_id"]),
      chainDepth: Number(row["chain_depth"]),
      currentStep: row["current_step"] === null ? null : String(row["current_step"]),
      reason: row["reason"] === null ? null : String(row["reason"]),
      createdAt: Number(row["created_at"]),
      startedAt: row["started_at"] === null ? null : Number(row["started_at"]),
      updatedAt: Number(row["updated_at"]),
      finishedAt: row["finished_at"] === null ? null : Number(row["finished_at"]),
    };
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  /** Appends a step row (status as given) and returns its sequence number. */
  beginStep(
    step: Omit<StepRecord, "seq" | "finishedAt" | "attempts" | "error" | "output"> &
      Partial<Pick<StepRecord, "attempts">>,
  ): number {
    return transaction(this.db, () => {
      const next = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM workflow_run_steps WHERE run_id = ?")
        .get(step.runId) as { n: number };
      this.db
        .prepare(
          `INSERT INTO workflow_run_steps
             (run_id, seq, step_id, phase, step_type, status, attempts, destructive, tool, input, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          step.runId,
          next.n,
          step.stepId,
          step.phase,
          step.stepType,
          step.status,
          step.attempts ?? 1,
          step.destructive ? 1 : 0,
          step.tool,
          step.input === null ? null : JSON.stringify(boundValue(step.input)),
          step.startedAt,
        );
      return next.n;
    });
  }

  /** Finishes (or updates) a step row and bumps its counters in the same transaction. */
  updateStep(
    run: Pick<RunRecord, "id" | "workflowId">,
    seq: number,
    patch: {
      status: StepStatus;
      attempts?: number;
      output?: Value | null;
      error?: string | null;
      finishedAt?: number | null;
    },
    counters: readonly string[] = [],
  ): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE workflow_run_steps SET status = ?, attempts = COALESCE(?, attempts),
             output = COALESCE(?, output), error = COALESCE(?, error), finished_at = ?
           WHERE run_id = ? AND seq = ?`,
        )
        .run(
          patch.status,
          patch.attempts ?? null,
          patch.output === undefined || patch.output === null
            ? null
            : JSON.stringify(boundValue(patch.output)),
          patch.error === undefined || patch.error === null ? null : patch.error.slice(0, 500),
          patch.finishedAt ?? null,
          run.id,
          seq,
        );
      for (const name of counters) this.bump(run.workflowId, name);
    });
  }

  /** Marks steps a crash left open: waiting approvals expire, running calls have an unknown outcome. */
  closeOpenSteps(runId: string, now: number): void {
    this.db
      .prepare(
        `UPDATE workflow_run_steps SET finished_at = ?,
           status = CASE status WHEN 'waiting' THEN 'expired' ELSE 'unknown' END
         WHERE run_id = ? AND status IN ('running', 'waiting')`,
      )
      .run(now, runId);
  }

  steps(runId: string): StepRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY seq")
      .all(runId) as Row[];
    return rows.map((row) => ({
      runId: String(row["run_id"]),
      seq: Number(row["seq"]),
      stepId: String(row["step_id"]),
      phase: row["phase"] === "compensation" ? "compensation" : "step",
      stepType: String(row["step_type"]),
      status: String(row["status"]) as StepStatus,
      attempts: Number(row["attempts"]),
      destructive: row["destructive"] === 1,
      tool: row["tool"] === null ? null : String(row["tool"]),
      input: parse(row["input"]),
      output: parse(row["output"]),
      error: row["error"] === null ? null : String(row["error"]),
      startedAt: Number(row["started_at"]),
      finishedAt: row["finished_at"] === null ? null : Number(row["finished_at"]),
    }));
  }

  // ── Authorisations ────────────────────────────────────────────────────────

  authorisations(workflowId: string): Authorisation[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM workflow_authorisations WHERE workflow_id = ? ORDER BY authorised_at DESC, rowid DESC LIMIT 50",
      )
      .all(workflowId) as Row[];
    return rows.map((row) => ({
      id: String(row["id"]),
      workflowId: String(row["workflow_id"]),
      definitionHash: String(row["definition_hash"]),
      authorisedBy: String(row["authorised_by"]),
      authorisedAt: Number(row["authorised_at"]),
      expiresAt: row["expires_at"] === null ? null : Number(row["expires_at"]),
      revokedAt: row["revoked_at"] === null ? null : Number(row["revoked_at"]),
      revokedBy: row["revoked_by"] === null ? null : String(row["revoked_by"]),
    }));
  }

  /** The live authorisation for exactly this definition hash, if any. */
  activeAuthorisation(workflowId: string, hash: string, now: number): Authorisation | undefined {
    return this.authorisations(workflowId).find(
      (a) =>
        a.definitionHash === hash &&
        a.revokedAt === null &&
        (a.expiresAt === null || a.expiresAt > now),
    );
  }

  // ── Counters and durations ────────────────────────────────────────────────

  bump(workflowId: string, name: string, by = 1): void {
    this.db
      .prepare(
        `INSERT INTO workflow_counters (workflow_id, name, value) VALUES (?, ?, ?)
         ON CONFLICT (workflow_id, name) DO UPDATE SET value = value + excluded.value`,
      )
      .run(workflowId, name, by);
  }

  counters(): Record<string, Record<string, number>> {
    const rows = this.db
      .prepare("SELECT workflow_id, name, value FROM workflow_counters")
      .all() as {
      workflow_id: string;
      name: string;
      value: number;
    }[];
    const out: Record<string, Record<string, number>> = Object.create(null) as Record<
      string,
      Record<string, number>
    >;
    for (const r of rows) {
      const per = (out[r.workflow_id] ??= Object.create(null) as Record<string, number>);
      per[r.name] = r.value;
    }
    return out;
  }

  /** Durations (ms) of the latest finished runs that actually started, newest first. */
  durations(workflowId: string, limit: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT finished_at - started_at AS d FROM workflow_runs
         WHERE workflow_id = ? AND started_at IS NOT NULL AND finished_at IS NOT NULL
         ORDER BY finished_at DESC, rowid DESC LIMIT ?`,
      )
      .all(workflowId, limit) as { d: number }[];
    return rows.map((r) => r.d);
  }

  waitingApprovals(): { workflowId: string; n: number }[] {
    const rows = this.db
      .prepare(
        "SELECT workflow_id, COUNT(*) AS n FROM workflow_runs WHERE status = 'waiting_approval' GROUP BY workflow_id",
      )
      .all() as { workflow_id: string; n: number }[];
    return rows.map((r) => ({ workflowId: r.workflow_id, n: r.n }));
  }
}

/**
 * The write side of definitions and authorisations. Only `WorkflowAdmin` constructs one; the
 * engine is given a `WorkflowStore`, which has no method that changes either.
 */
export class WorkflowAdminStore {
  private readonly reader: WorkflowStore;
  constructor(private readonly db: Database) {
    this.reader = new WorkflowStore(db);
  }

  putDefinition(def: WorkflowDefinition, by: string, now: number): StoredDefinition {
    const hash = definitionHash(def);
    this.db
      .prepare(
        `INSERT INTO workflow_definitions
           (id, definition, hash, version, enabled, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, hash = excluded.hash,
           version = excluded.version, enabled = excluded.enabled,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(def.id, JSON.stringify(def), hash, def.version, def.enabled ? 1 : 0, by, now, by, now);
    const read = this.reader.readDefinition(def.id);
    if (!read?.ok) throw new Error("stored definition could not be read back");
    return read;
  }

  setEnabled(id: string, enabled: boolean, by: string, now: number): boolean {
    const r = this.db
      .prepare(
        "UPDATE workflow_definitions SET enabled = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      )
      .run(enabled ? 1 : 0, by, now, id);
    return Number(r.changes) > 0;
  }

  deleteDefinition(id: string): boolean {
    return (
      Number(this.db.prepare("DELETE FROM workflow_definitions WHERE id = ?").run(id).changes) > 0
    );
  }

  insertAuthorisation(a: Authorisation): void {
    this.db
      .prepare(
        `INSERT INTO workflow_authorisations
           (id, workflow_id, definition_hash, authorised_by, authorised_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.workflowId, a.definitionHash, a.authorisedBy, a.authorisedAt, a.expiresAt);
  }

  /** Revokes every live (not revoked, not expired) authorisation of a workflow; returns how many. */
  revokeAuthorisations(workflowId: string, by: string, now: number): number {
    const r = this.db
      .prepare(
        `UPDATE workflow_authorisations SET revoked_at = ?, revoked_by = ?
         WHERE workflow_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(now, by, workflowId, now);
    return Number(r.changes);
  }
}
