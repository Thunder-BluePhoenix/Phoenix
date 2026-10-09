// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PolicyDecision } from "@phoenix/policy";

/** The run was cancelled (by the user, by disabling automation, or by the kill switch). */
export class CancelledError extends Error {
  override name = "CancelledError";
  constructor(readonly reason: string) {
    super(`Run cancelled: ${reason}`);
  }
}

/** A run stopped on purpose, with a reason that is safe to show. */
export class RunFailure extends Error {
  override name = "RunFailure";
}

/** A plan was refused. Nothing in it ran. */
export class PlanRejectedError extends RunFailure {
  override name = "PlanRejectedError";
  constructor(readonly problems: readonly string[]) {
    super(`Plan rejected: ${problems[0] ?? "invalid plan"}`);
  }
}

export type ToolFailureCode =
  /** Not in the task kind's allow-list, or in a capability the kind may not use. */
  | "NOT_ALLOWED"
  | "BUDGET"
  | "CANCELLED"
  /** Any ToolGatewayErrorCode, as is. */
  | (string & {});

/** A tool call that did not produce output. The gateway decided; this only carries the facts. */
export class ToolCallFailure extends Error {
  override name = "ToolCallFailure";
  constructor(
    readonly code: ToolFailureCode,
    message: string,
    readonly tool: string,
    readonly auditId?: number,
    readonly decision?: PolicyDecision,
  ) {
    super(message);
  }
}
