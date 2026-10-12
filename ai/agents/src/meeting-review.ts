// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { AgentDefinition, Conclusion, SpecialistContract } from "@phoenix/ai-orchestrator";
import { isRecord } from "./guards";

export interface MeetingReviewInput {
  meeting_id: string;
}
export interface MeetingDecisionHandoff {
  meeting_id: string;
  decisions: { text: string; evidence_ids: string[] }[];
  action_items: string[];
  provenance: { source: "kage.meeting.get_summary"; evidence_id: string };
}
interface MeetingSummary {
  decisions: string[];
  actionItems: string[];
  text: string;
}

const TOOL = "kage.meeting.get_summary";
const KIND = "meeting_decision_review";
const ID = "meeting-decision-review";
const VERSION = "1.0.0";

function inputOf(input: unknown): MeetingReviewInput | string {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => key !== "meeting_id") ||
    typeof input.meeting_id !== "string" ||
    !/^[0-9]{1,18}$/.test(input.meeting_id)
  )
    return '"meeting_id" must be a numeric meeting identifier';
  return { meeting_id: input.meeting_id };
}

function parseSummary(value: unknown): MeetingSummary | null {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    !Array.isArray(value.decisions) ||
    value.decisions.length > 8 ||
    !value.decisions.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 120,
    ) ||
    !Array.isArray(value.action_items) ||
    value.action_items.length > 8 ||
    !value.action_items.every((item) => typeof item === "string" && item.length <= 120)
  )
    return null;
  return {
    text: value.text.slice(0, 200),
    decisions: value.decisions,
    actionItems: value.action_items,
  };
}

export function createMeetingReviewAgent(): AgentDefinition & {
  specialist: SpecialistContract<MeetingReviewInput, MeetingDecisionHandoff>;
} {
  const observations = new Map<string, { summary: MeetingSummary; evidenceId: string }>();
  const contract: SpecialistContract<MeetingReviewInput, MeetingDecisionHandoff> = {
    identity: { id: ID, kind: KIND, version: VERSION },
    tools: [TOOL],
    context: { scopes: ["meeting:self"], domains: ["meeting"], maxSensitivity: "sensitive" },
    inputSchema: {
      type: "object",
      required: ["meeting_id"],
      additionalProperties: false,
      properties: { meeting_id: { type: "string", pattern: "^[0-9]{1,18}$" } },
    },
    parseInput: inputOf,
    outputSchema: {
      type: "object",
      required: ["meeting_id", "decisions", "action_items", "provenance"],
      additionalProperties: false,
      properties: {
        meeting_id: { type: "string", pattern: "^[0-9]{1,18}$" },
        decisions: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            required: ["text", "evidence_ids"],
            additionalProperties: false,
            properties: {
              text: { type: "string", minLength: 1, maxLength: 500 },
              evidence_ids: { type: "array", minItems: 1, items: { type: "string" } },
            },
          },
        },
        action_items: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
        provenance: {
          type: "object",
          required: ["source", "evidence_id"],
          additionalProperties: false,
          properties: { source: { const: TOOL }, evidence_id: { type: "string" } },
        },
      },
    },
    scope: {
      resourcePrefix: "meeting:",
      dataClass: "sensitive",
      maxSteps: 1,
      maxToolCalls: 1,
      resourceFor: (input) => `meeting:${input.meeting_id}`,
    },
    approval: "none",
    timeoutMs: 30_000,
    handoff(conclusion) {
      const metadata = conclusion.diagnosis;
      if (!metadata || !/^meeting:[0-9]{1,18}$/.test(metadata.summary))
        throw new Error("Meeting handoff lacks verified identity");
      const evidenceId = metadata.claims[0]?.evidenceIds[0] ?? "";
      return {
        meeting_id: metadata.summary.slice(8),
        decisions: conclusion.proposals
          .filter((p) => p.grounded && p.advisory)
          .map((p) => ({ text: p.text, evidence_ids: p.evidenceIds })),
        action_items: metadata.claims
          .slice(1)
          .filter((c) => c.grounded)
          .map((c) => c.text),
        provenance: { source: TOOL, evidence_id: evidenceId },
      };
    },
    evaluate(output, ids) {
      const referenced = [
        output.provenance.evidence_id,
        ...output.decisions.flatMap((d) => d.evidence_ids),
      ];
      return referenced.every((id) => ids.has(id)) &&
        output.decisions.every((d) => d.evidence_ids.includes(output.provenance.evidence_id))
        ? []
        : ["Meeting provenance is not grounded in this run"];
    },
  };
  return {
    specialist: contract,
    descriptor: contract.identity,
    allowedCapabilities: ["kage"],
    allowedTools: contract.tools,
    classify(task) {
      const input = inputOf(task.input);
      if (typeof input === "string") return { ok: false, reason: input };
      return {
        ok: true,
        title: `Meeting ${input.meeting_id} decision review`,
        target: {
          environment: "local",
          resource: `meeting:${input.meeting_id}`,
          dataClass: "sensitive",
        },
      };
    },
    plan(rc) {
      const input = inputOf(rc.task.input);
      if (typeof input === "string") throw new Error(input);
      return {
        steps: [
          {
            index: 0,
            tool: TOOL,
            input,
            purpose: "Read existing Kage summary for decision review",
          },
        ],
      };
    },
    afterTool(rc, _step, output) {
      const summary = parseSummary(output);
      if (!summary) throw new Error("Meeting summary is missing or malformed");
      const input = inputOf(rc.task.input);
      if (typeof input === "string") throw new Error(input);
      const evidenceId = rc.evidence.add({
        kind: "tool_output",
        source: `${TOOL}#${input.meeting_id}`,
        text: JSON.stringify(summary),
        maxChars: 1500,
      }).id;
      observations.set(rc.runId, { summary, evidenceId });
    },
    async conclude(rc): Promise<Conclusion> {
      const observed = observations.get(rc.runId);
      if (!observed) throw new Error("Meeting summary was not observed");
      const input = inputOf(rc.task.input);
      if (typeof input === "string") throw new Error(input);
      const { summary, evidenceId } = observed;
      return {
        summary: `Reviewed ${summary.decisions.length} recorded decision(s) for meeting ${input.meeting_id}; advisory only.`,
        aiUsed: false,
        modelCalls: 0,
        proposals: summary.decisions.map((text) => ({
          text,
          rationale: "Recorded in Kage summary; review before acting",
          evidenceIds: [evidenceId],
          advisory: true,
          grounded: true,
        })),
        diagnosis: {
          summary: `meeting:${input.meeting_id}`,
          claims: [
            {
              text: "Kage summary observed",
              evidenceIds: [evidenceId],
              grounded: true,
              origin: "rule",
            },
            ...summary.actionItems.map((text) => ({
              text,
              evidenceIds: [evidenceId],
              grounded: true,
              origin: "rule" as const,
            })),
          ],
          evidenceCoverage: 1,
          aiUsed: false,
        },
      };
    },
    async verify(rc, conclusion) {
      const observed = observations.get(rc.runId);
      const grounded =
        !!observed &&
        rc.evidence
          .list()
          .some(
            (e) =>
              e.id === observed.evidenceId &&
              !e.truncated &&
              e.excerpt.includes(JSON.stringify(observed.summary.decisions)),
          ) &&
        conclusion.proposals.every(
          (p) =>
            p.advisory && p.evidenceIds.length === 1 && p.evidenceIds[0] === observed.evidenceId,
        );
      return {
        conclusion,
        verification: {
          passed: grounded,
          checks: [
            {
              name: "meeting_summary_provenance",
              passed: grounded,
              detail: grounded
                ? "summary observed and decisions cited"
                : "missing or mismatched source",
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
