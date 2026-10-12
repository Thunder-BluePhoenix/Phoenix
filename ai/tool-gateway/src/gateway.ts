// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { silentLogger, type Logger } from "@phoenix/logging";
import type { Operation, CapabilityManager } from "@phoenix/capability-manager";
import type { PermissionGateway } from "@phoenix/permissions";
import type { Database } from "@phoenix/persistence";
import {
  assertAudited,
  PolicyError,
  type AuditedDecision,
  type PolicyAuditSink,
  type PolicyDecision,
  type PolicyEngine,
  type ToolRequest,
} from "@phoenix/policy";
import { ErrorCode, type CapabilityManifest } from "@phoenix/protocol";
import {
  ToolGatewayError,
  type ToolCall,
  type ToolCallResult,
  type ToolContract,
} from "./contract";
import { manifestsFromDatabase, type RegisteredTool, type ToolRegistry } from "./registry";

/** The slice of the capability manager the gateway needs. */
export interface CapabilityHost {
  invokeAndWait(
    id: string,
    command: string,
    input: unknown,
    actor: string,
    signal?: AbortSignal,
  ): Promise<Operation>;
}

/** Asks the user to approve one policy-escalated call. Rejects when declined or expired. */
export interface Approver {
  approve(
    request: { contract: ToolContract; summary: string; call: ToolCall },
    signal?: AbortSignal,
  ): Promise<void>;
}

export const MAX_INPUT_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ToolGatewayOptions {
  host: CapabilityHost;
  /**
   * The registry the policy engine's `isKnownTool` also consults, so a tool that is not
   * registered (or whose capability is disabled) is denied by default.
   */
  registry: ToolRegistry;
  policy: PolicyEngine;
  /** Same audit trail the policy engine writes to (`PermissionGateway.audit`). */
  audit: PolicyAuditSink;
  /** Used for escalations the capability manager's own confirmation would not ask for. */
  approver: Approver;
  now?: () => number;
  logger?: Logger;
  /**
   * Extra attempts for idempotent tools after a timeout (default 0). Other failures are never retried. Each attempt gets its own policy decision and audit record.
   * Non-idempotent tools are never retried.
   */
  idempotentRetries?: number;
  /** Extra time on top of the tool's timeout for a human to answer a confirmation. */
  approvalWaitMs?: number;
}

/**
 * The only path from an agent to a capability.
 *
 * `call` validates the tool and input, asks the policy engine (which commits the decision to the
 * audit log), obtains approval when required, and only then lets the single private `execute`
 * method touch the capability host. `execute` demands an `AuditedDecision` that only
 * `PolicyEngine.decide` can mint, so no code path reaches the host without a decision whose audit
 * write succeeded.
 */
export class ToolGateway {
  private readonly registry: ToolRegistry;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly retries: number;
  private readonly approvalWaitMs: number;

  constructor(private readonly o: ToolGatewayOptions) {
    this.registry = o.registry;
    this.now = o.now ?? Date.now;
    this.logger = (o.logger ?? silentLogger).child("tool-gateway");
    this.retries = Math.max(0, Math.floor(o.idempotentRetries ?? 0));
    this.approvalWaitMs = o.approvalWaitMs ?? 5 * 60_000;
  }

  /** Tools currently callable (enabled capabilities only). */
  tools(): ToolContract[] {
    return this.registry.list();
  }

  /**
   * What the policy engine would decide for this call right now, without recording anything and
   * without running anything. For showing a plan's expected risk; the real `call` decides again.
   */
  preview(call: ToolCall): PolicyDecision {
    const tool = this.registry.get(call.tool);
    return this.o.policy.evaluate(this.toRequest(call, tool?.contract));
  }

  /** Aborting stops pending approval and signals the host; dispatched writes may remain uncertain. */
  async call(call: ToolCall, options?: { signal?: AbortSignal }): Promise<ToolCallResult> {
    const tool = this.registry.get(call.tool);
    if (tool) this.checkInput(tool, call);

    const maxAttempts = tool?.contract.idempotent ? 1 + this.retries : 1;
    for (let attempt = 1; ; attempt++) {
      if (options?.signal?.aborted) throw new ToolGatewayError("CANCELLED", "Tool call cancelled");
      try {
        return await this.attempt(call, tool, attempt, options?.signal);
      } catch (err) {
        const retry =
          !options?.signal?.aborted &&
          attempt < maxAttempts &&
          err instanceof ToolGatewayError &&
          err.code === "TIMEOUT";
        if (!retry) throw err;
      }
    }
  }

  // ── One decision + one execution ─────────────────────────────────────────

  private async attempt(
    call: ToolCall,
    tool: RegisteredTool | undefined,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<ToolCallResult> {
    const request = this.toRequest(call, tool?.contract);
    let audited: AuditedDecision;
    try {
      audited = this.o.policy.decide(request, { attempt, origin: "tool-gateway" });
    } catch (err) {
      if (err instanceof PolicyError)
        throw new ToolGatewayError(
          "AUDIT_FAILED",
          "Tool call blocked: the decision could not be recorded",
          [err.message],
        );
      throw err;
    }
    const { decision } = audited;

    if (!tool || decision.effect === "deny") {
      throw new ToolGatewayError(
        tool ? "DENIED" : "UNKNOWN_TOOL",
        tool ? `Denied: ${decision.reasons[0] ?? "policy"}` : "Unknown tool",
        decision.reasons,
        decision,
        audited.auditId,
      );
    }
    const contract = tool.contract;

    if (decision.effect === "require_approval") await this.approve(call, contract, audited, signal);
    if (signal?.aborted) {
      this.outcome(audited, contract, call, "cancelled", {});
      throw new ToolGatewayError("CANCELLED", "Tool call cancelled", [], decision, audited.auditId);
    }

    const output = await this.execute(audited, call, tool, signal);
    return {
      tool: contract.name,
      output: output.result,
      operationId: output.operationId,
      decision,
      auditId: audited.auditId,
    };
  }

  /** The only method that touches the capability host. */
  private async execute(
    proof: AuditedDecision,
    call: ToolCall,
    tool: RegisteredTool,
    signal?: AbortSignal,
  ): Promise<{ result: unknown; operationId: string }> {
    assertAudited(proof);
    if (proof.decision.effect === "deny") {
      throw new ToolGatewayError(
        "DENIED",
        "Denied by policy",
        proof.decision.reasons,
        proof.decision,
        proof.auditId,
      );
    }
    const { contract } = tool;
    const actor = `${call.actor.kind}:${call.actor.id}`.slice(0, 200);

    const controller = new AbortController();
    const finished = Promise.withResolvers<Operation>();
    let settled = false;
    let dispatched = false;
    const onAbort = () => {
      if (settled) return;
      controller.abort();
      finished.reject(
        new ToolGatewayError(
          "CANCELLED",
          `${contract.name} cancelled; its outcome may be unknown`,
          [],
          proof.decision,
          proof.auditId,
        ),
      );
    };
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    // The wait for a user's confirmation happens inside invokeAndWait, so it extends the budget.
    const limit = contract.timeoutMs + this.approvalWaitMs;
    const handle = setTimeout(() => {
      if (settled) return;
      controller.abort();
      finished.reject(
        new ToolGatewayError(
          "TIMEOUT",
          `${contract.name} did not finish within ${limit} ms; its outcome is unknown`,
          [ErrorCode.OPERATION_TIMEOUT],
          proof.decision,
          proof.auditId,
        ),
      );
    }, limit);
    let op: Operation;
    try {
      if (controller.signal.aborted)
        throw new ToolGatewayError(
          "CANCELLED",
          "Tool call cancelled",
          [],
          proof.decision,
          proof.auditId,
        );
      dispatched = true;
      const pending = this.o.host.invokeAndWait(
        contract.capabilityId,
        contract.command,
        call.input,
        actor,
        controller.signal,
      );
      pending.then(
        (result) => {
          settled = true;
          finished.resolve(result);
        },
        (error: unknown) => {
          settled = true;
          finished.reject(error);
        },
      );
      op = await finished.promise;
    } catch (err) {
      throw this.failure(err, proof, contract, call, dispatched);
    } finally {
      clearTimeout(handle);
      signal?.removeEventListener("abort", onAbort);
    }

    if (op.status !== "succeeded") {
      const code = op.error?.code ?? ErrorCode.INTERNAL_ERROR;
      const rejected =
        code === ErrorCode.PERMISSION_DENIED || code === ErrorCode.SECURITY_POLICY_BLOCKED;
      const failed = new ToolGatewayError(
        rejected
          ? "APPROVAL_REJECTED"
          : code === ErrorCode.OPERATION_TIMEOUT
            ? signal?.aborted
              ? "CANCELLED"
              : "TIMEOUT"
            : "EXECUTION_FAILED",
        `${contract.name} failed: ${op.error?.message ?? "unknown error"}`,
        [code],
        proof.decision,
        proof.auditId,
      );
      this.outcome(
        proof,
        contract,
        call,
        op.outcomeUnknown ? "unknown" : signal?.aborted ? "cancelled" : "failed",
        { code, operationId: op.id },
      );
      throw failed;
    }

    const size = JSON.stringify(op.result ?? null).length;
    const problems =
      size > MAX_OUTPUT_BYTES
        ? [`output is ${size} bytes (limit ${MAX_OUTPUT_BYTES})`]
        : tool.checkOutput(op.result);
    if (problems.length > 0) {
      this.outcome(proof, contract, call, "invalid_output", { problems });
      throw new ToolGatewayError(
        "INVALID_OUTPUT",
        `${contract.name} returned invalid output`,
        problems,
        proof.decision,
        proof.auditId,
      );
    }
    this.outcome(proof, contract, call, "succeeded", { operationId: op.id });
    return { result: op.result, operationId: op.id };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private checkInput(tool: RegisteredTool, call: ToolCall): void {
    let problems = tool.checkInput(call.input);
    if (problems.length === 0 && JSON.stringify(call.input ?? null).length > MAX_INPUT_BYTES)
      problems = [`input is larger than ${MAX_INPUT_BYTES} bytes`];
    if (problems.length === 0) return;
    try {
      this.o.audit.record({
        actor: `${call.actor.kind}:${call.actor.id}`.slice(0, 120),
        action: "tool.input_rejected",
        capabilityId: tool.contract.capabilityId,
        decision: "denied",
        details: { tool: tool.contract.name, problems: problems.slice(0, 10) },
      });
    } catch (err) {
      this.logger.warn("could not audit rejected tool input", { error: err });
    }
    throw new ToolGatewayError(
      "INVALID_INPUT",
      `Invalid input for ${tool.contract.name}`,
      problems,
    );
  }

  /**
   * Builds the policy request from the registry's contract. Nothing about side effects or
   * permissions comes from the caller. Unknown tools get a request that the engine denies.
   */
  private toRequest(call: ToolCall, contract: ToolContract | undefined): ToolRequest {
    const name = typeof call.tool === "string" ? call.tool : "(invalid)";
    const dot = name.indexOf(".");
    return {
      actor: call.actor,
      tool: name,
      capabilityId: contract?.capabilityId ?? (dot > 0 ? name.slice(0, dot) : name),
      command: contract?.command ?? (dot > 0 ? name.slice(dot + 1) : ""),
      sideEffect: contract?.sideEffect ?? "execute",
      permissions: contract?.permissions ?? [],
      environment: call.environment,
      ...(call.resource === undefined ? {} : { resource: call.resource }),
      ...(call.dataClass === undefined ? {} : { dataClass: call.dataClass }),
      at: new Date(this.now()),
    };
  }

  /**
   * The capability manager asks the user itself for write/execute/external/production commands
   * and ALWAYS_CONFIRM permissions (ADR-0006), so those need no second prompt. Escalations it
   * would not confirm (a read in production, a rule forcing approval) go through the same
   * PermissionGateway confirmation flow via the approver.
   */
  private async approve(
    call: ToolCall,
    contract: ToolContract,
    proof: AuditedDecision,
    signal?: AbortSignal,
  ): Promise<void> {
    const reasons = proof.decision.reasons;
    if (signal?.aborted) {
      this.outcome(proof, contract, call, "cancelled", {});
      throw new ToolGatewayError(
        "CANCELLED",
        "Approval cancelled",
        [],
        proof.decision,
        proof.auditId,
      );
    }
    const cancelled = Promise.withResolvers<never>();
    const onAbort = () =>
      cancelled.reject(
        new ToolGatewayError("CANCELLED", "Approval cancelled", [], proof.decision, proof.auditId),
      );
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.race([
        this.o.approver.approve(
          {
            contract,
            call,
            summary: `${contract.description} (${reasons[0] ?? "policy requires approval"})`,
          },
          signal,
        ),
        cancelled.promise,
      ]);
      if (signal?.aborted)
        throw new ToolGatewayError(
          "CANCELLED",
          "Approval cancelled",
          [],
          proof.decision,
          proof.auditId,
        );
    } catch (err) {
      if (signal?.aborted) {
        this.outcome(proof, contract, call, "cancelled", {});
        throw new ToolGatewayError(
          "CANCELLED",
          "Approval cancelled",
          [],
          proof.decision,
          proof.auditId,
        );
      }
      throw new ToolGatewayError(
        "APPROVAL_REJECTED",
        `Not approved: ${err instanceof Error ? err.message : String(err)}`,
        reasons,
        proof.decision,
        proof.auditId,
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private failure(
    err: unknown,
    proof: AuditedDecision,
    contract: ToolContract,
    call: ToolCall,
    dispatched: boolean,
  ): ToolGatewayError {
    if (err instanceof ToolGatewayError) {
      const uncertain =
        dispatched && contract.sideEffect !== "none" && contract.sideEffect !== "read";
      this.outcome(
        proof,
        contract,
        call,
        err.code === "CANCELLED" ? (uncertain ? "unknown" : "cancelled") : "timeout",
        {},
      );
      return err;
    }
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "INTERNAL_ERROR";
    this.outcome(proof, contract, call, "failed", { code });
    return new ToolGatewayError(
      code === ErrorCode.CAPABILITY_DISABLED ? "CAPABILITY_DISABLED" : "EXECUTION_FAILED",
      `${contract.name} failed: ${message.slice(0, 300)}`,
      [code],
      proof.decision,
      proof.auditId,
    );
  }

  private outcome(
    proof: AuditedDecision,
    contract: ToolContract,
    call: ToolCall,
    outcome: string,
    extra: Record<string, unknown>,
  ): void {
    try {
      this.o.audit.record({
        actor: `${call.actor.kind}:${call.actor.id}`.slice(0, 120),
        action: `tool.${outcome}`,
        capabilityId: contract.capabilityId,
        decision: "info",
        details: {
          tool: contract.name,
          decisionAuditId: proof.auditId,
          ...contract.auditMetadata,
          ...extra,
        },
      });
    } catch (err) {
      // The decision record already exists; losing the outcome record must not hide the result.
      this.logger.warn("could not audit tool outcome", { tool: contract.name, error: err });
    }
  }
}

/**
 * Manifests of the capabilities that are enabled right now, for `ToolRegistry`. Manifests are
 * the ones the capability manager persisted when the capability registered.
 */
export function enabledManifests(
  manager: CapabilityManager,
  db: Database,
): () => CapabilityManifest[] {
  return () =>
    manifestsFromDatabase(db).filter((m) => {
      try {
        return manager.get(m.id).status === "enabled";
      } catch {
        return false;
      }
    });
}

/**
 * Confirmations for policy escalations, through the existing PermissionGateway flow (ADR-0006).
 *
 * `authorize()` only prompts for confirm-class side effects. When the capability manager will
 * prompt anyway (write/execute/external/production, ALWAYS_CONFIRM permissions) this adds
 * nothing, so the user is asked once. Otherwise (for example a read in production, or a rule that
 * forces approval) it asks through `authorize()` with a confirm-class request; `details` keeps the
 * real side effect so the audit trail stays truthful.
 */
export function approverFromPermissions(permissions: PermissionGateway): Approver {
  return {
    async approve({ contract, summary }, signal) {
      if (permissions.needsConfirmation(contract)) return;
      await permissions.authorize(
        {
          capabilityId: contract.capabilityId,
          command: contract.command,
          permissions: contract.permissions,
          sideEffect: "external",
          summary: `Policy approval: ${summary}`,
          details: { actualSideEffect: contract.sideEffect, policy: true },
        },
        signal,
      );
    },
  };
}
