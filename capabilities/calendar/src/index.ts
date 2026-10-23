// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { defineCapability, type CapabilityContext } from "@phoenix/sdk";
import { realSleep, startPolling, type Sleep } from "@phoenix/service-kit";
import { ReminderBook, safeEvent, type CalendarEvent, type ReminderStore } from "./events";
import { CalendarFeedError, type CalendarAdapter } from "./adapters";
import { prepareMeeting, type MeetingPrepQuery } from "./prep";

export * from "./adapters";
export * from "./events";
export * from "./prep";
export interface CalendarOptions {
  adapters?: Partial<Record<"caldav" | "google" | "microsoft" | "macos", CalendarAdapter>>;
  now?: () => number;
  sleep?: Sleep;
  prep?: MeetingPrepQuery;
  /** Where reminder de-dup keys are kept so a Core restart does not remind again. Memory only without it. */
  reminderStore?: ReminderStore;
}
const WINDOW_MS = 7 * 86_400_000;
const POLL_MS = 60_000;
/** A forced refresh is skipped when the cached feed is at most this old. */
const FRESH_MS = 30_000;
const MAX_FEED_EVENTS = 500;

/** Providers are supplied by Core after consent and credential retrieval, never contacted on import. */
export function createCalendarCapability(options: CalendarOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const reminders = new ReminderBook(options.reminderStore);
  let events: CalendarEvent[] = [];
  let error: string | undefined;
  let lastPoll: number | undefined;
  let inflight: Promise<void> | undefined;

  async function refresh(ctx: CapabilityContext): Promise<void> {
    const configured = Object.entries(options.adapters ?? {}).filter(
      ([name]) => ctx.config[name] === true,
    );
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
        configured.map(async ([name, adapter]) => {
          if (!adapter) throw new CalendarFeedError(`${name} adapter missing`);
          // Secret access belongs to Core. A configured provider without its credential makes the
          // whole feed unavailable: a partial feed must never look complete (deploy freeze).
          if (name !== "macos" && !(await ctx.secret(`${name}_credential`)))
            throw new CalendarFeedError(`${name} credential missing`);
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
      ],
      events: ["calendar.meeting.starting_soon"],
      healthcheck: { interval_ms: 60_000 },
      secrets: ["google", "microsoft", "caldav"].map((provider) => ({
        name: `${provider}_credential`,
        description: `Read-only ${provider} calendar credential`,
      })),
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
          macos: { type: "boolean", default: false },
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
          configured: Object.keys(options.adapters ?? {}).some((name) => ctx.config[name] === true),
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
