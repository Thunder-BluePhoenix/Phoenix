// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, isPermission, PhoenixError } from "@phoenix/protocol";
import { expectBoolean, expectObject, intParam, route, type Route } from "./http";
import { agentRoutes } from "./agent-routes";
import { graphRoutes } from "./graph-routes";
import { meetingReviewRoutes } from "./meeting-routes";
import { memoryRoutes } from "./memory-routes";
import { planRoutes } from "./plan-routes";
import { workflowRoutes } from "./workflow-routes";
import type { CoreServices } from "./services";

const notFound = (what: string) =>
  new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);

export function buildRoutes(s: CoreServices): Route[] {
  const notes = () => {
    if (!s.notifications) throw notFound("Notifications");
    return s.notifications;
  };
  const caps = () => {
    if (!s.capabilities) throw notFound("Capability registry");
    return s.capabilities;
  };
  const meetings = () => {
    if (!s.meetings) throw notFound("Meetings");
    return s.meetings;
  };
  const privacy = () => {
    if (!s.privacy) throw notFound("Privacy");
    return s.privacy;
  };
  const found = <T>(value: T | null, what: string): T => {
    if (value === null) throw notFound(what);
    return value;
  };
  return [
    route("GET", "/api/health", () => s.health(), true),
    route("GET", "/api/diagnostics", () => {
      if (!s.diagnostics) throw notFound("Diagnostics");
      return s.diagnostics();
    }),

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
    route("GET", "/api/pet/settings", () => {
      if (!s.petSettings) throw notFound("Pet settings");
      return s.petSettings();
    }),
    route("POST", "/api/pet/settings", async ({ body }) => {
      if (!s.setPetSettings) throw notFound("Pet settings");
      return s.setPetSettings(expectObject(await body()));
    }),
    route("GET", "/api/events", ({ url }) => {
      const afterSeq = intParam(url, "after_seq");
      const items = s.events.recent({
        limit: intParam(url, "limit", 100)!,
        ...(afterSeq !== undefined ? { afterSeq } : {}),
        ...(url.searchParams.get("source") ? { source: url.searchParams.get("source")! } : {}),
        ...(url.searchParams.get("type") ? { type: url.searchParams.get("type")! } : {}),
      });
      return {
        events: items.map((i) => ({
          seq: i.seq,
          event: i.event,
          description: s.state.describe(i.event),
        })),
      };
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

    // ── Capabilities ────────────────────────────────────────────────────────
    route("GET", "/api/capabilities", () => ({ capabilities: s.capabilities?.list() ?? [] })),
    route("POST", "/api/capabilities/register", async ({ body, res }) => {
      const b = expectObject(await body());
      if (typeof b.endpoint !== "string")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"endpoint" must be a string');
      if (b.callback_secret !== undefined && typeof b.callback_secret !== "string")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"callback_secret" must be a string');
      const result = await caps().registerExternal(
        b.manifest,
        b.endpoint,
        b.callback_secret as string | undefined,
      );
      res.statusCode = 201;
      return result;
    }),
    route("GET", "/api/capabilities/:id", ({ params }) => caps().get(params.id!)),
    route("POST", "/api/capabilities/:id/enable", ({ params }) => caps().enable(params.id!)),
    route("POST", "/api/capabilities/:id/disable", ({ params }) => caps().disable(params.id!)),
    route("POST", "/api/capabilities/:id/config", async ({ params, body }) => {
      const b = expectObject(await body());
      return caps().configure(params.id!, b.config);
    }),
    // Write-only: values go to OS secret storage and are never returned.
    route("POST", "/api/capabilities/:id/secrets/:name", async ({ params, body }) => {
      const value = expectObject(await body()).value;
      if (typeof value !== "string") {
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"value" must be a string');
      }
      return caps().setSecret(params.id!, params.name!, value);
    }),
    route("DELETE", "/api/capabilities/:id/secrets/:name", ({ params }) =>
      caps().deleteSecret(params.id!, params.name!),
    ),
    route("POST", "/api/capabilities/:id/uninstall", async ({ params, body }) => {
      const b = expectObject(await body());
      await caps().uninstall(params.id!, { retainData: b.retain_data === true });
      return { uninstalled: params.id };
    }),
    route("POST", "/api/capabilities/:id/commands/:command", async ({ params, body, res }) => {
      const b = expectObject(await body());
      const op = caps().invoke(params.id!, params.command!, b.input ?? {}, "user");
      res.statusCode = 202;
      return op;
    }),
    route("GET", "/api/operations/:id", ({ params }) => caps().operation(params.id!)),
    // Authenticated with the capability token (not the session token), checked by the manager.
    route(
      "POST",
      "/api/capabilities/:id/events",
      async ({ params, body, req, res }) => {
        const token = req.headers["x-phoenix-capability-token"];
        const result = caps().ingest(
          params.id!,
          typeof token === "string" ? token : undefined,
          await body(),
        );
        if (!result.ok) throw result.error;
        res.statusCode = 202;
        return { event_id: result.event.event_id, seq: result.seq };
      },
      true,
    ),

    // ── Meetings (Kage) ─────────────────────────────────────────────────────
    // Before the generic `/api/meetings/:id` routes: "search" and "ask" are not meeting ids.
    ...meetingReviewRoutes(s),
    ...planRoutes(s),
    route("GET", "/api/meetings", ({ url }) => ({
      meetings: meetings().list({
        archived: url.searchParams.get("archived") === "true",
        limit: intParam(url, "limit", 100)!,
      }),
    })),
    route("GET", "/api/meetings/:id", ({ params }) => found(meetings().get(params.id!), "Meeting")),
    route("GET", "/api/meetings/:id/transcript", ({ params }) =>
      found(meetings().transcript(params.id!), "Transcript"),
    ),
    route("GET", "/api/meetings/:id/summary", ({ params }) =>
      found(meetings().summary(params.id!), "Summary"),
    ),
    route("POST", "/api/meetings/:id/archive", async ({ params, body }) => {
      const archived = (await body().catch(() => ({}))) as { archived?: unknown };
      return found(meetings().archive(params.id!, archived?.archived !== false), "Meeting");
    }),
    // Deletes Phoenix's copy; the recording itself is managed by the capability (e.g. Kage).
    route("DELETE", "/api/meetings/:id", async ({ params, body }) => {
      const b = (await body().catch(() => ({}))) as { confirm?: unknown } | null;
      if (b?.confirm !== true) {
        throw new PhoenixError(
          ErrorCode.ACTION_REQUIRES_CONFIRMATION,
          'Deleting a meeting needs {"confirm": true}',
        );
      }
      if (!meetings().delete(params.id!)) throw notFound("Meeting");
      return { deleted: params.id };
    }),

    // ── Privacy ─────────────────────────────────────────────────────────────
    route("GET", "/api/privacy", () => privacy().inventory()),
    route("POST", "/api/privacy/retention", async ({ body }) =>
      privacy().setRetention(expectObject(await body())),
    ),
    route("POST", "/api/privacy/delete", async ({ body }) => {
      const b = expectObject(await body());
      return privacy().deleteAll(b.data, b.confirm);
    }),

    ...memoryRoutes(s),
    ...graphRoutes(s),
    ...agentRoutes(s),
    ...workflowRoutes(s),

    // ── Notifications ───────────────────────────────────────────────────────
    route("GET", "/api/notifications", ({ url }) =>
      notes().list({
        unreadOnly: url.searchParams.get("unread_only") === "true",
        limit: intParam(url, "limit", 50)!,
      }),
    ),
    route("POST", "/api/notifications/read-all", () => ({ marked: notes().markAllRead() })),
    route("POST", "/api/notifications/:id/read", ({ params }) => notes().markRead(params.id!)),
    route("GET", "/api/notifications/preferences", () => notes().preferences()),
    route("POST", "/api/notifications/preferences", async ({ body }) =>
      notes().setPreferences(await body()),
    ),

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
    // Additive: a confirmation raised for an agent run also carries risk, target, preview,
    // task_id and evidence_ids. Every existing field is unchanged.
    route("GET", "/api/confirmations", () => ({
      confirmations: s.permissions.pendingConfirmations().map((c) => {
        const agent = s.agents?.describeConfirmation(c.id);
        return agent ? { ...c, ...agent } : c;
      }),
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
