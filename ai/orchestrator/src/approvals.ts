// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { EventBus } from "@phoenix/event-bus";
import type { PermissionGateway } from "@phoenix/permissions";
import type { ApprovalFeed, ApprovalSignal } from "./types";

const isOutcome = (v: unknown): v is "approved" | "rejected" | "expired" =>
  v === "approved" || v === "rejected" || v === "expired";

/**
 * Watches the EXISTING confirmation flow (PermissionGateway events on the bus) so a run can show
 * WAITING while the user decides. It adds no approval path of its own: answers still arrive
 * through `/api/confirmations`.
 */
export function approvalFeed(
  bus: Pick<EventBus, "subscribe">,
  permissions: Pick<PermissionGateway, "pendingConfirmations" | "resolveConfirmation">,
): ApprovalFeed {
  const listeners = new Set<(signal: ApprovalSignal) => void>();
  bus.subscribe("agent-runtime-approvals", "security.confirmation.*", (event) => {
    const payload = event.payload;
    const id = payload.confirmation_id;
    if (typeof id !== "string") return;
    const signal: ApprovalSignal =
      event.event_type === "security.confirmation.requested"
        ? {
            kind: "requested",
            confirmationId: id,
            capabilityId: String(payload.capability ?? ""),
            command: String(payload.command ?? ""),
          }
        : {
            kind: "resolved",
            confirmationId: id,
            capabilityId: event.subject ?? "",
            command: "",
            ...(isOutcome(payload.outcome) ? { outcome: payload.outcome } : {}),
          };
    for (const listener of listeners) listener(signal);
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pending: () =>
      permissions
        .pendingConfirmations()
        .map((c) => ({ id: c.id, capabilityId: c.capabilityId, command: c.command })),
    reject(confirmationId) {
      permissions.resolveConfirmation(confirmationId, false, "agent-runtime");
    },
  };
}
