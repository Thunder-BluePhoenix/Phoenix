// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { SpecialistContract } from "@phoenix/ai-orchestrator";
import { parseCiFailureInput, type CiFailureInput } from "./ci-failure";

export interface CiInvestigationHandoff {
  summary: string;
  claims: { text: string; evidence_ids: string[] }[];
  recommendations: { text: string; evidence_ids: string[] }[];
  provenance: { agent: "ci-failure"; ai_used: boolean };
}

/** Pure advisory handoff: the existing CI agent still owns observation, model grounding and verification. */
export const CI_SPECIALIST_CONTRACT: SpecialistContract<CiFailureInput, CiInvestigationHandoff> = {
  identity: { id: "ci-failure", kind: "ci_failure", version: "1.0.0" },
  tools: ["github.ci.failure_details", "git.recent_commits"],
  context: {
    scopes: ["repo:self"],
    domains: ["git", "project", "general"],
    maxSensitivity: "internal",
  },
  inputSchema: {
    type: "object",
    required: ["repository"],
    additionalProperties: false,
    properties: {
      repository: {
        type: "string",
        pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}/(?!\\.{1,2}$)[A-Za-z0-9._-]{1,100}$",
      },
      run_id: { type: "integer", minimum: 1 },
    },
  },
  parseInput: parseCiFailureInput,
  outputSchema: {
    type: "object",
    required: ["summary", "claims", "recommendations", "provenance"],
    additionalProperties: false,
    properties: {
      summary: { type: "string", minLength: 1 },
      claims: {
        type: "array",
        items: {
          type: "object",
          required: ["text", "evidence_ids"],
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            evidence_ids: { type: "array", minItems: 1, items: { type: "string" } },
          },
        },
      },
      recommendations: {
        type: "array",
        items: {
          type: "object",
          required: ["text", "evidence_ids"],
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            evidence_ids: { type: "array", minItems: 1, items: { type: "string" } },
          },
        },
      },
      provenance: {
        type: "object",
        required: ["agent", "ai_used"],
        additionalProperties: false,
        properties: { agent: { const: "ci-failure" }, ai_used: { type: "boolean" } },
      },
    },
  },
  scope: {
    resourcePrefix: "repo:",
    dataClass: "internal",
    maxSteps: 2,
    maxToolCalls: 4,
    resourceFor: (input) => `repo:${input.repository}`,
  },
  approval: "none",
  timeoutMs: 120_000,
  handoff(conclusion) {
    return {
      summary: conclusion.summary,
      claims: (conclusion.diagnosis?.claims ?? [])
        .filter((c) => c.grounded)
        .map((c) => ({ text: c.text, evidence_ids: c.evidenceIds })),
      recommendations: conclusion.proposals
        .filter((p) => p.grounded && p.advisory)
        .map((p) => ({ text: p.text, evidence_ids: p.evidenceIds })),
      provenance: { agent: "ci-failure", ai_used: conclusion.aiUsed },
    };
  },
  evaluate(output, ids) {
    const references = [...output.claims, ...output.recommendations];
    return references.every((entry) => entry.evidence_ids.every((id) => ids.has(id)))
      ? []
      : ["CI handoff contains an unknown evidence identifier"];
  },
};
