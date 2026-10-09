// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Actor, DataClass, Environment, PolicyDecision } from "@phoenix/policy";
import type { Permission, SideEffect } from "@phoenix/protocol";

/**
 * What an agent may know about, and ask for, one capability command. Everything that matters
 * for safety (side effect, permissions, timeout, idempotency) is copied from the capability's
 * manifest by the registry; a caller can neither supply nor override it.
 */
export interface ToolContract {
  /** `<capabilityId>.<command>` */
  name: string;
  description: string;
  capabilityId: string;
  command: string;
  /** JSON Schema (draft 2020-12). Commands that declare none accept only `{}`. */
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sideEffect: SideEffect;
  permissions: readonly Permission[];
  timeoutMs: number;
  /** True only for tools that cannot change anything (side effect none or read). */
  idempotent: boolean;
  /** Copied into every audit record for this tool. */
  auditMetadata: {
    capabilityName: string;
    capabilityVersion: string;
    dataCategories: readonly string[];
  };
}

export interface ToolCall {
  actor: Actor;
  tool: string;
  input: unknown;
  environment: Environment;
  resource?: string;
  dataClass?: DataClass;
}

export interface ToolCallResult {
  tool: string;
  /** Treat as untrusted data: it comes from a capability and may contain text written by third parties. */
  output: unknown;
  operationId: string;
  decision: PolicyDecision;
  /** Audit record of the decision that preceded execution. */
  auditId: number;
}

export type ToolGatewayErrorCode =
  | "UNKNOWN_TOOL"
  | "CAPABILITY_DISABLED"
  | "STALE_REGISTRY"
  | "INVALID_INPUT"
  | "DENIED"
  | "APPROVAL_REJECTED"
  | "AUDIT_FAILED"
  | "TIMEOUT"
  | "EXECUTION_FAILED"
  | "INVALID_OUTPUT";

export class ToolGatewayError extends Error {
  override name = "ToolGatewayError";
  constructor(
    readonly code: ToolGatewayErrorCode,
    message: string,
    readonly details: readonly string[] = [],
    /** The policy decision, when one was made before the failure. */
    readonly decision?: PolicyDecision,
    /** Audit record of that decision, so a failed call can still be tied to its decision. */
    readonly auditId?: number,
  ) {
    super(message);
  }
}
