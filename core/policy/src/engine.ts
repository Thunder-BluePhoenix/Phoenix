// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isPermission, SIDE_EFFECTS } from "@phoenix/protocol";
import { assessRisk, riskAtLeast } from "./risk";
import { matchPattern, ruleMatches, type PolicyRule } from "./rules";
import { PolicyStore, type TemporaryApproval } from "./store";
import {
  ACTOR_KINDS,
  ENVIRONMENTS,
  PolicyError,
  type PolicyAuditSink,
  type PolicyDecision,
  type RiskTier,
  type ToolRequest,
} from "./types";

/** Stands for "no resource" in approvals; requests may not use it as a real resource. */
export const NO_RESOURCE = "(none)";
/** How far `ToolRequest.at` may drift from the engine clock before the request is refused. */
export const MAX_CLOCK_SKEW_MS = 5_000;

export interface PolicyEngineOptions {
  store: PolicyStore;
  audit: PolicyAuditSink;
  /** Engaged kill switch denies every request (`PermissionGateway.isKillSwitchEngaged`). */
  isKillSwitchEngaged: () => boolean;
  /** The tool registry's view: unknown tools are denied. */
  isKnownTool: (tool: string) => boolean;
  now?: () => number;
}

/** A decision that has been written to the audit log. Execution needs one of these. */
export interface AuditedDecision {
  readonly decision: PolicyDecision;
  readonly auditId: number;
}

/** Decisions handed out by `PolicyEngine.decide` after their audit write committed. */
const issued = new WeakSet<AuditedDecision>();

/**
 * Throws unless `audited` came out of `PolicyEngine.decide`. A structurally identical object
 * built by hand is refused, so nothing can fabricate "a decision was made and recorded".
 */
export function assertAudited(audited: AuditedDecision): void {
  if (!issued.has(audited)) {
    throw new PolicyError("AUDIT_FAILED", "Decision was not issued by the policy engine");
  }
}

/**
 * Whether a grant (allow rule or temporary approval) may lift a require_approval:
 * never for critical, and never for an agent at high risk or above (ADR-0006: those
 * always get a fresh human approval).
 */
export function grantable(actorKind: ToolRequest["actor"]["kind"], risk: RiskTier): boolean {
  if (risk === "critical") return false;
  return !(actorKind === "agent" && riskAtLeast(risk, "high"));
}

const clip = (s: string | undefined, max: number) =>
  s !== undefined && s.length > max ? `${s.slice(0, max)}…` : s;

/** Read-only side of the policy: this is all an agent-facing component ever holds. */
export class PolicyEngine {
  private readonly store: PolicyStore;
  private readonly now: () => number;

  constructor(private readonly o: PolicyEngineOptions) {
    this.store = o.store;
    this.now = o.now ?? Date.now;
  }

  /** Decides without recording. Use `decide` for anything that leads to execution. */
  evaluate(request: ToolRequest): PolicyDecision {
    const malformed = this.malformed(request);
    // A request that does not even parse cannot be assessed: report the worst tier.
    const { risk, reasons: riskReasons } = malformed
      ? { risk: "critical" as const, reasons: ["request could not be assessed"] }
      : assessRisk(request);
    const deny = (reason: string, matched: string): PolicyDecision => ({
      effect: "deny",
      risk,
      reasons: [reason, ...riskReasons],
      matched: [matched],
    });

    if (this.o.isKillSwitchEngaged()) {
      return deny("Emergency stop is engaged", "builtin:kill-switch");
    }
    if (malformed) return deny(`Malformed request: ${malformed}`, "builtin:malformed-request");
    if (!this.o.isKnownTool(request.tool)) {
      return deny(`Unknown tool "${clip(request.tool, 100)}"`, "builtin:unknown-tool");
    }

    let rules: PolicyRule[];
    try {
      rules = this.store.rules();
    } catch (err) {
      // Fail closed: a corrupted rule store must not silently relax policy.
      return deny(`Stored policy is invalid: ${String(err)}`, "builtin:invalid-rules");
    }
    const hits = rules.filter((r) => ruleMatches(r.match, request));
    const denied = hits.filter((r) => r.effect === "deny");
    if (denied.length > 0) {
      return {
        effect: "deny",
        risk,
        reasons: denied.map((r) => `Denied by rule "${r.id}"${r.description ? `: ${r.description}` : ""}`),
        matched: denied.map((r) => r.id),
      };
    }

    const forced = hits.filter((r) => r.effect === "require_approval");
    const allows = hits.filter((r) => r.effect === "allow");
    const nowMs = this.now();
    const resource = request.resource ?? NO_RESOURCE;
    const approvals = this.store
      .activeApprovals(nowMs)
      .filter(
        (a) =>
          a.environment === request.environment &&
          matchPattern(a.toolPattern, request.tool) &&
          matchPattern(a.resource, resource) &&
          (a.actorId === undefined || a.actorId === request.actor.id),
      );

    const needs = (reason: string, matched: string[]): PolicyDecision => ({
      effect: "require_approval",
      risk,
      reasons: [reason, ...riskReasons],
      matched,
    });

    if (!request.actor.trustedByUser && risk !== "low") {
      return needs("Request was not directly asked for by the user", ["builtin:untrusted-origin"]);
    }
    if (forced.length > 0) {
      return needs(
        forced.map((r) => `Rule "${r.id}" requires approval`).join("; "),
        forced.map((r) => r.id),
      );
    }

    const baseline =
      risk === "low" || (risk === "medium" && request.actor.kind !== "agent") ? "allow" : "approve";
    if (baseline === "allow") {
      return {
        effect: "allow",
        risk,
        reasons: [`${risk} risk is allowed by default`, ...riskReasons],
        matched: ["builtin:baseline"],
      };
    }

    if (!grantable(request.actor.kind, risk)) {
      return needs(
        risk === "critical"
          ? "Critical actions always need a fresh approval"
          : "High-risk agent actions always need a fresh approval",
        ["builtin:no-standing-grant"],
      );
    }
    if (allows.length > 0) {
      return {
        effect: "allow",
        risk,
        reasons: allows.map((r) => `Allowed by rule "${r.id}"`),
        matched: allows.map((r) => r.id),
      };
    }
    if (approvals.length > 0) {
      const expiresAt = Math.min(...approvals.map((a) => a.expiresAt));
      return {
        effect: "allow",
        risk,
        reasons: ["Covered by a temporary approval"],
        matched: approvals.map((a) => a.id),
        expiresAt: new Date(expiresAt),
      };
    }
    return needs(`${risk} risk needs approval`, ["builtin:baseline"]);
  }

  /**
   * Decides and appends the decision (deny included) to the audit log. If the audit write
   * fails this throws and no decision is returned, so nothing can run on an unrecorded decision.
   */
  decide(request: ToolRequest, context: Record<string, unknown> = {}): AuditedDecision {
    const decision = this.evaluate(request);
    let auditId: number;
    try {
      auditId = this.o.audit.record({
        actor: `${request.actor.kind}:${clip(request.actor.id, 100)}`,
        action: "policy.decision",
        capabilityId: request.capabilityId.slice(0, 64),
        decision:
          decision.effect === "allow" ? "allowed" : decision.effect === "deny" ? "denied" : "pending",
        details: {
          ...context,
          effect: decision.effect,
          risk: decision.risk,
          tool: clip(request.tool, 200),
          sideEffect: request.sideEffect,
          permissions: request.permissions,
          environment: request.environment,
          resource: clip(request.resource, 200),
          dataClass: request.dataClass,
          trustedByUser: request.actor.trustedByUser,
          reasons: decision.reasons,
          matched: decision.matched,
          expiresAt: decision.expiresAt?.toISOString(),
        },
      }).id;
    } catch (err) {
      throw new PolicyError("AUDIT_FAILED", "Policy decision could not be recorded", [String(err)]);
    }
    const audited: AuditedDecision = Object.freeze({ decision, auditId });
    issued.add(audited);
    return audited;
  }

  /** Active temporary approvals, for display. */
  approvals(): TemporaryApproval[] {
    return this.store.activeApprovals(this.now());
  }

  rules(): PolicyRule[] {
    return this.store.rules();
  }

  private malformed(r: ToolRequest): string | undefined {
    if (r.tool !== `${r.capabilityId}.${r.command}`) return "tool does not match capability and command";
    if (!(ENVIRONMENTS as readonly string[]).includes(r.environment)) return "unknown environment";
    if (!(SIDE_EFFECTS as readonly string[]).includes(r.sideEffect)) return "unknown side effect";
    if (!r.permissions.every(isPermission)) return "unknown permission";
    if (!(ACTOR_KINDS as readonly string[]).includes(r.actor?.kind)) return "unknown actor kind";
    if (typeof r.actor.id !== "string" || r.actor.id.length === 0) return "actor has no id";
    if (typeof r.actor.trustedByUser !== "boolean") return "actor trust flag is not a boolean";
    if (r.resource === NO_RESOURCE) return "reserved resource name";
    if (!Number.isFinite(r.at.getTime()) || Math.abs(r.at.getTime() - this.now()) > MAX_CLOCK_SKEW_MS)
      return "request time does not match the clock";
    return undefined;
  }
}
