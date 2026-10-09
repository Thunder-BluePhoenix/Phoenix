// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The human gate of a workflow. It is the existing confirmation flow of the PermissionGateway
// (ADR-0006), not a second one: the user sees the same prompt in the same place, the answer and
// the expiry are audited by the same code, and the kill switch rejects it the same way.
import type { PermissionGateway } from "@phoenix/permissions";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export interface ApprovalRequest {
  runId: string;
  workflowId: string;
  stepId: string;
  correlationId: string;
  /** Plain-language text for the prompt; already rendered, bounded and redacted. */
  summary: string;
}

/** `blocked` = the emergency stop is engaged. `expired` = nobody answered in time. */
export type ApprovalOutcome = "approved" | "rejected" | "expired" | "blocked";

export interface ApprovalPort {
  /** Resolves when the user answers (or the request lapses). Aborting `signal` withdraws it. */
  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalOutcome>;
}

/** The pseudo-capability id workflow approvals are raised under in the confirmation flow. */
export const APPROVAL_CAPABILITY_ID = "workflows";
export const approvalCommand = (runId: string, stepId: string): string =>
  `approve.${runId}.${stepId}`;

export function approvalsFromPermissions(permissions: PermissionGateway): ApprovalPort {
  return {
    async request(request, signal) {
      const command = approvalCommand(request.runId, request.stepId);
      const withdraw = () => {
        for (const c of permissions.pendingConfirmations()) {
          if (c.capabilityId === APPROVAL_CAPABILITY_ID && c.command === command)
            permissions.resolveConfirmation(c.id, false, "workflow-cancel");
        }
      };
      signal.addEventListener("abort", withdraw, { once: true });
      try {
        await permissions.authorize({
          capabilityId: APPROVAL_CAPABILITY_ID,
          command,
          permissions: [],
          // `external` is the confirm-class side effect that asks the user; the workflow itself
          // changes nothing here.
          sideEffect: "external",
          summary: `Workflow approval: ${request.summary}`,
          details: {
            workflow: request.workflowId,
            run: request.runId,
            step: request.stepId,
            correlation_id: request.correlationId,
          },
        });
        return "approved";
      } catch (err) {
        if (err instanceof PhoenixError) {
          if (err.code === ErrorCode.SECURITY_POLICY_BLOCKED) return "blocked";
          if (err.code === ErrorCode.OPERATION_TIMEOUT) return "expired";
          if (err.code === ErrorCode.PERMISSION_DENIED) return "rejected";
        }
        throw err;
      } finally {
        signal.removeEventListener("abort", withdraw);
      }
    },
  };
}
