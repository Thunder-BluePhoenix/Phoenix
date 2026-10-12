// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";

/** Exposed exclusively through session-token user routes; never through capabilities or tools. */
export interface ImprovementApi {
  availability(): unknown;
  recordFeedback(input: {
    taskId: string;
    rating: "helpful" | "unhelpful";
    trainingOptIn?: boolean;
  }): unknown;
  getFeedback(id: string): unknown;
  propose(
    feedbackId: string,
    change:
      | { target: "ops.prompt"; promptAddendum: string }
      | { target: "retrieval.limit"; retrievalLimit: number },
  ): unknown;
  getProposal(id: string): unknown;
  evaluate(id: string): Promise<unknown>;
  approve(id: string, candidateHash: string, evidenceHash: string): unknown;
  activate(id: string, candidateHash: string, evidenceHash: string): unknown;
  active(): unknown;
  rollback(version: string): unknown;
  auditHistory(id: string): unknown;
}

const bad = (message: string): never => {
  throw new PhoenixError(ErrorCode.INVALID_REQUEST, message);
};
const idOf = (value: string | undefined): string => {
  if (!value || value.length > 200)
    throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Improvement record not found");
  return value;
};
const keys = (body: Record<string, unknown>, allowed: readonly string[]): void => {
  if (Object.keys(body).some((key) => !allowed.includes(key))) bad("Unknown improvement field");
};
const hash = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    bad("Candidate hash must be SHA-256 hex");
  return value as string;
};

export function improvementRoutes(s: { improvement?: ImprovementApi }): Route[] {
  const api = (): ImprovementApi => {
    if (!s.improvement)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Improvement unavailable");
    return s.improvement;
  };
  return [
    route("GET", "/api/improvement", () => api().availability()),
    route("GET", "/api/improvement/active", () => ({ activation: api().active() })),
    route("POST", "/api/improvement/feedback", async ({ body }) => {
      const b = expectObject(await body());
      keys(b, ["task_id", "rating", "training_opt_in"]);
      if (
        typeof b.task_id !== "string" ||
        b.task_id.length === 0 ||
        b.task_id.length > 200 ||
        (b.rating !== "helpful" && b.rating !== "unhelpful") ||
        (b.training_opt_in !== undefined && typeof b.training_opt_in !== "boolean")
      )
        bad("Invalid feedback");
      return api().recordFeedback({
        taskId: b.task_id as string,
        rating: b.rating as "helpful" | "unhelpful",
        ...(b.training_opt_in === undefined ? {} : { trainingOptIn: b.training_opt_in as boolean }),
      });
    }),
    route("GET", "/api/improvement/feedback/:id", ({ params }) => {
      const item = api().getFeedback(idOf(params.id));
      if (!item) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Feedback not found");
      return item;
    }),
    route("POST", "/api/improvement/proposals", async ({ body }) => {
      const b = expectObject(await body());
      keys(b, ["feedback_id", "change"]);
      if (typeof b.feedback_id !== "string" || b.feedback_id.length > 200 || !b.feedback_id)
        bad("Invalid feedback id");
      const c = expectObject(b.change);
      if (c.target === "ops.prompt") {
        keys(c, ["target", "promptAddendum"]);
        if (typeof c.promptAddendum !== "string") bad("Invalid prompt candidate");
        return api().propose(b.feedback_id as string, {
          target: "ops.prompt",
          promptAddendum: c.promptAddendum as string,
        });
      }
      if (c.target === "retrieval.limit") {
        keys(c, ["target", "retrievalLimit"]);
        if (typeof c.retrievalLimit !== "number") bad("Invalid retrieval candidate");
        return api().propose(b.feedback_id as string, {
          target: "retrieval.limit",
          retrievalLimit: c.retrievalLimit as number,
        });
      }
      return bad("Only safe prompt or retrieval candidates are supported");
    }),
    route("GET", "/api/improvement/proposals/:id", ({ params }) => {
      const proposal = api().getProposal(idOf(params.id));
      if (!proposal) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Proposal not found");
      return proposal;
    }),
    route("GET", "/api/improvement/proposals/:id/audit", ({ params }) => ({
      events: api().auditHistory(idOf(params.id)),
    })),
    route("POST", "/api/improvement/proposals/:id/evaluate", async ({ params, body }) => {
      keys(expectObject(await body()), []);
      return api().evaluate(idOf(params.id));
    }),
    route("POST", "/api/improvement/proposals/:id/approve", async ({ params, body }) => {
      const b = expectObject(await body());
      keys(b, ["candidate_hash", "evidence_hash"]);
      return api().approve(idOf(params.id), hash(b.candidate_hash), hash(b.evidence_hash));
    }),
    route("POST", "/api/improvement/proposals/:id/activate", async ({ params, body }) => {
      const b = expectObject(await body());
      keys(b, ["candidate_hash", "evidence_hash"]);
      return api().activate(idOf(params.id), hash(b.candidate_hash), hash(b.evidence_hash));
    }),
    route("POST", "/api/improvement/active/:version/rollback", async ({ params, body }) => {
      keys(expectObject(await body()), []);
      return api().rollback(idOf(params.version));
    }),
  ];
}
