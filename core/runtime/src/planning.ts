// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Engineering plans from accepted meeting items, and creating their tasks (Phase 36 wiring).
//
// - The user's preview, approval and creation remain ONLY on session-token routes. A separate
//   opted-in capability reads only bounded aggregate counts, never preview inputs, plan text,
//   destination details, meeting identity, or idempotency keys. Creation goes through the runtime's
//   ToolGateway as USER, with policy, audit and confirmation for every external call.
// - Off unless AI is on AND the destination is configured (write token set, capability enabled, and
//   for Frappe the site listed under `api`). Reading, editing and cancelling existing plans always
//   works.
// - The idempotency key and marker behaviour belong to `PlanService` and the capabilities; this file
//   adds no retry and no second path to a capability.
import { generateWith } from "@phoenix/ai-context";
import { canView } from "@phoenix/ai-memory";
import type { Actor, MeetingItemService } from "@phoenix/ai-meetings";
import type { AiService } from "@phoenix/ai-models";
import {
  PlanService,
  type CreationReport,
  type Destination,
  type EngineeringPlan,
  type PlanEdit,
  type PlanLink,
  type PlanRecord,
  type Statement,
  type TaskRun,
} from "@phoenix/ai-planning";
import type { ToolGateway } from "@phoenix/ai-tool-gateway";
import type {
  PlanDestinationView,
  PlanDetailView,
  PlanEditInput,
  PlanLinkView,
  PlanningApi,
  PlanningStatusView,
  PlanStatementView,
  PlanTaskRunView,
  PlanView,
} from "@phoenix/api";
import type { CapabilityManager } from "@phoenix/capability-manager";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database, MeetingStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/** A deliberately text-free, bounded projection. Counts include tasks and summary/criteria/risk statements; no preview inputs or creation keys. */
export interface PlanReviewContext {
  plan_id: string;
  status: EngineeringPlanStatus;
  task_count: number;
  meeting_grounded_count: number;
  suggested_count: number;
  user_edited_count: number;
  criteria_count: number;
  risk_count: number;
  open_question_count: number;
}

type EngineeringPlanStatus = PlanRecord["status"];

const GITHUB = "github";
const FRAPPE = "frappe";
const WRITE_SECRET = "write_token";

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

function statementView(s: Statement): PlanStatementView {
  return {
    text: s.text,
    basis: s.basis,
    ...(s.itemId === undefined ? {} : { item_id: s.itemId }),
    ...(s.quote === undefined ? {} : { quote: s.quote }),
  };
}

function planView(r: PlanRecord): PlanView {
  const p: EngineeringPlan = r.plan;
  return {
    id: r.id,
    meeting_id: r.meetingId,
    item_id: r.itemId,
    target: r.target,
    destination: p.destination,
    status: r.status,
    content_hash: r.contentHash,
    approved:
      r.approvedHash !== null && r.approvedBy !== null && r.approvedAt !== null
        ? { hash: r.approvedHash, by: r.approvedBy, at: r.approvedAt }
        : null,
    include_meeting_ref: r.includeMeetingRef,
    title: p.title,
    generated_by: p.generatedBy,
    not_ai_generated: p.notAiGenerated,
    summary: statementView(p.summary),
    acceptance_criteria: p.acceptanceCriteria.map(statementView),
    risks: p.risks.map(statementView),
    open_questions: p.openQuestions,
    tasks: p.tasks.map((t) => ({
      title: t.title,
      body: t.body,
      labels: t.labels,
      basis: t.basis,
      ...(t.itemId === undefined ? {} : { item_id: t.itemId }),
      ...(t.quote === undefined ? {} : { quote: t.quote }),
    })),
    frappe: p.frappe
      ? {
          doctype: p.frappe.doctype,
          fields: p.frappe.fields,
          workflow_states: p.frappe.workflowStates,
          permissions: p.frappe.permissions,
        }
      : null,
    source: {
      item_id: p.source.itemId,
      meeting_id: p.source.meetingId,
      kind: p.source.kind,
      item_text: p.source.itemText,
      owner: p.source.owner,
      due: p.source.due,
      quote: p.source.quote,
    },
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

const runView = (r: TaskRun): PlanTaskRunView => ({
  task_index: r.taskIndex,
  idempotency_key: r.idempotencyKey,
  status: r.status,
  attempts: r.attempts,
  external_id: r.externalId,
  url: r.url,
  error: r.error,
  updated_at: r.updatedAt,
});

const linkView = (l: PlanLink): PlanLinkView => ({
  id: l.id,
  meeting_id: l.meetingId,
  item_id: l.itemId,
  plan_id: l.planId,
  task_index: l.taskIndex,
  system: l.system,
  external_id: l.externalId,
  url: l.url,
  approved_by: l.approvedBy,
  approved_at: l.approvedAt,
  created_at: l.createdAt,
});

function editOf(input: PlanEditInput): PlanEdit {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.acceptance_criteria === undefined
      ? {}
      : { acceptanceCriteria: input.acceptance_criteria }),
    ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
    ...(input.risks === undefined ? {} : { risks: input.risks }),
    ...(input.open_questions === undefined ? {} : { openQuestions: input.open_questions }),
    ...(input.destination === undefined ? {} : { destination: input.destination }),
  };
}

export interface PlanningDeps {
  db: Database;
  items: MeetingItemService;
  meetings: MeetingStore;
  /** The runtime's tool gateway: the only way a task is created. */
  gateway: ToolGateway;
  capabilities: CapabilityManager;
  audit: AuditLog;
  ai: AiService;
  aiEnabled: () => boolean;
  /** The signed-in user as the meeting service sees them (id and viewer). */
  actor: () => Actor;
  logger: Logger;
}

export class PlanningRuntime implements PlanningApi {
  readonly service: PlanService;

  constructor(private readonly d: PlanningDeps) {
    this.service = new PlanService({
      db: d.db,
      items: d.items,
      meetings: d.meetings,
      gateway: d.gateway,
      audit: (action, details) =>
        void d.audit.record({ actor: "user", action, decision: "info", details }),
      // Read on every use: turning AI off applies to the very next plan.
      generate: () => (d.aiEnabled() ? generateWith(d.ai) : null),
    });
    // A plan a crash left `creating` becomes `failed`: the user can retry with the same keys.
    const recovered = this.service.recover();
    if (recovered > 0)
      d.logger.warn("plans left creating were marked failed", { plans: recovered });
  }

  // ── What is configured ─────────────────────────────────────────────────────

  private capability(id: string) {
    return this.d.capabilities.list().find((c) => c.id === id);
  }

  private frappeSites(): string[] {
    const api = this.capability(FRAPPE)?.config.api;
    return typeof api === "object" && api !== null && !Array.isArray(api) ? Object.keys(api) : [];
  }

  status(): PlanningStatusView {
    const github = this.capability(GITHUB);
    const frappe = this.capability(FRAPPE);
    const destinations: PlanningStatusView["destinations"] = {
      github: {
        capability_enabled: github?.status === "enabled",
        write_token_set: github?.secrets.some((s) => s.name === WRITE_SECRET && s.set) === true,
      },
      frappe: {
        capability_enabled: frappe?.status === "enabled",
        write_token_set: frappe?.secrets.some((s) => s.name === WRITE_SECRET && s.set) === true,
        sites: this.frappeSites(),
      },
    };
    const aiEnabled = this.d.aiEnabled();
    const githubReady =
      destinations.github.capability_enabled && destinations.github.write_token_set;
    const frappeReady =
      destinations.frappe.capability_enabled &&
      destinations.frappe.write_token_set &&
      destinations.frappe.sites.length > 0;
    const reasons: string[] = [];
    if (!aiEnabled) reasons.push("AI is turned off. Turn it on in the AI settings to make plans.");
    if (!githubReady && !frappeReady) {
      reasons.push(
        "No destination is set up. Enable the GitHub capability and set its write token, or enable the Frappe capability, set its write token and list the site under api.",
      );
    }
    return {
      enabled: aiEnabled && (githubReady || frappeReady),
      ai_enabled: aiEnabled,
      reasons,
      destinations,
    };
  }

  /** Why this destination cannot be used right now; empty when it can. */
  private unavailable(destination: Destination): string[] {
    const reasons: string[] = [];
    if (!this.d.aiEnabled()) reasons.push("AI is turned off");
    const view = this.capability(destination.system);
    const name = destination.system === "github" ? "GitHub" : "Frappe";
    if (view?.status !== "enabled") reasons.push(`The ${name} capability is not enabled`);
    if (!view?.secrets.some((s) => s.name === WRITE_SECRET && s.set)) {
      reasons.push(`The ${name} write token is not set`);
    }
    if (destination.system === "frappe" && !this.frappeSites().includes(destination.site)) {
      reasons.push(`The site ${destination.site} is not listed under the Frappe api setting`);
    }
    return reasons;
  }

  private requireReady(destination: Destination): void {
    const reasons = this.unavailable(destination);
    if (reasons.length > 0) {
      throw new PhoenixError(
        ErrorCode.CAPABILITY_DISABLED,
        `Planning is off: ${reasons.join("; ")}.`,
        ["PLANNING_OFF", ...reasons],
      );
    }
  }

  private get actor(): Actor {
    return this.d.actor();
  }

  private detail(planId: string): PlanDetailView {
    const record = this.service.get(planId, this.actor);
    return {
      plan: planView(record),
      runs: this.service.runs(planId, this.actor).map(runView),
      links: this.service.store.linksForPlan(planId).map(linkView),
    };
  }

  // ── PlanningApi ────────────────────────────────────────────────────────────

  async generate(itemId: string, destination: PlanDestinationView) {
    this.requireReady(destination);
    const made = await this.service.generate(itemId, destination, this.actor);
    return {
      plan: planView(made.record),
      generation: {
        stats: {
          proposed: made.stats.proposed,
          grounded: made.stats.grounded,
          suggested: made.stats.suggested,
          ignored_fields: made.stats.ignoredFields,
          design_dropped: made.stats.designDropped,
        },
        unavailable: made.unavailable,
      },
    };
  }

  listForMeeting(meetingId: string) {
    return {
      meeting_id: meetingId,
      plans: this.service
        .list(meetingId, this.actor)
        .reverse()
        .map((r) => ({
          id: r.id,
          item_id: r.itemId,
          target: r.target,
          status: r.status,
          title: r.plan.title,
          task_count: r.plan.tasks.length,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        })),
    };
  }

  linksForMeeting(meetingId: string) {
    return {
      meeting_id: meetingId,
      links: this.service.linksForMeeting(meetingId, this.actor).map(linkView),
    };
  }

  linksForTask(system: "github" | "frappe", externalId: string) {
    return { links: this.service.linksForTask(system, externalId).map(linkView) };
  }

  get(planId: string): PlanDetailView {
    return this.detail(planId);
  }

  /** Agent-safe aggregate only; the user's explicit sensitive-meeting opt-in is checked on every read. */
  reviewContext(planId: string, sensitiveMeetingOptIn: boolean): PlanReviewContext {
    if (!sensitiveMeetingOptIn) {
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Sensitive meeting review is off");
    }
    const actor = this.actor;
    if (!actor.viewer) {
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "A meeting viewer is required");
    }
    const record = this.service.get(planId, actor);
    if (
      !canView(actor.viewer, {
        scope: `meeting:${record.meetingId}`,
        domain: "meeting",
        sensitivity: "sensitive",
      })
    ) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "No such plan");
    }
    const statements = [
      record.plan.summary,
      ...record.plan.acceptanceCriteria,
      ...record.plan.risks,
    ];
    const bases = [...statements, ...record.plan.tasks];
    return {
      plan_id: record.id,
      status: record.status,
      task_count: Math.min(record.plan.tasks.length, 100),
      meeting_grounded_count: Math.min(bases.filter((s) => s.basis === "meeting").length, 100),
      suggested_count: Math.min(bases.filter((s) => s.basis === "suggested").length, 100),
      user_edited_count: Math.min(bases.filter((s) => s.basis === "user").length, 100),
      criteria_count: Math.min(record.plan.acceptanceCriteria.length, 100),
      risk_count: Math.min(record.plan.risks.length, 100),
      open_question_count: Math.min(record.plan.openQuestions.length, 100),
    };
  }

  preview(planId: string) {
    return {
      plan_id: planId,
      tasks: this.service.preview(planId, this.actor).map((t) => ({
        task_index: t.taskIndex,
        tool: t.tool,
        input: t.input,
        decision: {
          effect: t.decision.effect,
          risk: t.decision.risk,
          reasons: t.decision.reasons,
          matched: t.decision.matched,
        },
      })),
    };
  }

  edit(planId: string, change: PlanEditInput): PlanDetailView {
    if (Object.keys(editOf(change)).length === 0) throw invalid("Nothing to change");
    this.service.edit(planId, editOf(change), this.actor);
    return this.detail(planId);
  }

  propose(planId: string): PlanDetailView {
    this.service.propose(planId, this.actor);
    return this.detail(planId);
  }

  approve(planId: string, input: { hash: string; includeMeetingRef: boolean }): PlanDetailView {
    this.service.approve(planId, input, this.actor);
    return this.detail(planId);
  }

  async create(planId: string) {
    // Existing plans are readable without a destination, but nothing is sent without one.
    const record = this.service.get(planId, this.actor);
    this.requireReady(record.plan.destination);
    const report: CreationReport = await this.service.create(planId, this.actor);
    return {
      plan: planView(report.plan),
      runs: report.runs.map(runView),
      links: report.links.map(linkView),
      failure: report.failure
        ? { task_index: report.failure.taskIndex, message: report.failure.message }
        : null,
    };
  }

  cancel(planId: string): PlanDetailView {
    this.service.cancel(planId, this.actor);
    return this.detail(planId);
  }
}
