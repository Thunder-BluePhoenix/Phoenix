// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, isPermission, PhoenixError } from "@phoenix/protocol";
import { expectBoolean, expectObject, intParam, route, type Route } from "./http";
import { approvalRef, sameApprovalRef } from "./approval-ref";
import { agentApprovalRoutes } from "./agent-approval-routes";
import { agentLiveRoutes } from "./agent-live-routes";
import { agentRelayRoutes } from "./agent-relay-routes";
import { agentRoutes } from "./agent-routes";
import { autonomyRoutes } from "./autonomy-routes";
import { graphRoutes } from "./graph-routes";
import { meetingReviewRoutes } from "./meeting-routes";
import { focusRoutes } from "./focus-routes";
import { memoryRoutes } from "./memory-routes";
import { planRoutes } from "./plan-routes";
import { workflowRoutes } from "./workflow-routes";
import { voiceRoutes } from "./voice-routes";
import { proactiveRoutes } from "./proactive-routes";
import { syncRoutes } from "./sync-routes";
import { registryRoutes } from "./registry-routes";
import { dictationRoutes } from "./dictation-routes";
import { notetakerRoutes } from "./notetaker-routes";
import { digestRoutes } from "./digest-routes";
import { calendarRoutes } from "./calendar-routes";
import { teamStatusRoutes, teamWebhookRoutes } from "./team-webhook-routes";
import { teamLinkRoutes } from "./team-link-routes";
import { statusLightRoutes } from "./status-light-routes";
import { quitCheckRoutes } from "./quit-check-routes";
import { awakeStatusRoutes } from "./awake-status-routes";
import { scheduledAwakeRoutes } from "./scheduled-awake-routes";
import { fawkesRebirthRoutes } from "./fawkes-rebirth-routes";
import { browserProfileRoutes } from "./browser-profile-routes";
import { musicConnectorRoutes } from "./music-connector-routes";
import { filterListRoutes } from "./filter-list-routes";
import { chatApprovalRoutes } from "./chat-approval-routes";
import { remoteRelayRoutes } from "./remote-relay-routes";
import { engineeringSignalsRoutes } from "./engineering-signals-routes";
import { multimodalRoutes } from "./multimodal-routes";
import { improvementRoutes } from "./improvement-routes";
import { appearanceRoutes } from "./appearance-routes";
import { uiRoutes } from "./ui-routes";
import { attachmentRoutes } from "./attachment-routes";
import { demoRoutes } from "./demo-routes";
import { recapRoutes } from "./recap-routes";
import { missionRoutes } from "./mission-routes";
import { safetyRoutes } from "./safety-routes";
import { mcpRoutes } from "./mcp-routes";
import { handoffRoutes } from "./handoff-routes";
import { phoneRoutes } from "./phone-routes";
import type { CoreServices } from "./services";

const notFound = (what: string) =>
  new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);

/**
 * Event types only Core emits (Phase 58 live signals, Phase 64/65 microphone indicators); `POST
 * /api/events` refuses them. `dictation.idle` / `notetaker.idle` CLEAR the LISTENING / RECORDING
 * state, so a forged copy would hide a live microphone from the user; the `listening` / `recording`
 * ones would fake it.
 */
const CORE_ONLY_EVENT =
  /^(agent\.(session\.step|usage\.(updated|warning)|safety\.(loop|stall|checkpoint))|dictation\.(listening|idle)|voice\.(listening|idle)|notetaker\.(recording|idle|meeting\.updated))$/;
const isCoreOnlyEvent = (type: unknown): boolean =>
  typeof type === "string" && CORE_ONLY_EVENT.test(type);

/**
 * Event types and sources of the built-in service capabilities (Phases 67, 68, 69). They only ever
 * emit through `ctx.emit`, so `POST /api/events` refuses anything that claims to be one of them.
 */
const IN_PROCESS_ONLY =
  /^(vercel|stripe|n8n|resend|notion|calcom|calendar|spotify|apple_music|mpris|portfolio|webhook-[a-z0-9_-]+)(\.|$)/;
const isInProcessOnly = (value: unknown): boolean =>
  typeof value === "string" && IN_PROCESS_ONLY.test(value);

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
    route("GET", "/api/events/source-policy", () => {
      if (!s.eventSourcePolicy)
        throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Event source policy not available");
      return s.eventSourcePolicy.get();
    }),
    route("PUT", "/api/events/source-policy", async ({ body }) => {
      if (!s.eventSourcePolicy)
        throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Event source policy not available");
      return s.eventSourcePolicy.set(await body());
    }),
    route("POST", "/api/events", async ({ body, res }) => {
      const event = await body();
      // Provider identities belong to their enabled capabilities, not arbitrary API clients.
      // CapabilityManager ingests these through manifest-scoped ctx.emit or token ingestion.
      const postedSource = expectObject(event).source;
      if (["core", "agents", "github", "issues"].includes(String(postedSource))) {
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          `Source "${String(postedSource)}" is reserved`,
        );
      }
      if (String(postedSource) === "terminal" && s.eventSourcePolicy?.get().reserveTerminal) {
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          'Source "terminal" is reserved (you turned this on in event source settings)',
        );
      }
      // The live agent-session signals are Core's own: a durable copy from another source would
      // be stored, replayed after reconnect and shown as a real step or usage reading.
      if (isCoreOnlyEvent(expectObject(event).event_type)) {
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          `Event type "${String(expectObject(event).event_type)}" is reserved for Core`,
        );
      }
      // These capabilities only ever emit through their own in-process `ctx.emit`; a copy posted
      // here would be indistinguishable from a real deployment, payment or booking.
      const posted = expectObject(event);
      if (
        isInProcessOnly(posted.event_type) ||
        isInProcessOnly(posted.source) ||
        /^(github|issues)(\.|$)/.test(String(posted.event_type))
      ) {
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          "Events of the built-in service capabilities cannot be posted",
        );
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
    route("POST", "/api/capabilities/:id/enable", async ({ params, body }) => {
      const b = expectObject(await body());
      for (const key of Object.keys(b)) {
        if (key !== "manifest_version")
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, `Unknown enable field: ${key}`);
      }
      if (b.manifest_version !== undefined && typeof b.manifest_version !== "string")
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"manifest_version" must be a string');
      return caps().enable(
        params.id!,
        "user",
        typeof b.manifest_version === "string"
          ? { manifestVersion: b.manifest_version }
          : undefined,
      );
    }),
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
    ...autonomyRoutes(s),

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

    ...(s.focus ? focusRoutes(s.focus) : []),
    ...proactiveRoutes(s),

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
    // The gateway exposes only workflow, run and step identifiers here, never arbitrary action
    // details or tool input. Non-workflow confirmations have no run linkage.
    route("GET", "/api/confirmations", () => ({
      confirmations: s.permissions.pendingConfirmations().map((c) => {
        const agent = s.agents?.describeConfirmation(c.id);
        const view = agent ? { ...c, ...agent } : c;
        return { ...view, ref: approvalRef("confirmation", view) };
      }),
    })),
    route("POST", "/api/confirmations/:id", async ({ req, params, body }) => {
      const input = expectObject(await body());
      const approve = expectBoolean(input, "approve");
      if (req.headers["x-phoenix-client"] === "phoenix-cli") {
        const current = s.permissions.pendingConfirmations().find((c) => c.id === params.id);
        const agent = current ? s.agents?.describeConfirmation(current.id) : undefined;
        const view = current ? (agent ? { ...current, ...agent } : current) : undefined;
        if (!view || !sameApprovalRef(approvalRef("confirmation", view), input.ref))
          throw new PhoenixError(
            ErrorCode.EVENT_DUPLICATE,
            "Confirmation changed; list and review it again",
          );
      }
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
    ...registryRoutes(s),
    ...syncRoutes(s),
    ...multimodalRoutes(s),
    ...dictationRoutes(s),
    ...voiceRoutes(s),
    ...notetakerRoutes(s),
    ...improvementRoutes(s),
    ...appearanceRoutes(s),
    ...uiRoutes(s),
    ...attachmentRoutes(s),
    ...demoRoutes(s),
    ...agentApprovalRoutes(s),
    ...agentRelayRoutes(s),
    ...agentLiveRoutes(s),
    ...recapRoutes(s),
    ...safetyRoutes(s),
    ...missionRoutes(s),
    ...mcpRoutes(s),
    ...handoffRoutes(s),
    ...phoneRoutes(s),
    ...(s.digest ? digestRoutes(s.digest, s.digestSlack) : []),
    ...(s.calendar ? calendarRoutes(s.calendar) : []),
    ...(s.engineeringSignals ? engineeringSignalsRoutes(s.engineeringSignals) : []),
    ...(s.teamWebhooks ? teamWebhookRoutes(s.teamWebhooks) : []),
    ...(s.teamStatus ? teamStatusRoutes(s.teamStatus) : []),
    ...(s.teamLink ? teamLinkRoutes(s.teamLink) : []),
    ...(s.statusLights ? statusLightRoutes(s.statusLights) : []),
    ...(s.scheduledAwake ? scheduledAwakeRoutes(s.scheduledAwake) : []),
    ...(s.quitCheck ? quitCheckRoutes(s.quitCheck) : []),
    ...(s.awakeStatus ? awakeStatusRoutes(s.awakeStatus) : []),
    ...(s.fawkesRebirth ? fawkesRebirthRoutes(s.fawkesRebirth) : []),
    ...(s.browserProfiles ? browserProfileRoutes(s.browserProfiles) : []),
    ...(s.musicConnectors ? musicConnectorRoutes(s.musicConnectors) : []),
    ...(s.filterLists ? filterListRoutes(s.filterLists) : []),
    ...(s.chatApprovals ? chatApprovalRoutes(s.chatApprovals) : []),
    ...(s.remoteRelay ? remoteRelayRoutes(s.remoteRelay) : []),
  ];
}
