// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { defineCapability, type CapabilityContext } from "@phoenix/sdk";
import { realSleep, startPolling, type Sleep } from "@phoenix/service-kit";
import { ReminderBook, safeEvent, type CalendarEvent, type ReminderStore } from "./events";
import { CalendarFeedError, type CalendarAdapter } from "./adapters";
import { caldavTarget } from "./caldav";
import { prepareMeeting, type MeetingPrepQuery } from "./prep";
import {
  buildAdapter,
  PROVIDERS,
  resolveEndpoints,
  type ProviderEndpoints,
  type ProviderName,
} from "./providers";

export * from "./adapters";
export * from "./caldav";
export * from "./events";
export * from "./ics";
export * from "./prep";
export * from "./providers";
export interface CalendarOptions {
  /**
   * Adapters a host supplies itself (tests, or a real macOS reader). They win over the built-in
   * ones. Without an entry Core builds the adapter from the capability's own config and secret:
   * Google and Microsoft Graph with an access token, CalDAV with a username and app password.
   */
  adapters?: Partial<Record<ProviderName, CalendarAdapter>>;
  /** Where the Google and Graph tokens are sent. Code only, never a config setting (tests pass loopback mocks). */
  endpoints?: ProviderEndpoints;
  now?: () => number;
  sleep?: Sleep;
  prep?: MeetingPrepQuery;
  /** Where reminder de-dup keys are kept so a Core restart does not remind again. Memory only without it. */
  reminderStore?: ReminderStore;
}
const CALDAV_URL_PATTERN =
  "^(https://[^\\s@?#]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s@?#]*)?)$";
const WINDOW_MS = 7 * 86_400_000;
const POLL_MS = 60_000;
/** A forced refresh is skipped when the cached feed is at most this old. */
const FRESH_MS = 30_000;
const MAX_FEED_EVENTS = 500;

/** Providers are supplied by Core after consent and credential retrieval, never contacted on import. */
export function createCalendarCapability(options: CalendarOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const endpoints = resolveEndpoints(options.endpoints);
  const reminders = new ReminderBook(options.reminderStore);
  let events: CalendarEvent[] = [];
  let error: string | undefined;
  let lastPoll: number | undefined;
  let inflight: Promise<void> | undefined;

  function enabledProviders(ctx: CapabilityContext): ProviderName[] {
    return PROVIDERS.filter((name) => ctx.config[name] === true);
  }

  async function refresh(ctx: CapabilityContext): Promise<void> {
    const configured = enabledProviders(ctx);
    if (!configured.length) {
      events = [];
      error = undefined;
      lastPoll = now();
      return;
    }
    const at = now();
    const from = new Date(at - 60_000).toISOString();
    const to = new Date(at + WINDOW_MS).toISOString();
    try {
      const found = await Promise.all(
        configured.map(async (name) => {
          // A configured provider without its credential makes the whole feed unavailable: a
          // partial feed must never look complete (deploy freeze). macOS has no secret.
          const credential = name === "macos" ? "" : await ctx.secret(`${name}_credential`);
          if (name !== "macos" && !credential)
            throw new CalendarFeedError(`${name} credential missing`);
          const adapter =
            options.adapters?.[name] ??
            buildAdapter(name, ctx.config, credential ?? "", endpoints, ctx.signal);
          const batch = await adapter.list(from, to, ctx.signal);
          const safe: CalendarEvent[] = [];
          for (const event of batch) {
            const checked = safeEvent(event);
            if (!checked) throw new CalendarFeedError(`${name} events could not be read`);
            safe.push(checked);
          }
          return safe;
        }),
      );
      const unique = new Map<string, CalendarEvent>();
      for (const batch of found) for (const event of batch) unique.set(event.id, event);
      const next = [...unique.values()]
        .filter((event) => Date.parse(event.end) > at)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      if (next.length > MAX_FEED_EVENTS)
        throw new CalendarFeedError("feed incomplete: too many events");
      events = next;
      error = undefined;
      lastPoll = at;
      for (const event of reminders.due(events, at)) {
        const prep = options.prep
          ? await prepareMeeting(event, options.prep)
          : { decisions: [], actionItems: [] };
        ctx.emit(
          {
            event_type: "calendar.meeting.starting_soon",
            severity: "info",
            correlation_id: event.id,
            subject: event.title,
            payload: { event, prep, notetaker_offer: true },
          },
          { ephemeral: true },
        );
      }
    } catch (cause) {
      // Never promote a stale or partial feed to current, particularly for deployment freeze checks.
      // `lastPoll` is not advanced. Only our own fixed messages are surfaced, never provider text.
      events = [];
      error =
        cause instanceof CalendarFeedError ? cause.message : "Calendar feed could not be read";
    }
  }
  /** The host the CalDAV credential goes to, so the owner can see it; absent when CalDAV is off. */
  function caldavHost(ctx: CapabilityContext): { sends_caldav_credential_to?: string } {
    if (ctx.config.caldav !== true) return {};
    try {
      return { sends_caldav_credential_to: caldavTarget(ctx.config.caldav_url).url.host };
    } catch {
      return {};
    }
  }
  function poll(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= refresh(ctx).finally(() => {
      inflight = undefined;
    }));
  }
  return defineCapability({
    manifest: {
      id: "calendar",
      name: "Calendar awareness",
      version: "0.1.0",
      description:
        "Read-only upcoming meetings and deploy-freeze windows. Disabled until enabled by the owner.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      permissions: ["network", "external_api"],
      data_categories: [
        "calendar event times, titles, attendees and prep from authorized meetings",
        "calendar account credentials held in OS secret storage and sent only to the provider's own host",
      ],
      events: ["calendar.meeting.starting_soon"],
      healthcheck: { interval_ms: 60_000 },
      secrets: [
        {
          name: "google_credential",
          description:
            "A Google OAuth access token with the calendar.readonly scope. Sent only to www.googleapis.com. Phoenix cannot refresh it: when it expires (about an hour) the feed becomes unavailable until you store a new one.",
        },
        {
          name: "microsoft_credential",
          description:
            "A Microsoft Graph access token with Calendars.Read. Sent only to graph.microsoft.com. Phoenix cannot refresh it: when it expires the feed becomes unavailable until you store a new one.",
        },
        {
          name: "caldav_credential",
          description:
            "username:password (an app password) for the CalDAV server named in caldav_url. Sent with HTTP Basic only to that host, never over plain http except to localhost.",
        },
      ],
      commands: [
        {
          name: "upcoming",
          description: "Upcoming meetings and fresh freeze snapshot",
          side_effect: "read",
          permissions: ["network", "external_api"],
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              refresh: {
                type: "boolean",
                description: "Re-read providers when the cached feed is older than 30 seconds",
              },
            },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          google: { type: "boolean", default: false },
          microsoft: { type: "boolean", default: false },
          caldav: { type: "boolean", default: false },
          macos: {
            type: "boolean",
            default: false,
            description:
              "macOS Calendar. Phoenix has no built-in reader (needs a host-supplied one); turning this on without one makes the feed unavailable, never silently empty.",
          },
          caldav_url: {
            type: "string",
            maxLength: 2048,
            pattern: CALDAV_URL_PATTERN,
            description:
              "Full address of ONE CalDAV calendar collection, for example https://dav.example.com/calendars/me/work/ (https; plain http only for localhost). WARNING: the stored caldav_credential is sent to whatever host this names; Phoenix cannot stop someone who can change this setting from pointing it elsewhere. The host is shown in the upcoming command result.",
          },
          caldav_timezone: {
            type: "string",
            maxLength: 64,
            description:
              "IANA time zone (for example Europe/Berlin) used to read all-day and floating CalDAV times. Default UTC.",
          },
          freeze: {
            type: "boolean",
            default: false,
            description: "Block deployments during busy-marked deploy-freeze events",
          },
        },
      },
    },
    init(ctx) {
      events = [];
      error = undefined;
      lastPoll = undefined;
      startPolling(
        ctx,
        async () => {
          await poll(ctx);
          return POLL_MS;
        },
        sleep,
      );
    },
    commands: {
      async upcoming(input, ctx) {
        const forced = (input as { refresh?: unknown } | null)?.refresh === true;
        const stale = lastPoll === undefined || now() - lastPoll > FRESH_MS || now() < lastPoll;
        if (lastPoll === undefined || (forced && (stale || error !== undefined))) await poll(ctx);
        return {
          configured: enabledProviders(ctx).length > 0,
          ...caldavHost(ctx),
          events,
          checkedAt: lastPoll ?? null,
          error: error ?? null,
        };
      },
    },
    health() {
      return error
        ? { status: "degraded" as const, message: error }
        : { status: "healthy" as const, message: `${events.length} upcoming events` };
    },
  });
}
