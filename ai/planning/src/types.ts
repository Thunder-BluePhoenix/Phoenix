// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Where a plan's tasks are created. A plan has exactly one destination, fixed in its content. */
export type Destination =
  { system: "github"; repository: string } | { system: "frappe"; site: string };

export type PlanTarget = Destination["system"];

/**
 * Where the words of a statement came from:
 * - `meeting`: restates the reviewed meeting item, with the item id and a verbatim quote that was
 *   checked against the text the model was shown;
 * - `suggested`: the model's own proposal (shown as "suggested by the model");
 * - `user`: typed or changed by the person reviewing the plan.
 */
export type Basis = "meeting" | "suggested" | "user";

export interface Statement {
  text: string;
  basis: Basis;
  /** Present exactly when `basis` is `meeting`. */
  itemId?: string;
  quote?: string;
}

export interface PlanTask {
  title: string;
  body: string;
  /** GitHub labels. Ignored by Frappe (a Task has no labels). */
  labels: string[];
  basis: Basis;
  itemId?: string;
  quote?: string;
}

export const FRAPPE_FIELD_TYPES = [
  "Data",
  "Text",
  "Small Text",
  "Long Text",
  "Text Editor",
  "Int",
  "Float",
  "Currency",
  "Percent",
  "Check",
  "Date",
  "Datetime",
  "Select",
  "Link",
  "Attach",
  "Phone",
  "Table",
] as const;
export type FrappeFieldType = (typeof FRAPPE_FIELD_TYPES)[number];

export interface FrappeField {
  label: string;
  fieldtype: FrappeFieldType;
  required: boolean;
}

export interface FrappePermission {
  role: string;
  read: boolean;
  write: boolean;
  create: boolean;
}

/** A DocType proposal. Always a suggestion: nothing here is created by Phoenix. */
export interface FrappeDesign {
  doctype: string;
  fields: FrappeField[];
  workflowStates: string[];
  permissions: FrappePermission[];
}

/** The meeting item the plan was made from, as it was when the plan was made. */
export interface PlanSource {
  itemId: string;
  meetingId: string;
  kind: string;
  itemText: string;
  owner: string | null;
  due: string | null;
  /** The verbatim quote the item carried, when it had one. */
  quote: string | null;
}

export interface EngineeringPlan {
  version: 1;
  destination: Destination;
  /** `rules` when no model was used, else `ai:<provider>/<model>`. */
  generatedBy: string;
  notAiGenerated: boolean;
  title: string;
  summary: Statement;
  acceptanceCriteria: Statement[];
  tasks: PlanTask[];
  risks: Statement[];
  openQuestions: string[];
  /** Only for Frappe plans, and only when a model proposed one. */
  frappe?: FrappeDesign;
  source: PlanSource;
}

export const PLAN_STATUSES = [
  "draft",
  "proposed",
  "approved",
  "creating",
  "created",
  "failed",
  "cancelled",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/**
 * Every allowed plan status change, as data; a pair not listed is refused (self pairs included).
 *
 * - draft -> proposed: the plan is ready for the user to review; cancelled: abandoned.
 * - proposed -> approved: the user approved THIS content (its hash). -> draft: edited, which
 *   discards any approval. -> cancelled.
 * - approved -> creating: creation started (needs the approved hash to equal the content hash).
 *   -> draft: edited after approval. -> cancelled.
 * - creating -> created: every task exists. -> failed: a task failed (or the process died and
 *   `recover` ran). There is no cancel while creating: a request may be in flight.
 * - failed -> creating: the user retried (same approved content, same idempotency keys).
 *   -> draft: edited. -> cancelled.
 * - created and cancelled are final.
 */
export const PLAN_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  draft: ["proposed", "cancelled"],
  proposed: ["approved", "draft", "cancelled"],
  approved: ["creating", "draft", "cancelled"],
  creating: ["created", "failed"],
  created: [],
  failed: ["creating", "draft", "cancelled"],
  cancelled: [],
};

export function canMovePlan(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && (PLAN_STATUSES as readonly string[]).includes(value);
}

export type TaskRunStatus = "pending" | "attempting" | "created" | "failed";

/** Creation state of one task of a plan. */
export interface TaskRun {
  planId: string;
  taskIndex: number;
  /** Fixed before the capability is first called; a retry sends the same one. */
  idempotencyKey: string;
  status: TaskRunStatus;
  attempts: number;
  externalId: string | null;
  url: string | null;
  error: string | null;
  updatedAt: string;
}

export interface PlanRecord {
  id: string;
  meetingId: string;
  itemId: string;
  target: PlanTarget;
  status: PlanStatus;
  plan: EngineeringPlan;
  contentHash: string;
  approvedHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Whether the user chose to name the meeting in the created tasks (default no). */
  includeMeetingRef: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One row of the traceability record: meeting <-> item <-> plan <-> created task. */
export interface PlanLink {
  id: string;
  meetingId: string;
  itemId: string;
  planId: string;
  taskIndex: number;
  system: PlanTarget;
  /** GitHub issue number or Frappe Task name. */
  externalId: string;
  url: string;
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
}
