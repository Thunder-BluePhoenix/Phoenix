// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { intParam, route, type Route } from "./http";
import type { CoreServices } from "./services";

export interface AgentApprovalQuestionView {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export interface AgentApprovalDecisionView {
  behavior: "allow" | "deny";
  message?: string;
  answers?: Record<string, string>;
}

/** One pending request as listed. Never carries the waiter's nonce. */
export interface AgentApprovalPendingView {
  id: string;
  kind: "permission" | "question";
  agent: string;
  project: string;
  tool: string;
  input_summary: { command?: string; path?: string; description?: string };
  questions?: AgentApprovalQuestionView[];
  created_at: string;
  expires_at: string;
  /** Whether an "Always allow here" rule may be created from this request. */
  always_ok: boolean;
}

export type AgentApprovalCreateResult =
  | { id: string; nonce: string; digest: string; expires_at: string; status: "pending" }
  | {
      id: string;
      digest: string;
      status: "decided";
      decision: AgentApprovalDecisionView;
      decided_by: "policy" | "rule";
    }
  | {
      id: string;
      digest: string;
      status: "terminal";
      reason: "kill_switch" | "too_many_pending";
    };

export type AgentApprovalWaitResult =
  | { id: string; digest: string; status: "pending" }
  | {
      id: string;
      digest: string;
      status: "decided";
      decision: AgentApprovalDecisionView;
      decided_by: "user" | "policy" | "rule";
    }
  | { id: string; digest: string; status: "expired" | "cancelled" | "terminal" };

export interface AgentApprovalRuleView {
  id: string;
  project: string;
  tool: string;
  pattern: string;
  created_at: string;
  expires_at: string;
  created_by: string;
  uses: number;
}

export interface AgentApprovalHistoryRow {
  id: string;
  at: string;
  agent: string;
  project: string;
  tool: string;
  command: string;
  outcome: string;
  decided_by: string;
  client?: string;
}

/**
 * Coding-agent permission requests and questions (Phase 56). Reached only through the
 * session-token routes below (or the Phase 57 relay's create/wait ops); none of it is a
 * capability command or tool, so an agent cannot call `decide` or manage rules.
 */
export interface AgentApprovalsApi {
  create(body: unknown): AgentApprovalCreateResult;
  wait(id: string, body: unknown): Promise<AgentApprovalWaitResult>;
  list(): AgentApprovalPendingView[];
  decide(
    id: string,
    body: unknown,
    client?: string,
  ): { id: string; outcome: "allow" | "deny" | "terminal"; rule?: AgentApprovalRuleView };
  history(limit?: number): AgentApprovalHistoryRow[];
  rules(): AgentApprovalRuleView[];
  revokeRule(id: string): void;
}

export function agentApprovalRoutes(s: CoreServices): Route[] {
  const approvals = () => {
    if (!s.agentApprovals)
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Agent approvals not found");
    return s.agentApprovals;
  };
  return [
    route("POST", "/api/agent-approvals", async ({ res, body }) => {
      const created = approvals().create(await body());
      res.statusCode = 201;
      return created;
    }),
    route("GET", "/api/agent-approvals", () => ({ approvals: approvals().list() })),
    route("GET", "/api/agent-approvals/history", ({ url }) => {
      const limit = intParam(url, "limit");
      return { history: approvals().history(limit) };
    }),
    route("GET", "/api/agent-approvals/rules", () => ({ rules: approvals().rules() })),
    // The body of a revoke carries nothing; whatever the caller sends (`{}` included) is ignored.
    route("DELETE", "/api/agent-approvals/rules/:id", ({ params }) => {
      approvals().revokeRule(params.id!);
      return { id: params.id, revoked: true };
    }),
    route("POST", "/api/agent-approvals/:id/wait", async ({ params, body }) =>
      approvals().wait(params.id!, await body()),
    ),
    route("POST", "/api/agent-approvals/:id/decision", async ({ req, params, body }) => {
      const client = req.headers["x-phoenix-client"];
      return approvals().decide(
        params.id!,
        await body(),
        typeof client === "string" ? client : undefined,
      );
    }),
  ];
}
