// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isMessageKey, translate } from "../i18n/store";
import type { PlanBasis, PlanDestination, PlanStatus, PlanTask, PlanTaskRun } from "./types";

/** The limits Core and the plan service enforce (ai/planning generate.ts and service.ts). */
export const MAX_TASKS = 8;
export const MAX_LABELS = 5;
export const MAX_LABEL = 50;
export const MAX_TITLE = 140;
export const MAX_SUMMARY = 600;
export const MAX_TASK_BODY = 6_000;

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const SITE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,148}$/;

export const statusText = (status: PlanStatus): string =>
  translate(`automation.plans.status.${status}`);

export const basisText = (basis: PlanBasis): string => translate(`automation.plans.basis.${basis}`);

export const runText = (status: PlanTaskRun["status"]): string =>
  translate(`automation.plans.run.${status}`);

/** Plain words for the tool a preview names; any other tool is shown as its id. */
export function toolText(tool: string): string {
  if (tool === "github.issue.create") return translate("automation.plans.tool.githubIssue");
  if (tool === "frappe.task.create") return translate("automation.plans.tool.frappeTask");
  return tool;
}

/** A meeting item kind in words ("action item"); a kind this build has no words for as reported. */
export function kindText(kind: string): string {
  const key = `automation.plans.kind.${kind}`;
  return isMessageKey(key) ? translate(key) : kind.replace("_", " ");
}

/** A plan is "rules-based" when no model wrote it; a model's work is labelled as such. */
export function authorshipText(plan: { not_ai_generated: boolean; generated_by: string }): string {
  return plan.not_ai_generated
    ? translate("automation.plans.authorship.rules")
    : translate("automation.plans.authorship.model", {
        model: plan.generated_by.replace(/^ai:/, ""),
      });
}

export function destinationText(d: PlanDestination): string {
  return d.system === "github"
    ? translate("automation.plans.destination.github", { repository: d.repository })
    : translate("automation.plans.destination.frappe", { site: d.site });
}

/** Whether the destination text is valid for its system, with the API's rule. */
export function destinationProblem(d: PlanDestination): string | null {
  if (d.system === "github") {
    return REPOSITORY.test(d.repository) ? null : translate("automation.plans.problem.repository");
  }
  return SITE.test(d.site) ? null : translate("automation.plans.problem.site");
}

export interface TaskDraft {
  title: string;
  body: string;
  labels: string;
}

export interface PlanDraft {
  title: string;
  summary: string;
  tasks: TaskDraft[];
  destination: PlanDestination;
}

export const draftOf = (plan: {
  title: string;
  summary: { text: string };
  tasks: PlanTask[];
  destination: PlanDestination;
}): PlanDraft => ({
  title: plan.title,
  summary: plan.summary.text,
  tasks: plan.tasks.map((t) => ({ title: t.title, body: t.body, labels: t.labels.join(", ") })),
  destination: plan.destination,
});

export const labelsOf = (text: string): string[] =>
  text
    .split(",")
    .map((l) => l.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((l) => l.length > 0);

export interface PlanProblems {
  title?: string;
  summary?: string;
  tasks?: string;
  destination?: string;
  /** Problems by task index. */
  task: Record<number, { title?: string; body?: string; labels?: string }>;
}

/** The API's edit rules, plus the length limits the API would otherwise cut silently. */
export function validatePlanDraft(draft: PlanDraft): PlanProblems {
  const problems: PlanProblems = { task: {} };
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (title.length === 0) problems.title = translate("automation.plans.problem.titleEmpty");
  else if (title.length > MAX_TITLE) {
    problems.title = translate("automation.plans.problem.titleLong", { max: MAX_TITLE });
  }
  const summary = draft.summary.replace(/\s+/g, " ").trim();
  if (summary.length === 0) problems.summary = translate("automation.plans.problem.summaryEmpty");
  else if (summary.length > MAX_SUMMARY) {
    problems.summary = translate("automation.plans.problem.summaryLong", { max: MAX_SUMMARY });
  }
  if (draft.tasks.length < 1 || draft.tasks.length > MAX_TASKS) {
    problems.tasks = translate("automation.plans.problem.taskCount", { max: MAX_TASKS });
  }
  draft.tasks.forEach((t, i) => {
    const found: { title?: string; body?: string; labels?: string } = {};
    const taskTitle = t.title.replace(/\s+/g, " ").trim();
    if (taskTitle.length === 0)
      found.title = translate("automation.plans.problem.taskTitle", { n: i + 1 });
    else if (taskTitle.length > MAX_TITLE) {
      found.title = translate("automation.plans.problem.titleLong", { max: MAX_TITLE });
    }
    if (t.body.trim().length > MAX_TASK_BODY) {
      found.body = translate("automation.plans.problem.bodyLong", { max: MAX_TASK_BODY });
    }
    const labels = labelsOf(t.labels);
    if (labels.length > MAX_LABELS)
      found.labels = translate("automation.plans.problem.labelCount", { max: MAX_LABELS });
    else if (labels.some((l) => l.length > MAX_LABEL)) {
      found.labels = translate("automation.plans.problem.labelLong", { max: MAX_LABEL });
    }
    if (Object.keys(found).length > 0) problems.task[i] = found;
  });
  const destination = destinationProblem(draft.destination);
  if (destination) problems.destination = destination;
  return problems;
}

export const hasPlanProblems = (p: PlanProblems): boolean =>
  Object.keys(p).length > 1 || Object.keys(p.task).length > 0;

/** Body of POST /api/plans/:id/edit with only what changed; empty when nothing did. */
export interface PlanEditBody {
  title?: string;
  summary?: string;
  tasks?: { title: string; body: string; labels: string[] }[];
  destination?: PlanDestination;
}

export function planEditBody(before: PlanDraft, after: PlanDraft): PlanEditBody {
  const body: PlanEditBody = {};
  if (after.title.trim() !== before.title.trim()) body.title = after.title.trim();
  if (after.summary.trim() !== before.summary.trim()) body.summary = after.summary.trim();
  const tasks = after.tasks.map((t) => ({
    title: t.title.trim(),
    body: t.body,
    labels: labelsOf(t.labels),
  }));
  const was = before.tasks.map((t) => ({
    title: t.title.trim(),
    body: t.body,
    labels: labelsOf(t.labels),
  }));
  if (JSON.stringify(tasks) !== JSON.stringify(was)) body.tasks = tasks;
  if (JSON.stringify(after.destination) !== JSON.stringify(before.destination)) {
    body.destination = after.destination;
  }
  return body;
}

/** Which task is waiting for the user's approval while a create request is open (1-based). */
export function waitingTask(runs: PlanTaskRun[], total: number): number {
  const done = runs.filter((r) => r.status === "created").length;
  return Math.min(done + 1, Math.max(total, 1));
}

/** Plan statuses from which the plan can still be cancelled (not while creating). */
export const CANCELLABLE: Record<PlanStatus, boolean> = {
  draft: true,
  proposed: true,
  approved: true,
  creating: false,
  created: false,
  failed: true,
  cancelled: false,
};
