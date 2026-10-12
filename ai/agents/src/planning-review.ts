// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AgentDefinition, Conclusion, SpecialistContract } from "@phoenix/ai-orchestrator";
import { isRecord } from "./guards";

const TOOL = "plans.review_context";
const PLAN_ID = /^plan_[0-9a-f]{32}$/;
const STATUSES: Record<string, true> = {
  draft: true,
  proposed: true,
  approved: true,
  creating: true,
  created: true,
  failed: true,
  cancelled: true,
};
const FIELDS = [
  "task_count",
  "meeting_grounded_count",
  "suggested_count",
  "user_edited_count",
  "criteria_count",
  "risk_count",
  "open_question_count",
] as const;

export interface PlanningReviewInput {
  plan_id: string;
}
export interface PlanningReviewHandoff {
  plan_id: string;
  status: string;
  findings: { text: string; evidence_ids: string[] }[];
  provenance: { source: "plans.review_context"; evidence_id: string };
}
interface PlanSummary extends PlanningReviewInput {
  status: string;
  task_count: number;
  meeting_grounded_count: number;
  suggested_count: number;
  user_edited_count: number;
  criteria_count: number;
  risk_count: number;
  open_question_count: number;
}

function inputOf(value: unknown): PlanningReviewInput | string {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.plan_id !== "string" ||
    !PLAN_ID.test(value.plan_id)
  )
    return "Invalid plan identifier";
  return { plan_id: value.plan_id };
}

function summaryOf(value: unknown): PlanSummary | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 9 ||
    typeof value.plan_id !== "string" ||
    !PLAN_ID.test(value.plan_id) ||
    typeof value.status !== "string" ||
    !STATUSES[value.status]
  )
    return null;
  for (const field of FIELDS) {
    const count = value[field];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 100)
      return null;
  }
  // Each field was checked above; this assertion merely restores the verified object shape.
  const validated = value as unknown as PlanSummary;
  return validated;
}

export function createPlanningReviewAgent(): AgentDefinition & {
  specialist: SpecialistContract<PlanningReviewInput, PlanningReviewHandoff>;
} {
  const observations = new Map<string, { summary: PlanSummary; evidenceId: string }>();
  const contract: SpecialistContract<PlanningReviewInput, PlanningReviewHandoff> = {
    identity: { id: "planning-review", kind: "planning_review", version: "1.0.0" },
    tools: [TOOL],
    context: { scopes: ["meeting:self"], domains: ["meeting"], maxSensitivity: "sensitive" },
    inputSchema: {
      type: "object",
      required: ["plan_id"],
      additionalProperties: false,
      properties: { plan_id: { type: "string", pattern: PLAN_ID.source } },
    },
    parseInput: inputOf,
    outputSchema: {
      type: "object",
      required: ["plan_id", "status", "findings", "provenance"],
      additionalProperties: false,
      properties: {
        plan_id: { type: "string", pattern: PLAN_ID.source },
        status: { enum: Object.keys(STATUSES) },
        findings: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            required: ["text", "evidence_ids"],
            additionalProperties: false,
            properties: {
              text: { type: "string", minLength: 1, maxLength: 200 },
              evidence_ids: { type: "array", minItems: 1, maxItems: 1, items: { type: "string" } },
            },
          },
        },
        provenance: {
          type: "object",
          required: ["source", "evidence_id"],
          additionalProperties: false,
          properties: { source: { const: TOOL }, evidence_id: { type: "string" } },
        },
      },
    },
    scope: {
      resourcePrefix: "plan:",
      dataClass: "sensitive",
      maxSteps: 1,
      maxToolCalls: 1,
      resourceFor: (input) => `plan:${input.plan_id}`,
    },
    approval: "none",
    timeoutMs: 30_000,
    handoff(conclusion) {
      const summary = conclusion.diagnosis?.summary ?? "";
      const match =
        /^(plan_[0-9a-f]{32}):(draft|proposed|approved|creating|created|failed|cancelled)$/.exec(
          summary,
        );
      if (!match) throw new Error("Plan handoff lacks verified identity");
      const evidenceId = conclusion.diagnosis?.claims[0]?.evidenceIds[0] ?? "";
      return {
        plan_id: match[1]!,
        status: match[2]!,
        findings: conclusion.proposals.map((p) => ({ text: p.text, evidence_ids: p.evidenceIds })),
        provenance: { source: TOOL, evidence_id: evidenceId },
      };
    },
    evaluate(output, ids) {
      return ids.has(output.provenance.evidence_id) &&
        output.findings.every(
          (f) => f.evidence_ids.length === 1 && f.evidence_ids[0] === output.provenance.evidence_id,
        )
        ? []
        : ["Plan review provenance is not grounded in this run"];
    },
  };
  return {
    specialist: contract,
    descriptor: contract.identity,
    allowedCapabilities: ["plans"],
    allowedTools: contract.tools,
    classify(task) {
      const input = inputOf(task.input);
      if (typeof input === "string") return { ok: false, reason: input };
      return {
        ok: true,
        title: "Plan aggregate review",
        target: { environment: "local", resource: `plan:${input.plan_id}`, dataClass: "sensitive" },
      };
    },
    plan(rc) {
      const input = inputOf(rc.task.input);
      if (typeof input === "string") throw new Error(input);
      return {
        steps: [
          { index: 0, tool: TOOL, input, purpose: "Read opted-in, text-free plan aggregates" },
        ],
      };
    },
    afterTool(rc, _step, output) {
      const summary = summaryOf(output);
      const input = inputOf(rc.task.input);
      if (!summary || typeof input === "string" || summary.plan_id !== input.plan_id)
        throw new Error("Plan aggregate is missing, mismatched or malformed");
      const evidenceId = rc.evidence.add({
        kind: "tool_output",
        source: `${TOOL}#${input.plan_id}`,
        text: JSON.stringify(summary),
        maxChars: 1000,
      }).id;
      observations.set(rc.runId, { summary, evidenceId });
    },
    async conclude(rc): Promise<Conclusion> {
      const observed = observations.get(rc.runId);
      if (!observed) throw new Error("Plan aggregate was not observed");
      const { summary: s, evidenceId } = observed;
      const findings = [
        `Plan has ${s.task_count} task(s), ${s.criteria_count} acceptance criterion/criteria, ${s.risk_count} risk(s), and ${s.open_question_count} open question(s).`,
        `Across tasks and statements: ${s.meeting_grounded_count} meeting-grounded, ${s.suggested_count} suggested, ${s.user_edited_count} user-edited.`,
      ];
      return {
        summary: `Reviewed text-free aggregates for plan ${s.plan_id}; advisory only.`,
        aiUsed: false,
        modelCalls: 0,
        proposals: findings.map((text) => ({
          text,
          rationale:
            "Observed bounded aggregate only; inspect the plan in the user interface before acting",
          evidenceIds: [evidenceId],
          advisory: true,
          grounded: true,
        })),
        diagnosis: {
          summary: `${s.plan_id}:${s.status}`,
          claims: [
            {
              text: "Authorized aggregate observed",
              evidenceIds: [evidenceId],
              grounded: true,
              origin: "rule",
            },
          ],
          evidenceCoverage: 1,
          aiUsed: false,
        },
      };
    },
    async verify(rc, conclusion) {
      const observed = observations.get(rc.runId);
      const passed =
        !!observed &&
        rc.evidence
          .list()
          .some(
            (e) =>
              e.id === observed.evidenceId &&
              !e.truncated &&
              e.excerpt.includes(JSON.stringify(observed.summary)),
          ) &&
        conclusion.diagnosis?.summary ===
          `${observed.summary.plan_id}:${observed.summary.status}` &&
        conclusion.proposals.every(
          (p) =>
            p.advisory &&
            p.grounded &&
            p.evidenceIds.length === 1 &&
            p.evidenceIds[0] === observed.evidenceId,
        );
      return {
        conclusion,
        verification: {
          passed,
          checks: [
            {
              name: "plan_aggregate_provenance",
              passed,
              detail: passed
                ? "Aggregate observed and findings cited"
                : "Missing or mismatched source",
            },
          ],
        },
      };
    },
    finished(runId) {
      observations.delete(runId);
    },
  };
}
