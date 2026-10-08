// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { validateRule, type PolicyRule } from "./rules";
import type { PolicyStore, TemporaryApproval } from "./store";
import {
  ENVIRONMENTS,
  PolicyError,
  type Actor,
  type Environment,
  type PolicyAuditSink,
} from "./types";

export const MAX_APPROVAL_TTL_MS = 24 * 60 * 60_000;
export const MAX_ACTIVE_APPROVALS = 100;
export const MAX_RULES = 500;

const TOOL_PATTERN = /^[a-z][a-z0-9_-]*\.(\*|[a-z0-9_]+(\.[a-z0-9_]+)*)$/;

export interface ApprovalScope {
  environment: Environment;
  /** Exact resource, or a prefix ending in `*` with at least one character before it. */
  resource: string;
  /** Limit the approval to one agent id. */
  actorId?: string;
}

export interface TemporaryApprovalRequest {
  toolPattern: string;
  scope: ApprovalScope;
  ttlMs: number;
  /** Who is approving. Must be an authenticated user. */
  by: Actor;
}

export interface PolicyAdminOptions {
  store: PolicyStore;
  audit: PolicyAuditSink;
  now?: () => number;
}

/**
 * The only way to change policy: add or remove rules, grant or revoke temporary approvals.
 *
 * This is a capability object. The API layer constructs one for requests that arrived on an
 * authenticated user channel (session token, Pet Panel); the agent runtime and the tool gateway
 * receive only a `PolicyEngine`, which has no mutating method, so nothing an agent reads, writes
 * or says can reach this class. As defence in depth every method also refuses any actor that is
 * not `kind: "user"` with `trustedByUser: true`, and writes the refusal to the audit log.
 */
export class PolicyAdmin {
  private readonly store: PolicyStore;
  private readonly audit: PolicyAuditSink;
  private readonly now: () => number;

  constructor(o: PolicyAdminOptions) {
    this.store = o.store;
    this.audit = o.audit;
    this.now = o.now ?? Date.now;
  }

  addRule(by: Actor, ruleInput: unknown): PolicyRule {
    this.requireUser(by, "policy.rule.add");
    const rule = validateRule(ruleInput);
    if (this.store.ruleCount() >= MAX_RULES)
      throw new PolicyError("LIMIT_REACHED", `At most ${MAX_RULES} rules are allowed`);
    this.record(by, "policy.rule.added", { rule });
    this.store.insertRule(rule, by.id, this.now());
    return rule;
  }

  removeRule(by: Actor, id: string): void {
    this.requireUser(by, "policy.rule.remove");
    this.record(by, "policy.rule.removed", { ruleId: id });
    if (!this.store.deleteRule(id)) throw new PolicyError("NOT_FOUND", `No rule "${id}"`);
  }

  approveTemporarily(request: TemporaryApprovalRequest): TemporaryApproval {
    const { toolPattern, scope, ttlMs, by } = request;
    this.requireUser(by, "policy.approval.create");
    const problems: string[] = [];
    if (typeof toolPattern !== "string" || toolPattern === "*" || !TOOL_PATTERN.test(toolPattern))
      problems.push("toolPattern must be `capability.command` or `capability.*`");
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) problems.push("ttlMs must be a positive integer");
    else if (ttlMs > MAX_APPROVAL_TTL_MS)
      problems.push(`ttlMs must be at most ${MAX_APPROVAL_TTL_MS} (24 h)`);
    if (!(ENVIRONMENTS as readonly string[]).includes(scope?.environment))
      problems.push("scope.environment must be one of " + ENVIRONMENTS.join(", "));
    const resource = scope?.resource;
    if (typeof resource !== "string" || resource.length === 0 || resource === "*" || resource.length > 500)
      problems.push("scope.resource is required and must not be a wildcard for everything");
    if (scope?.actorId !== undefined && (typeof scope.actorId !== "string" || scope.actorId.length === 0))
      problems.push("scope.actorId must be a non-empty string");
    if (problems.length > 0) {
      this.record(by, "policy.approval.rejected", { toolPattern, scope, ttlMs, problems }, "denied");
      throw new PolicyError("INVALID_APPROVAL", "Invalid temporary approval", problems);
    }
    const nowMs = this.now();
    if (this.store.activeApprovals(nowMs).length >= MAX_ACTIVE_APPROVALS)
      throw new PolicyError("LIMIT_REACHED", `At most ${MAX_ACTIVE_APPROVALS} active approvals`);

    const approval: TemporaryApproval = {
      id: `apr_${crypto.randomUUID()}`,
      toolPattern,
      environment: scope.environment,
      resource,
      ...(scope.actorId === undefined ? {} : { actorId: scope.actorId }),
      createdBy: by.id,
      createdAt: nowMs,
      expiresAt: nowMs + ttlMs,
    };
    this.record(by, "policy.approval.created", {
      approvalId: approval.id,
      toolPattern,
      environment: approval.environment,
      resource,
      actorId: scope.actorId,
      expiresAt: new Date(approval.expiresAt).toISOString(),
    });
    this.store.insertApproval(approval);
    return approval;
  }

  revokeApproval(by: Actor, id: string): void {
    this.requireUser(by, "policy.approval.revoke");
    this.record(by, "policy.approval.revoked", { approvalId: id });
    if (!this.store.revokeApproval(id, this.now()))
      throw new PolicyError("NOT_FOUND", `No active approval "${id}"`);
  }

  private requireUser(by: Actor, action: string): void {
    if (by?.kind === "user" && by.trustedByUser === true && by.id.length > 0) return;
    try {
      this.record(by ?? { kind: "agent", id: "unknown", trustedByUser: false }, `${action}.refused`, {
        reason: "Only an authenticated user can change policy",
        claimedKind: by?.kind,
        trustedByUser: by?.trustedByUser,
      }, "denied");
    } catch {
      // The refusal stands even if the audit write fails.
    }
    throw new PolicyError("NOT_USER_ACTOR", "Only an authenticated user can change policy");
  }

  private record(
    by: Actor,
    action: string,
    details: Record<string, unknown>,
    decision: "info" | "denied" = "info",
  ): void {
    try {
      this.audit.record({ actor: `${by.kind}:${by.id}`.slice(0, 120), action, decision, details });
    } catch (err) {
      throw new PolicyError("AUDIT_FAILED", "Policy change could not be recorded", [String(err)]);
    }
  }
}
