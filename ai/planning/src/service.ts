// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Plans from reviewed meeting items, and the approval -> creation workflow.
//
// The rules this file enforces (each has a test, and the important ones a mutation check):
//   * A plan is generated only from an ACCEPTED decision, requirement or action item.
//   * A plan is a PROPOSAL. No capability command is ever called until a person approves the exact
//     content: `approve` records the hash of the content the person was shown, and `create` refuses
//     unless the stored content still has that hash. Editing a plan writes `draft` and clears the
//     approval, so an approval can never cover text it did not see.
//   * Creation goes through `ToolGateway.call` only. The actor is the approving USER (a plan has no
//     way to be approved by an agent: `approve`/`create` are service methods that only the user's
//     own request handler calls). The gateway still evaluates the policy engine, writes the audit
//     record and refuses unregistered tools; the capability manager still asks the user to confirm
//     every `external` command, so the user also sees a prompt per created task.
//   * One task at a time, in order, stopping at the first failure. Each task has an idempotency key
//     fixed BEFORE its first attempt and stored; a retry (after a failure, a timeout or a crash)
//     sends the same key, and the capability returns the existing resource instead of a second one.
//   * The meeting is named in a created task only when the person ticked that box when approving;
//     the default is an opaque Phoenix plan id (meetings are sensitive).
import { createHash } from "node:crypto";
import type { Actor as ItemActor, MeetingItem, MeetingItemService } from "@phoenix/ai-meetings";
import type { ToolCall, ToolCallResult } from "@phoenix/ai-tool-gateway";
import { redact } from "@phoenix/logging";
import type { Meeting, Transcript, Database } from "@phoenix/persistence";
import type { PolicyDecision } from "@phoenix/policy";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  cleanText,
  generatePlan,
  type GenerateFn,
  MAX_CRITERIA,
  MAX_QUESTION,
  MAX_QUESTIONS,
  MAX_RISKS,
  MAX_STATEMENT,
  MAX_SUMMARY,
  MAX_TASK_BODY,
  MAX_TASK_TITLE,
  MAX_TASKS,
  type GeneratedPlan,
} from "./generate";
import { isRecord } from "./guards";
import { planHash } from "./hash";
import { PlanStore } from "./store";
import {
  canMovePlan,
  type Destination,
  type EngineeringPlan,
  type PlanLink,
  type PlanRecord,
  type PlanStatus,
  type PlanTask,
  type Statement,
  type TaskRun,
} from "./types";

/** Items a plan can be made from. Topics and project references are context, not work. */
export const PLANNABLE_KINDS: Record<string, true> = {
  decision: true,
  requirement: true,
  action_item: true,
};

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const SITE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,148}$/;
/** Both capabilities accept at most this much text for a task body. */
const MAX_RENDERED_BODY = 9_500;
const MAX_ERROR = 300;

/** The only thing the planner needs of the tool gateway. `ToolGateway` satisfies it. */
export interface ToolCaller {
  call(call: ToolCall): Promise<ToolCallResult>;
  preview(call: ToolCall): PolicyDecision;
}

/** The part of the meeting store this package reads. A `MeetingStore` satisfies it. */
export interface PlanMeetings {
  get(id: string): Meeting | null;
  transcript(id: string): Transcript | null;
}

export interface PlanServiceOptions {
  db: Database;
  items: MeetingItemService;
  meetings: PlanMeetings;
  gateway: ToolCaller;
  /** Records an audit entry. Details are ids, counts and statuses only, never plan text. */
  audit: (action: string, details: Record<string, unknown>) => void;
  /** The current model call, or null when AI is unavailable. Read on every use. */
  generate?: () => GenerateFn | null;
  now?: () => Date;
  newId?: () => string;
  nonce?: () => string;
}

/** Who is acting. `id` is recorded as the approver; `viewer`, when given, must see the meeting. */
export type PlanActor = ItemActor;

export interface PlanEdit {
  title?: string;
  summary?: string;
  acceptanceCriteria?: string[];
  tasks?: { title: string; body: string; labels?: string[] }[];
  risks?: string[];
  openQuestions?: string[];
  /** Same system only: a GitHub plan cannot become a Frappe plan. */
  destination?: Destination;
}

export interface ApprovalInput {
  /** The hash of the content the person is looking at (`PlanRecord.contentHash`). */
  hash: string;
  /** True only if the person ticked "name the meeting in the created tasks". Default false. */
  includeMeetingRef?: boolean;
}

/** What one task will send, exactly, and what the policy engine thinks of it right now. */
export interface TaskPreview {
  taskIndex: number;
  tool: string;
  input: Record<string, unknown>;
  decision: PolicyDecision;
}

export interface CreationReport {
  plan: PlanRecord;
  runs: TaskRun[];
  links: PlanLink[];
  /** Set when creation stopped at a failure: which task and why. */
  failure: { taskIndex: number; message: string } | null;
}

export interface GeneratedPlanRecord extends GeneratedPlan {
  record: PlanRecord;
}

const invalid = (message: string): PhoenixError =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, message);

const notFound = (what: string): PhoenixError =>
  new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `No such ${what}`);

function toolFor(plan: EngineeringPlan): string {
  return plan.destination.system === "github" ? "github.issue.create" : "frappe.task.create";
}

export function validateDestination(destination: Destination): Destination {
  if (destination.system === "github") {
    if (!REPOSITORY.test(destination.repository)) throw invalid('repository must be "owner/name"');
    return { system: "github", repository: destination.repository };
  }
  if (!SITE.test(destination.site)) throw invalid("site is not a valid Frappe site name");
  return { system: "frappe", site: destination.site };
}

export class PlanService {
  readonly store: PlanStore;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly o: PlanServiceOptions) {
    this.store = new PlanStore(o.db);
    this.now = o.now ?? (() => new Date());
    this.newId = o.newId ?? (() => `plan_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  private recordFor(planId: string, actor?: PlanActor): PlanRecord {
    const record = this.store.get(planId);
    // Missing, deleted and forbidden look the same.
    if (!record) throw notFound("plan");
    this.o.items.counts(record.meetingId, actor);
    return record;
  }

  get(planId: string, actor?: PlanActor): PlanRecord {
    return this.recordFor(planId, actor);
  }

  list(meetingId: string, actor?: PlanActor): PlanRecord[] {
    this.o.items.counts(meetingId, actor);
    return this.store.listForMeeting(meetingId);
  }

  runs(planId: string, actor?: PlanActor): TaskRun[] {
    this.recordFor(planId, actor);
    return this.store.runs(planId);
  }

  /** Meeting -> every task created from it. */
  linksForMeeting(meetingId: string, actor?: PlanActor): PlanLink[] {
    this.o.items.counts(meetingId, actor);
    return this.store.linksForMeeting(meetingId);
  }

  /** Task -> the meeting, item and plan it came from. */
  linksForTask(system: "github" | "frappe", externalId: string): PlanLink[] {
    return this.store.linksForTask(system, externalId);
  }

  linksForItem(itemId: string, actor?: PlanActor): PlanLink[] {
    this.o.items.get(itemId, actor);
    return this.store.linksForItem(itemId);
  }

  // ── Generating ───────────────────────────────────────────────────────────

  /**
   * Drafts a plan from an accepted item. Uses the model when one is allowed, else a labelled
   * skeleton. The plan is stored as a `draft`: it is a proposal and nothing is created.
   */
  async generate(
    itemId: string,
    destination: Destination,
    actor: PlanActor,
  ): Promise<GeneratedPlanRecord> {
    const item = this.acceptedItem(itemId, actor);
    const where = validateDestination(destination);
    const generated = await generatePlan({
      item,
      destination: where,
      transcriptText: this.o.meetings.transcript(item.meetingId)?.text ?? null,
      generate: this.o.generate?.() ?? null,
      ...(this.o.nonce ? { nonce: this.o.nonce } : {}),
    });
    // The item may have been rejected or the meeting deleted while the model was thinking.
    this.acceptedItem(itemId, actor);
    const record = this.store.insert({
      id: this.newId(),
      meetingId: item.meetingId,
      itemId: item.id,
      plan: generated.plan,
      at: this.stamp(),
    });
    this.o.audit("plan.generated", {
      plan_id: record.id,
      meeting_id: record.meetingId,
      item_id: record.itemId,
      target: record.target,
      by: generated.plan.generatedBy,
      proposed: generated.stats.proposed,
      grounded: generated.stats.grounded,
      suggested: generated.stats.suggested,
      reviewed_by: actor.id,
    });
    return { ...generated, record };
  }

  private acceptedItem(itemId: string, actor: PlanActor): MeetingItem {
    const item = this.o.items.get(itemId, actor);
    if (item.status !== "accepted") {
      throw invalid(`Only an accepted item can become a plan; this one is ${item.status}`);
    }
    if (PLANNABLE_KINDS[item.kind] !== true) {
      throw invalid(`A ${item.kind.replace("_", " ")} cannot become a plan`);
    }
    return item;
  }

  // ── Editing and the review states ────────────────────────────────────────

  /**
   * Replaces what the person changed. Anything that differs from the generated wording becomes
   * `user` text (no meeting quote is claimed for words the person typed). Always leaves the plan a
   * `draft` with NO approval, whatever it was before.
   */
  edit(planId: string, change: PlanEdit, actor: PlanActor): PlanRecord {
    const record = this.recordFor(planId, actor);
    if (
      record.status === "creating" ||
      record.status === "created" ||
      record.status === "cancelled"
    ) {
      throw invalid(`A ${record.status} plan cannot be edited`);
    }
    const next = applyEdit(record.plan, change);
    if (!this.store.replaceContent(planId, next, record.status, this.stamp())) {
      throw invalid("The plan changed while it was being edited; reload it");
    }
    this.o.audit("plan.edited", {
      plan_id: planId,
      meeting_id: record.meetingId,
      from: record.status,
      reviewed_by: actor.id,
    });
    return this.recordFor(planId, actor);
  }

  /** draft -> proposed: ready for the person to review and approve. */
  propose(planId: string, actor: PlanActor): PlanRecord {
    return this.move(this.recordFor(planId, actor), "proposed", actor);
  }

  cancel(planId: string, actor: PlanActor): PlanRecord {
    return this.move(this.recordFor(planId, actor), "cancelled", actor);
  }

  private move(record: PlanRecord, to: PlanStatus, actor: PlanActor): PlanRecord {
    if (!canMovePlan(record.status, to)) {
      throw invalid(`A ${record.status} plan cannot become ${to}`);
    }
    if (!this.store.moveStatus(record.id, record.status, to, this.stamp())) {
      throw invalid("The plan changed while it was being updated; reload it");
    }
    this.o.audit("plan.status", {
      plan_id: record.id,
      meeting_id: record.meetingId,
      from: record.status,
      to,
      by: actor.id,
    });
    return this.recordFor(record.id, actor);
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  /**
   * The person approves THIS content. `hash` must equal the stored content hash, so a plan that
   * was edited (by anyone) after the person looked at it cannot be approved by a stale click.
   */
  approve(planId: string, input: ApprovalInput, actor: PlanActor): PlanRecord {
    const record = this.recordFor(planId, actor);
    if (record.status !== "proposed") {
      throw invalid(`Only a proposed plan can be approved; this one is ${record.status}`);
    }
    if (input.hash !== record.contentHash || planHash(record.plan) !== record.contentHash) {
      throw invalid("The plan changed since you looked at it; review it again before approving");
    }
    this.acceptedItem(record.itemId, actor);
    if (!actor.id) throw invalid("An approval needs a person");
    const at = this.stamp();
    if (!this.store.approve(planId, input.hash, actor.id, input.includeMeetingRef === true, at)) {
      throw invalid("The plan changed while it was being approved; review it again");
    }
    this.o.audit("plan.approved", {
      plan_id: planId,
      meeting_id: record.meetingId,
      item_id: record.itemId,
      hash: input.hash,
      tasks: record.plan.tasks.length,
      include_meeting_ref: input.includeMeetingRef === true,
      approved_by: actor.id,
    });
    return this.recordFor(planId, actor);
  }

  // ── What would be sent ───────────────────────────────────────────────────

  /** Exactly what each task would send now, with the policy engine's current opinion. */
  preview(planId: string, actor: PlanActor): TaskPreview[] {
    const record = this.recordFor(planId, actor);
    const keys = this.keysFor(record);
    return record.plan.tasks.map((_, taskIndex) => {
      const input = this.inputFor(record, taskIndex, keys[taskIndex] ?? "");
      return {
        taskIndex,
        tool: toolFor(record.plan),
        input,
        decision: this.o.gateway.preview(this.callFor(record, input, actor)),
      };
    });
  }

  private keysFor(record: PlanRecord): string[] {
    const stored = this.store.runs(record.id);
    return record.plan.tasks.map(
      (_, i) => stored[i]?.idempotencyKey ?? idempotencyKey(record.id, i),
    );
  }

  private meetingLine(record: PlanRecord): string {
    if (!record.includeMeetingRef) return `Phoenix plan ${record.id}`;
    const meeting = this.o.meetings.get(record.meetingId);
    const title = meeting?.title ? cleanText(meeting.title, 120) : "";
    return `Phoenix plan ${record.id} · meeting ${record.meetingId}${title ? ` “${title}”` : ""}`;
  }

  private inputFor(record: PlanRecord, taskIndex: number, key: string): Record<string, unknown> {
    const task = record.plan.tasks[taskIndex];
    if (!task) throw invalid("No such task");
    const body = renderBody(record.plan, taskIndex, this.meetingLine(record));
    const { destination } = record.plan;
    return destination.system === "github"
      ? {
          repository: destination.repository,
          title: task.title,
          body,
          ...(task.labels.length > 0 ? { labels: task.labels } : {}),
          idempotency_key: key,
        }
      : {
          site: destination.site,
          subject: task.title.slice(0, 140),
          description: body,
          idempotency_key: key,
        };
  }

  private callFor(record: PlanRecord, input: Record<string, unknown>, actor: PlanActor): ToolCall {
    const { destination } = record.plan;
    return {
      actor: { kind: "user", id: actor.id, trustedByUser: true },
      tool: toolFor(record.plan),
      input,
      environment: "local",
      resource:
        destination.system === "github"
          ? `github:${destination.repository}`
          : `frappe:${destination.site}`,
      dataClass: "sensitive",
    };
  }

  // ── Creation ─────────────────────────────────────────────────────────────

  /**
   * Creates the tasks of an approved plan (or retries a failed one), one at a time. Stops at the
   * first failure and leaves the plan `failed`; calling it again continues with the same
   * idempotency keys. Never called by anything but the person's own request.
   */
  async create(planId: string, actor: PlanActor): Promise<CreationReport> {
    const record = this.recordFor(planId, actor);
    if (record.status !== "approved" && record.status !== "failed") {
      throw invalid(`Only an approved plan can be created; this one is ${record.status}`);
    }
    // The approval is for one exact content. Checked here and again before every task.
    this.assertApproved(record);
    this.acceptedItem(record.itemId, actor);
    if (!this.store.moveStatus(planId, record.status, "creating", this.stamp())) {
      throw invalid("The plan is already being created or changed; reload it");
    }
    this.o.audit("plan.creating", {
      plan_id: planId,
      meeting_id: record.meetingId,
      from: record.status,
      tasks: record.plan.tasks.length,
      by: actor.id,
    });
    this.store.ensureRuns(
      planId,
      record.plan.tasks.map((_, i) => idempotencyKey(planId, i)),
      this.stamp(),
    );

    let failure: CreationReport["failure"] = null;
    for (const run of this.store.runs(planId)) {
      if (run.status === "created") continue;
      const fresh = this.store.get(planId);
      if (!fresh || fresh.status !== "creating") {
        failure = { taskIndex: run.taskIndex, message: "The plan was changed during creation" };
        break;
      }
      try {
        this.assertApproved(fresh);
        this.acceptedItem(fresh.itemId, actor);
      } catch (err) {
        failure = { taskIndex: run.taskIndex, message: messageOf(err) };
        break;
      }
      failure = await this.createOne(fresh, run, actor);
      if (failure) break;
    }
    const finished = failure ? "failed" : "created";
    const after = this.store.get(planId);
    if (after?.status === "creating")
      this.store.moveStatus(planId, "creating", finished, this.stamp());
    this.o.audit(failure ? "plan.failed" : "plan.created", {
      plan_id: planId,
      meeting_id: record.meetingId,
      ...(failure ? { task_index: failure.taskIndex } : {}),
      links: this.store.linksForPlan(planId).length,
      by: actor.id,
    });
    return {
      plan: this.recordFor(planId, actor),
      runs: this.store.runs(planId),
      links: this.store.linksForPlan(planId),
      failure,
    };
  }

  private assertApproved(record: PlanRecord): void {
    if (
      record.approvedHash === null ||
      record.approvedBy === null ||
      record.approvedHash !== record.contentHash ||
      planHash(record.plan) !== record.approvedHash
    ) {
      throw invalid("This plan was not approved in its current form; approve it again");
    }
  }

  /** One task: the only place a capability command is requested. */
  private async createOne(
    record: PlanRecord,
    run: TaskRun,
    actor: PlanActor,
  ): Promise<CreationReport["failure"]> {
    const input = this.inputFor(record, run.taskIndex, run.idempotencyKey);
    this.store.markAttempting(record.id, run.taskIndex, this.stamp());
    try {
      const result = await this.o.gateway.call(this.callFor(record, input, actor));
      const made = readCreated(record.plan.destination, result.output);
      if (made === null) {
        const message =
          "The capability answered, but not with a task Phoenix could read; retry finds it by its key";
        this.store.markFailed(record.id, run.taskIndex, message, this.stamp());
        return { taskIndex: run.taskIndex, message };
      }
      this.store.markCreated({
        id: `link_${crypto.randomUUID().replaceAll("-", "")}`,
        record,
        taskIndex: run.taskIndex,
        externalId: made.externalId,
        url: made.url,
        at: this.stamp(),
      });
      this.o.audit("plan.task.created", {
        plan_id: record.id,
        meeting_id: record.meetingId,
        task_index: run.taskIndex,
        system: record.target,
        result: made.status,
        audit_id: result.auditId,
      });
      return null;
    } catch (err) {
      const message = messageOf(err);
      this.store.markFailed(record.id, run.taskIndex, message, this.stamp());
      this.o.audit("plan.task.failed", {
        plan_id: record.id,
        meeting_id: record.meetingId,
        task_index: run.taskIndex,
        code: isRecord(err) && typeof err.code === "string" ? err.code : "ERROR",
      });
      return { taskIndex: run.taskIndex, message };
    }
  }

  /**
   * Run once at startup: a plan left `creating` by a crash becomes `failed`, so the person can
   * retry it. The task that was in flight stays `attempting`; its retry sends the same idempotency
   * key, and the capability finds the issue/task if the request had in fact gone through.
   */
  recover(): number {
    let n = 0;
    for (const record of this.store.listByStatus("creating")) {
      if (this.store.moveStatus(record.id, "creating", "failed", this.stamp())) {
        n++;
        this.o.audit("plan.recovered", { plan_id: record.id, meeting_id: record.meetingId });
      }
    }
    return n;
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Stable per plan task and unique across plans. Matches the capabilities' key pattern. */
export function idempotencyKey(planId: string, taskIndex: number): string {
  return `phx_${createHash("sha256").update(planId).digest("hex").slice(0, 24)}_${taskIndex}`;
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return (redact(text) as string).slice(0, MAX_ERROR);
}

const BASIS_NOTE: Record<Statement["basis"], string> = {
  meeting: "",
  suggested: " _(suggested by the model)_",
  user: "",
};

function statementLine(s: Statement): string {
  return `- ${s.text}${BASIS_NOTE[s.basis]}`;
}

/** The text of one created task. Deterministic, size-capped, free of quotes from the transcript. */
export function renderBody(plan: EngineeringPlan, taskIndex: number, origin: string): string {
  const task = plan.tasks[taskIndex];
  if (!task) return "";
  const parts: string[] = [];
  if (task.body) parts.push(task.body);
  if (task.basis === "suggested") parts.push("_This task was suggested by the model._");
  if (plan.notAiGenerated) parts.push("_Not AI generated: made from the meeting item text only._");
  parts.push(`**Plan:** ${plan.title}`);
  if (plan.summary.text)
    parts.push(`**Summary:** ${plan.summary.text}${BASIS_NOTE[plan.summary.basis]}`);
  if (plan.acceptanceCriteria.length > 0) {
    parts.push(
      ["**Acceptance criteria**", ...plan.acceptanceCriteria.map(statementLine)].join("\n"),
    );
  }
  if (taskIndex === 0 && plan.risks.length > 0) {
    parts.push(["**Risks**", ...plan.risks.map(statementLine)].join("\n"));
  }
  if (taskIndex === 0 && plan.openQuestions.length > 0) {
    parts.push(["**Open questions**", ...plan.openQuestions.map((q) => `- ${q}`)].join("\n"));
  }
  if (taskIndex === 0 && plan.frappe) {
    const d = plan.frappe;
    parts.push(
      [
        `**Proposed DocType: ${d.doctype}** _(suggested by the model)_`,
        ...d.fields.map((f) => `- ${f.label} (${f.fieldtype}${f.required ? ", required" : ""})`),
        d.workflowStates.length > 0 ? `Workflow states: ${d.workflowStates.join(" → ")}` : "",
        ...d.permissions.map(
          (p) =>
            `Role ${p.role}: ${
              [p.read ? "read" : "", p.write ? "write" : "", p.create ? "create" : ""]
                .filter(Boolean)
                .join(", ") || "no access"
            }`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  parts.push(`_Task ${taskIndex + 1} of ${plan.tasks.length} · ${origin}_`);
  const text = parts.join("\n\n");
  return text.length > MAX_RENDERED_BODY ? `${text.slice(0, MAX_RENDERED_BODY - 1)}…` : text;
}

interface Created {
  status: "created" | "existing";
  externalId: string;
  url: string;
}

/** Reads a capability's output for a created task, or null if it is not the expected shape. */
export function readCreated(destination: Destination, output: unknown): Created | null {
  if (!isRecord(output)) return null;
  const { status, url } = output;
  if ((status !== "created" && status !== "existing") || typeof url !== "string") return null;
  if (!/^https?:\/\/[^\s]+$/.test(url) || url.length > 500) return null;
  if (destination.system === "github") {
    const n = output.number;
    return typeof n === "number" && Number.isSafeInteger(n) && n > 0
      ? { status, externalId: String(n), url }
      : null;
  }
  const name = output.name;
  return typeof name === "string" && name.length > 0 && name.length <= 140
    ? { status, externalId: name, url }
    : null;
}

function keep<T extends { text: string }>(old: T | undefined, text: string): Statement {
  return old && old.text === text && "basis" in old
    ? (old as unknown as Statement)
    : { text, basis: "user" };
}

function statements(
  next: readonly string[] | undefined,
  old: readonly Statement[],
  max: number,
  cap: number,
  what: string,
): Statement[] {
  if (next === undefined) return [...old];
  if (next.length > cap) throw invalid(`At most ${cap} ${what}`);
  const out: Statement[] = [];
  next.forEach((raw, i) => {
    const text = cleanText(raw.replace(/\s+/g, " "), max);
    if (text.length > 0) out.push(keep(old[i], text));
  });
  return out;
}

/** Applies a person's edit to a plan. Validates and cleans every field. */
export function applyEdit(plan: EngineeringPlan, change: PlanEdit): EngineeringPlan {
  const next: EngineeringPlan = { ...plan };
  if (change.title !== undefined) {
    const title = cleanText(change.title.replace(/\s+/g, " "), MAX_TASK_TITLE);
    if (title.length === 0) throw invalid("The title cannot be empty");
    next.title = title;
  }
  if (change.summary !== undefined) {
    const text = cleanText(change.summary.replace(/\s+/g, " "), MAX_SUMMARY);
    if (text.length === 0) throw invalid("The summary cannot be empty");
    next.summary = keep(plan.summary, text);
  }
  next.acceptanceCriteria = statements(
    change.acceptanceCriteria,
    plan.acceptanceCriteria,
    MAX_STATEMENT,
    MAX_CRITERIA,
    "acceptance criteria",
  );
  next.risks = statements(change.risks, plan.risks, MAX_STATEMENT, MAX_RISKS, "risks");
  if (change.openQuestions !== undefined) {
    if (change.openQuestions.length > MAX_QUESTIONS)
      throw invalid(`At most ${MAX_QUESTIONS} questions`);
    next.openQuestions = change.openQuestions
      .map((q) => cleanText(q.replace(/\s+/g, " "), MAX_QUESTION))
      .filter((q) => q.length > 0);
  }
  if (change.tasks !== undefined) {
    if (change.tasks.length < 1 || change.tasks.length > MAX_TASKS) {
      throw invalid(`A plan needs 1 to ${MAX_TASKS} tasks`);
    }
    next.tasks = change.tasks.map((t, i): PlanTask => {
      const title = cleanText(t.title.replace(/\s+/g, " "), MAX_TASK_TITLE);
      if (title.length === 0) throw invalid(`Task ${i + 1} needs a title`);
      const body = cleanText(t.body, MAX_TASK_BODY);
      const labels = (t.labels ?? [])
        .map((l) => cleanText(l.replace(/\s+/g, " "), 50).toLowerCase())
        .filter((l) => l.length > 0)
        .slice(0, 5);
      const old = plan.tasks[i];
      const same = old && old.title === title && old.body === body;
      const base = { title, body, labels };
      return same && old ? { ...old, labels } : { ...base, basis: "user" };
    });
  }
  if (change.destination !== undefined) {
    if (change.destination.system !== plan.destination.system) {
      throw invalid("A plan cannot move between GitHub and Frappe; make a new plan");
    }
    next.destination = validateDestination(change.destination);
  }
  return next;
}
