// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { silentLogger, type Logger } from "@phoenix/logging";
import { SettingsStore, type Database } from "@phoenix/persistence";
import {
  ALWAYS_CONFIRM,
  CONFIRM_SIDE_EFFECTS,
  createEvent,
  ErrorCode,
  PhoenixError,
  type NewEvent,
  type Permission,
  type PhoenixEvent,
  type SideEffect,
} from "@phoenix/protocol";
import { AuditLog } from "./audit";
import { GrantStore } from "./grants";

/** A capability asking to perform one command. */
export interface ActionRequest {
  capabilityId: string;
  command: string;
  permissions: readonly Permission[];
  sideEffect: SideEffect;
  /** Plain-language description shown to the user in the approval prompt. */
  summary: string;
  details?: Record<string, unknown>;
}

export interface AuthorizedAction {
  id: string;
  request: ActionRequest;
  authorizedAt: string;
  confirmationId?: string;
}

export interface Confirmation {
  id: string;
  capabilityId: string;
  command: string;
  summary: string;
  sideEffect: SideEffect;
  permissions: readonly Permission[];
  requestedAt: string;
  expiresAt: string;
}

export interface PermissionGatewayOptions {
  db: Database;
  /** Publishes security events to the bus. */
  publish?: (event: PhoenixEvent) => void;
  logger?: Logger;
  now?: () => number;
  confirmationTimeoutMs?: number;
}

const KILL_SWITCH_KEY = "security.kill_switch";

interface Pending {
  confirmation: Confirmation;
  resolve: (approved: boolean, by: string) => void;
  abort: (error: PhoenixError) => void;
  timer: NodeJS.Timeout;
}

let counter = 0;
const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${crypto.randomUUID().slice(0, 8)}`;

/**
 * Every side-effecting command passes through here (ADR-0006).
 *
 * 1. Emergency kill switch → SECURITY_POLICY_BLOCKED
 * 2. Missing grants        → PERMISSION_DENIED
 * 3. Write/execute/external/production side effects, or sensitive permissions
 *    (microphone, camera, recording, production) → wait for explicit user confirmation
 * 4. Every decision is written to the audit log.
 */
export class PermissionGateway {
  readonly grants: GrantStore;
  readonly audit: AuditLog;
  private readonly settings: SettingsStore;
  private readonly pending = new Map<string, Pending>();
  private readonly publishFn: (event: PhoenixEvent) => void;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: PermissionGatewayOptions) {
    this.now = options.now ?? Date.now;
    this.grants = new GrantStore(options.db, this.now);
    this.audit = new AuditLog(options.db, this.now);
    this.settings = new SettingsStore(options.db);
    this.publishFn = options.publish ?? (() => {});
    this.logger = (options.logger ?? silentLogger).child("permissions");
    this.timeoutMs = options.confirmationTimeoutMs ?? 5 * 60_000;
  }

  // ── Grants ────────────────────────────────────────────────────────────────

  grant(
    capabilityId: string,
    permissions: readonly Permission[],
    by = "user",
    expiresAt?: Date,
  ): void {
    for (const p of permissions) this.grants.grant(capabilityId, p, by, expiresAt);
    this.audit.record({
      actor: by,
      action: "permission.granted",
      capabilityId,
      decision: "info",
      details: { permissions, expiresAt: expiresAt?.toISOString() },
    });
  }

  revoke(capabilityId: string, permissions?: readonly Permission[], by = "user"): void {
    if (permissions) for (const p of permissions) this.grants.revoke(capabilityId, p);
    else this.grants.revoke(capabilityId);
    this.audit.record({
      actor: by,
      action: "permission.revoked",
      capabilityId,
      decision: "info",
      details: { permissions: permissions ?? "all" },
    });
  }

  // ── Kill switch ───────────────────────────────────────────────────────────

  isKillSwitchEngaged(): boolean {
    return this.settings.get(KILL_SWITCH_KEY, false);
  }

  /** Emergency stop: blocks every action and rejects every pending confirmation. */
  engageKillSwitch(by = "user", reason = "Emergency stop"): void {
    this.settings.set(KILL_SWITCH_KEY, true);
    for (const id of [...this.pending.keys()]) this.resolveConfirmation(id, false, "kill-switch");
    this.audit.record({
      actor: by,
      action: "kill_switch.engaged",
      decision: "info",
      details: { reason },
    });
    this.emit({
      event_type: "security.kill_switch.engaged",
      severity: "warning",
      payload: { reason },
    });
  }

  disengageKillSwitch(by = "user"): void {
    this.settings.set(KILL_SWITCH_KEY, false);
    this.audit.record({
      actor: by,
      action: "kill_switch.disengaged",
      decision: "info",
      details: {},
    });
    this.emit({ event_type: "security.kill_switch.disengaged", severity: "info", payload: {} });
  }

  // ── Authorization ─────────────────────────────────────────────────────────

  /** Resolves when the action may run; rejects with a PhoenixError otherwise. */
  async authorize(request: ActionRequest): Promise<AuthorizedAction> {
    const base = {
      actor: request.capabilityId,
      capabilityId: request.capabilityId,
      details: {
        command: request.command,
        sideEffect: request.sideEffect,
        permissions: request.permissions,
      },
    };

    if (this.isKillSwitchEngaged()) {
      this.audit.record({ ...base, action: "action.blocked", decision: "blocked" });
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    }

    const missing = this.grants.missing(request.capabilityId, request.permissions);
    if (missing.length > 0) {
      this.audit.record({
        ...base,
        action: "action.denied",
        decision: "denied",
        details: { ...base.details, missing },
      });
      this.emit({
        event_type: "security.permission.denied",
        severity: "warning",
        subject: request.capabilityId,
        payload: { capability: request.capabilityId, command: request.command, missing },
      });
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, undefined, missing);
    }

    let confirmationId: string | undefined;
    if (this.needsConfirmation(request)) {
      confirmationId = await this.confirm(request);
    }

    const action: AuthorizedAction = {
      id: newId("act"),
      request,
      authorizedAt: new Date(this.now()).toISOString(),
      ...(confirmationId ? { confirmationId } : {}),
    };
    this.audit.record({
      ...base,
      action: "action.authorized",
      decision: "allowed",
      details: { ...base.details, actionId: action.id, confirmationId },
    });
    return action;
  }

  /** Records what happened after an authorized action ran. */
  recordOutcome(
    action: AuthorizedAction,
    outcome: "succeeded" | "failed",
    details: Record<string, unknown> = {},
  ): void {
    this.audit.record({
      actor: action.request.capabilityId,
      action: `action.${outcome}`,
      capabilityId: action.request.capabilityId,
      decision: "info",
      details: { ...details, actionId: action.id, command: action.request.command },
    });
  }

  needsConfirmation(request: Pick<ActionRequest, "sideEffect" | "permissions">): boolean {
    return (
      CONFIRM_SIDE_EFFECTS.has(request.sideEffect) ||
      request.permissions.some((p) => ALWAYS_CONFIRM.has(p))
    );
  }

  // ── Confirmations ─────────────────────────────────────────────────────────

  /** Shutdown: rejects pending confirmations without touching storage. */
  close(): void {
    for (const p of [...this.pending.values()]) {
      p.abort(new PhoenixError(ErrorCode.OPERATION_TIMEOUT, "Phoenix Core is shutting down"));
    }
  }

  pendingConfirmations(): Confirmation[] {
    return [...this.pending.values()].map((p) => p.confirmation);
  }

  /** Approve or reject a pending confirmation. Returns false if it no longer exists. */
  resolveConfirmation(id: string, approved: boolean, by = "user"): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    p.resolve(approved, by);
    return true;
  }

  private confirm(request: ActionRequest): Promise<string> {
    const id = newId("conf");
    const nowMs = this.now();
    const confirmation: Confirmation = {
      id,
      capabilityId: request.capabilityId,
      command: request.command,
      summary: request.summary,
      sideEffect: request.sideEffect,
      permissions: request.permissions,
      requestedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + this.timeoutMs).toISOString(),
    };

    this.audit.record({
      actor: request.capabilityId,
      action: "confirmation.requested",
      capabilityId: request.capabilityId,
      decision: "pending",
      details: { confirmationId: id, command: request.command, summary: request.summary },
    });
    this.emit({
      event_type: "security.confirmation.requested",
      severity: "warning",
      correlation_id: id,
      requires_action: true,
      subject: request.capabilityId,
      payload: {
        confirmation_id: id,
        capability: request.capabilityId,
        command: request.command,
        summary: request.summary,
        side_effect: request.sideEffect,
      },
    });

    return new Promise<string>((resolve, reject) => {
      const finish = (approved: boolean, by: string, timedOut = false) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        const outcome = timedOut ? "expired" : approved ? "approved" : "rejected";
        this.audit.record({
          actor: by,
          action: `confirmation.${outcome}`,
          capabilityId: request.capabilityId,
          decision: approved ? "allowed" : "denied",
          details: { confirmationId: id, command: request.command },
        });
        this.emit({
          event_type: "security.confirmation.resolved",
          severity: approved ? "success" : "info",
          correlation_id: id,
          subject: request.capabilityId,
          payload: { confirmation_id: id, outcome },
        });
        if (approved) resolve(id);
        else if (timedOut)
          reject(new PhoenixError(ErrorCode.OPERATION_TIMEOUT, "Confirmation expired"));
        else if (by === "kill-switch")
          reject(new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged"));
        else reject(new PhoenixError(ErrorCode.PERMISSION_DENIED, "Rejected by user"));
      };
      const timer = setTimeout(() => finish(false, "system", true), this.timeoutMs);
      timer.unref();
      this.pending.set(id, {
        confirmation,
        timer,
        resolve: (approved, by) => finish(approved, by),
        abort: (error) => {
          if (!this.pending.delete(id)) return;
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  private emit(event: Omit<NewEvent, "source">): void {
    try {
      this.publishFn(createEvent({ ...event, source: "core" }));
    } catch (err) {
      this.logger.warn("failed to publish security event", { error: err });
    }
  }
}
