// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, isPermission, PhoenixError } from "@phoenix/protocol";
import { expectBoolean, expectObject, intParam, route, type Route } from "./http";
import type { CoreServices } from "./services";

const notFound = (what: string) =>
  new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);

export function buildRoutes(s: CoreServices): Route[] {
  return [
    route("GET", "/api/health", () => s.health(), true),

    // ── Fawkes ──────────────────────────────────────────────────────────────
    route("GET", "/api/pet/state", () => s.state.snapshot()),
    route("GET", "/api/pet/tasks", () => ({ tasks: s.state.tasks() })),
    route("POST", "/api/pet/sleep", async ({ body }) => {
      s.setSleeping(expectBoolean(expectObject(await body()), "sleeping"));
      return s.state.snapshot();
    }),
    route("POST", "/api/pet/acknowledge", async ({ body }) => {
      const b = expectObject(await body());
      if (b.key === undefined) return { acknowledged: s.state.acknowledgeErrors() };
      if (typeof b.key !== "string")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"key" must be a string');
      if (!s.state.acknowledge(b.key)) throw notFound("Condition");
      return { acknowledged: 1 };
    }),

    // ── Events ──────────────────────────────────────────────────────────────
    route("GET", "/api/events", ({ url }) => {
      const afterSeq = intParam(url, "after_seq");
      const items = s.events.recent({
        limit: intParam(url, "limit", 100)!,
        ...(afterSeq !== undefined ? { afterSeq } : {}),
        ...(url.searchParams.get("source") ? { source: url.searchParams.get("source")! } : {}),
        ...(url.searchParams.get("type") ? { type: url.searchParams.get("type")! } : {}),
      });
      return { events: items.map((i) => ({ seq: i.seq, event: i.event })) };
    }),
    route("POST", "/api/events", async ({ body, res }) => {
      const event = await body();
      // "core" is reserved for events Phoenix itself emits.
      if (expectObject(event).source === "core") {
        throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, 'Source "core" is reserved');
      }
      const result = s.bus.publish(event);
      if (!result.ok) throw result.error;
      res.statusCode = 202;
      return { event_id: result.event.event_id, seq: result.seq };
    }),

    // ── Capabilities (registry arrives in Phase 12) ─────────────────────────
    route("GET", "/api/capabilities", () => ({ capabilities: s.capabilities?.list() ?? [] })),
    route("POST", "/api/capabilities/:id/enable", async ({ params }) => {
      if (!s.capabilities) throw notFound(`Capability "${params.id}"`);
      return s.capabilities.enable(params.id!);
    }),
    route("POST", "/api/capabilities/:id/disable", async ({ params }) => {
      if (!s.capabilities) throw notFound(`Capability "${params.id}"`);
      return s.capabilities.disable(params.id!);
    }),

    // ── Permissions, confirmations, audit, kill switch ──────────────────────
    route("GET", "/api/permissions", ({ url }) => {
      const cap = url.searchParams.get("capability") ?? undefined;
      return { grants: s.permissions.grants.list(cap) };
    }),
    route("POST", "/api/permissions/:capability/revoke", async ({ params, body }) => {
      const b = expectObject(await body());
      let perms: string[] | undefined;
      if (b.permissions !== undefined) {
        if (
          !Array.isArray(b.permissions) ||
          !b.permissions.every((p) => typeof p === "string" && isPermission(p))
        ) {
          throw new PhoenixError(
            ErrorCode.INVALID_REQUEST,
            '"permissions" must be a list of permission names',
          );
        }
        perms = b.permissions as string[];
      }
      s.permissions.revoke(params.capability!, perms as never);
      return { grants: s.permissions.grants.list(params.capability) };
    }),
    route("GET", "/api/confirmations", () => ({
      confirmations: s.permissions.pendingConfirmations(),
    })),
    route("POST", "/api/confirmations/:id", async ({ params, body }) => {
      const approve = expectBoolean(expectObject(await body()), "approve");
      if (!s.permissions.resolveConfirmation(params.id!, approve)) throw notFound("Confirmation");
      return { id: params.id, approved: approve };
    }),
    route("GET", "/api/audit", ({ url }) => {
      const cap = url.searchParams.get("capability");
      return {
        entries: s.permissions.audit.list({
          limit: intParam(url, "limit", 100)!,
          ...(cap ? { capabilityId: cap } : {}),
        }),
      };
    }),
    route("GET", "/api/security/kill-switch", () => ({
      engaged: s.permissions.isKillSwitchEngaged(),
    })),
    route("POST", "/api/security/kill-switch", async ({ body }) => {
      const engaged = expectBoolean(expectObject(await body()), "engaged");
      if (engaged) s.permissions.engageKillSwitch("user");
      else s.permissions.disengageKillSwitch("user");
      return { engaged };
    }),
  ];
}
