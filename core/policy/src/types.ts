// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Permission, SideEffect } from "@phoenix/protocol";

export const ACTOR_KINDS = ["user", "agent", "capability", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ENVIRONMENTS = ["local", "dev", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const DATA_CLASSES = ["public", "internal", "sensitive"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const RISK_TIERS = ["low", "medium", "high", "critical"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export type PolicyEffect = "allow" | "deny" | "require_approval";

export interface Actor {
  kind: ActorKind;
  id: string;
  /**
   * True when the action was directly asked for by the user. False when it was
   * derived from content the user did not write (web pages, documents, tool results).
   */
  trustedByUser: boolean;
}

/** One request to run one tool. Built by the tool gateway from the registry, never from model text. */
export interface ToolRequest {
  actor: Actor;
  /** `<capabilityId>.<command>` */
  tool: string;
  capabilityId: string;
  command: string;
  sideEffect: SideEffect;
  permissions: readonly Permission[];
  environment: Environment;
  resource?: string;
  dataClass?: DataClass;
  at: Date;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  risk: RiskTier;
  reasons: string[];
  /** Ids of the rules, approvals and built-in checks that decided this. */
  matched: string[];
  /** When the decision stops being valid (set when a temporary approval allowed it). */
  expiresAt?: Date;
}

export type PolicyErrorCode =
  | "NOT_USER_ACTOR"
  | "INVALID_RULE"
  | "INVALID_APPROVAL"
  | "INVALID_REQUEST"
  | "AUDIT_FAILED"
  | "NOT_FOUND"
  | "LIMIT_REACHED";

export class PolicyError extends Error {
  override name = "PolicyError";
  constructor(
    readonly code: PolicyErrorCode,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}

/** Where decisions are recorded. `AuditLog` from @phoenix/permissions satisfies this. */
export interface PolicyAuditSink {
  record(entry: {
    actor: string;
    action: string;
    capabilityId?: string;
    decision: "allowed" | "denied" | "blocked" | "pending" | "info";
    details: Record<string, unknown>;
  }): { id: number };
}
