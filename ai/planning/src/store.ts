// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Persistence for plans, their per-task creation state and the traceability links (migration 16).
// Deleting a meeting removes all three through a database trigger; nothing here has to remember.
import type { Database } from "@phoenix/persistence";
import { isRecord } from "./guards";
import { planHash } from "./hash";
import {
  isPlanStatus,
  type EngineeringPlan,
  type PlanLink,
  type PlanRecord,
  type PlanStatus,
  type PlanTarget,
  type TaskRun,
  type TaskRunStatus,
} from "./types";

interface PlanRow {
  id: string;
  meeting_id: string;
  item_id: string;
  target: string;
  status: string;
  content: string;
  content_hash: string;
  approved_hash: string | null;
  approved_by: string | null;
  approved_at: string | null;
  include_meeting_ref: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  plan_id: string;
  task_index: number;
  idempotency_key: string;
  status: string;
  attempts: number;
  external_id: string | null;
  url: string | null;
  error: string | null;
  updated_at: string;
}

interface LinkRow {
  id: string;
  meeting_id: string;
  item_id: string;
  plan_id: string;
  task_index: number;
  system: string;
  external_id: string;
  url: string;
  approved_by: string;
  approved_at: string;
  created_at: string;
}

const RUN_STATUSES: Record<TaskRunStatus, true> = {
  pending: true,
  attempting: true,
  created: true,
  failed: true,
};

function parsePlan(json: string): EngineeringPlan {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tasks)) {
    throw new Error("stored plan has an unknown shape");
  }
  return value as unknown as EngineeringPlan;
}

function toRecord(r: PlanRow): PlanRecord {
  if (!isPlanStatus(r.status) || (r.target !== "github" && r.target !== "frappe")) {
    throw new Error(`plan ${r.id} has an unknown status or target`);
  }
  return {
    id: r.id,
    meetingId: r.meeting_id,
    itemId: r.item_id,
    target: r.target,
    status: r.status,
    plan: parsePlan(r.content),
    contentHash: r.content_hash,
    approvedHash: r.approved_hash,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    includeMeetingRef: r.include_meeting_ref === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRun(r: RunRow): TaskRun {
  if (!(r.status in RUN_STATUSES))
    throw new Error(`task run of ${r.plan_id} has an unknown status`);
  return {
    planId: r.plan_id,
    taskIndex: r.task_index,
    idempotencyKey: r.idempotency_key,
    status: r.status as TaskRunStatus,
    attempts: r.attempts,
    externalId: r.external_id,
    url: r.url,
    error: r.error,
    updatedAt: r.updated_at,
  };
}

function toLink(r: LinkRow): PlanLink {
  return {
    id: r.id,
    meetingId: r.meeting_id,
    itemId: r.item_id,
    planId: r.plan_id,
    taskIndex: r.task_index,
    system: r.system as PlanTarget,
    externalId: r.external_id,
    url: r.url,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    createdAt: r.created_at,
  };
}

export interface NewPlan {
  id: string;
  meetingId: string;
  itemId: string;
  plan: EngineeringPlan;
  at: string;
}

export interface NewLink {
  id: string;
  record: PlanRecord;
  taskIndex: number;
  externalId: string;
  url: string;
  at: string;
}

export class PlanStore {
  constructor(private readonly db: Database) {}

  insert(n: NewPlan): PlanRecord {
    this.db
      .prepare(
        `INSERT INTO plans (id, meeting_id, item_id, target, status, content, content_hash,
           include_meeting_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`,
      )
      .run(
        n.id,
        n.meetingId,
        n.itemId,
        n.plan.destination.system,
        JSON.stringify(n.plan),
        planHash(n.plan),
        n.at,
        n.at,
      );
    const stored = this.get(n.id);
    if (!stored) throw new Error("plan was not stored");
    return stored;
  }

  get(id: string): PlanRecord | null {
    const row = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
    return row ? toRecord(row) : null;
  }

  listForMeeting(meetingId: string): PlanRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM plans WHERE meeting_id = ? ORDER BY created_at, rowid")
        .all(meetingId) as unknown as PlanRow[]
    ).map(toRecord);
  }

  listForItem(itemId: string): PlanRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM plans WHERE item_id = ? ORDER BY created_at, rowid")
        .all(itemId) as unknown as PlanRow[]
    ).map(toRecord);
  }

  listByStatus(status: PlanStatus): PlanRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM plans WHERE status = ? ORDER BY created_at, rowid")
        .all(status) as unknown as PlanRow[]
    ).map(toRecord);
  }

  /**
   * Moves a plan between statuses only if it is still in `from` (a compare-and-swap in one SQL
   * statement). Returns false when someone else already moved it, so two callers can never both
   * start creating the same plan.
   */
  moveStatus(id: string, from: PlanStatus, to: PlanStatus, at: string): boolean {
    const r = this.db
      .prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
      .run(to, at, id, from);
    return Number(r.changes) > 0;
  }

  /** Replaces the content, clears any approval and sets the status (always `draft`). */
  replaceContent(id: string, plan: EngineeringPlan, from: PlanStatus, at: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE plans SET content = ?, content_hash = ?, status = 'draft', approved_hash = NULL,
           approved_by = NULL, approved_at = NULL, include_meeting_ref = 0, updated_at = ?
         WHERE id = ? AND status = ?`,
      )
      .run(JSON.stringify(plan), planHash(plan), at, id, from);
    return Number(r.changes) > 0;
  }

  /** Records the approval of exactly `hash` (the compare also checks the stored content hash). */
  approve(id: string, hash: string, by: string, includeMeetingRef: boolean, at: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE plans SET status = 'approved', approved_hash = ?, approved_by = ?, approved_at = ?,
           include_meeting_ref = ?, updated_at = ?
         WHERE id = ? AND status = 'proposed' AND content_hash = ?`,
      )
      .run(hash, by, at, includeMeetingRef ? 1 : 0, at, id, hash);
    return Number(r.changes) > 0;
  }

  // ── Task runs ────────────────────────────────────────────────────────────

  runs(planId: string): TaskRun[] {
    return (
      this.db
        .prepare("SELECT * FROM plan_task_runs WHERE plan_id = ? ORDER BY task_index")
        .all(planId) as unknown as RunRow[]
    ).map(toRun);
  }

  /** Creates the run rows (once). Existing rows keep their idempotency keys. */
  ensureRuns(planId: string, keys: readonly string[], at: string): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO plan_task_runs
         (plan_id, task_index, idempotency_key, status, attempts, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`,
    );
    keys.forEach((key, index) => void insert.run(planId, index, key, at));
  }

  markAttempting(planId: string, taskIndex: number, at: string): void {
    this.db
      .prepare(
        `UPDATE plan_task_runs SET status = 'attempting', attempts = attempts + 1, error = NULL,
           updated_at = ? WHERE plan_id = ? AND task_index = ?`,
      )
      .run(at, planId, taskIndex);
  }

  markFailed(planId: string, taskIndex: number, error: string, at: string): void {
    this.db
      .prepare(
        `UPDATE plan_task_runs SET status = 'failed', error = ?, updated_at = ?
         WHERE plan_id = ? AND task_index = ?`,
      )
      .run(error, at, planId, taskIndex);
  }

  /** Marks the task created and writes its link in one transaction. */
  markCreated(link: NewLink): PlanLink {
    const { record, taskIndex } = link;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE plan_task_runs SET status = 'created', external_id = ?, url = ?, error = NULL,
             updated_at = ? WHERE plan_id = ? AND task_index = ?`,
        )
        .run(link.externalId, link.url, link.at, record.id, taskIndex);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO plan_links (id, meeting_id, item_id, plan_id, task_index, system,
             external_id, url, approved_by, approved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          link.id,
          record.meetingId,
          record.itemId,
          record.id,
          taskIndex,
          record.target,
          link.externalId,
          link.url,
          record.approvedBy ?? "",
          record.approvedAt ?? link.at,
          link.at,
        );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    const row = this.db
      .prepare("SELECT * FROM plan_links WHERE plan_id = ? AND task_index = ?")
      .get(record.id, taskIndex) as LinkRow | undefined;
    if (!row) throw new Error("link was not stored");
    return toLink(row);
  }

  // ── Links ────────────────────────────────────────────────────────────────

  linksForMeeting(meetingId: string): PlanLink[] {
    return (
      this.db
        .prepare("SELECT * FROM plan_links WHERE meeting_id = ? ORDER BY created_at, rowid")
        .all(meetingId) as unknown as LinkRow[]
    ).map(toLink);
  }

  linksForItem(itemId: string): PlanLink[] {
    return (
      this.db
        .prepare("SELECT * FROM plan_links WHERE item_id = ? ORDER BY created_at, rowid")
        .all(itemId) as unknown as LinkRow[]
    ).map(toLink);
  }

  linksForPlan(planId: string): PlanLink[] {
    return (
      this.db
        .prepare("SELECT * FROM plan_links WHERE plan_id = ? ORDER BY task_index")
        .all(planId) as unknown as LinkRow[]
    ).map(toLink);
  }

  linksForTask(system: PlanTarget, externalId: string): PlanLink[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM plan_links WHERE system = ? AND external_id = ? ORDER BY created_at, rowid",
        )
        .all(system, externalId) as unknown as LinkRow[]
    ).map(toLink);
  }
}
