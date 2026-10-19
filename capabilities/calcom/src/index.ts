// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cal.com capability (Phase 67): announces new, cancelled and rescheduled bookings and reminds you
// shortly before one starts. Strictly read-only: it uses ReadOnlyClient (GET only) and has no
// command that books, cancels or reschedules.
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  nextDelay,
  realSleep,
  safeBaseUrl,
  ServiceError,
  startPolling,
  type ReadOnlyClient,
  type ServiceItem,
  type ServiceStatus,
  type Sleep,
} from "@phoenix/service-kit";
import {
  DEFAULT_BASE_URL,
  SECRET_NAME,
  SERVICE,
  bookingsPath,
  bookingUrl,
  calClient,
} from "./client";
import { BookingDiff, type CalEvent } from "./events";
import { parseBookings, type Booking } from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 60_000;
export const MIN_POLL_MS = 15_000;
export const DEFAULT_REMIND_MINUTES = 10;
export const MAX_REMIND_MINUTES = 120;
const MAX_ITEMS = 25;
const NO_KEY_NOTE = "Add a Cal.com API key in the capability's secrets";

export interface CalcomCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: Sleep;
  /**
   * Address of the Cal.com API. Code only, deliberately NOT a config setting: the key may only
   * ever be sent to Cal.com's own origin. Tests pass a loopback mock here.
   */
  apiUrl?: string;
}

interface Settings {
  pollMs: number;
  remindMinutes: number;
}

function settings(ctx: CapabilityContext): Settings {
  const { poll_ms, remind_minutes } = ctx.config;
  return {
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
    remindMinutes:
      typeof remind_minutes === "number"
        ? Math.min(Math.max(remind_minutes, 0), MAX_REMIND_MINUTES)
        : DEFAULT_REMIND_MINUTES,
  };
}

function toItem(booking: Booking): ServiceItem {
  return {
    id: booking.uid,
    title: booking.title,
    state: booking.status,
    ...(booking.attendeeCount > 0
      ? { detail: `${booking.attendeeCount} attendee${booking.attendeeCount === 1 ? "" : "s"}` }
      : {}),
    url: bookingUrl(booking.uid),
    at: new Date(booking.start).toISOString(),
  };
}

/** A fresh capability instance (its own watcher state); Phoenix Core uses `createCalcomCapability()`. */
export function createCalcomCapability(options: CalcomCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const checkedUrl = safeBaseUrl(options.apiUrl ?? DEFAULT_BASE_URL);
  if (checkedUrl === undefined) throw new TypeError("apiUrl must be https, or http to loopback");
  const apiUrl: string = checkedUrl;

  let client: ReadOnlyClient | undefined;
  let clientKey = "";
  let lifetime: AbortSignal | undefined;
  let diff = new BookingDiff(0);
  let items: ServiceItem[] = [];
  let polled = false;
  let inflight: Promise<void> | null = null;
  let failure: ServiceError | undefined;
  let failures = 0;

  function announce(ctx: CapabilityContext, events: readonly CalEvent[]): void {
    for (const event of events) {
      // The reminder is a nudge, not history: it reaches whoever is watching and is not stored.
      void ctx.emit(event, event.event_type.endsWith(".starting_soon") ? { ephemeral: true } : {});
    }
  }

  async function poll(ctx: CapabilityContext): Promise<void> {
    failure = undefined;
    const { remindMinutes } = settings(ctx);
    const key = await ctx.secret(SECRET_NAME);
    if (!key) {
      items = [];
      polled = true;
      return;
    }
    if (!client || clientKey !== key) {
      client = calClient(apiUrl, key, lifetime ?? ctx.signal);
      clientKey = key;
    }
    try {
      const at = now();
      const bookings = await client.get(bookingsPath(at), parseBookings);
      items = bookings
        .filter((b) => b.status !== "cancelled" && b.status !== "rejected" && b.start >= at)
        .map(toItem)
        .slice(0, MAX_ITEMS);
      announce(ctx, diff.update(bookings));
      if (remindMinutes > 0) announce(ctx, diff.reminders(bookings, at, remindMinutes * 60_000));
    } catch (err) {
      failure =
        err instanceof ServiceError
          ? err
          : new ServiceError(SERVICE, "invalid", "Unexpected error while reading Cal.com");
    }
    polled = true;
  }

  function pollOnce(ctx: CapabilityContext): Promise<void> {
    return (inflight ??= poll(ctx).finally(() => (inflight = null)));
  }

  return defineCapability({
    manifest: {
      id: "calcom",
      name: "Cal.com",
      version: "0.1.0",
      description:
        "Upcoming Cal.com bookings: tells Fawkes when a booking is made, cancelled or rescheduled, and reminds you shortly before one starts. Strictly read-only: it reads bookings (GET only) and cannot book, cancel or reschedule anything. Needs a Cal.com API key.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: [
        "calcom.booking.created",
        "calcom.booking.cancelled",
        "calcom.booking.rescheduled",
        "calcom.booking.starting_soon",
      ],
      permissions: ["network", "external_api"],
      data_categories: ["booking titles and times", "attendee counts (not names or emails)"],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: SECRET_NAME,
          description:
            "Cal.com API key (Settings → Developer → API keys). Phoenix only ever lists bookings with it; it never books, cancels or reschedules.",
        },
      ],
      commands: [
        {
          name: "status",
          description: "Your upcoming Cal.com bookings",
          side_effect: "read",
          permissions: ["network", "external_api"],
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS}). Checks pause while nothing is watching Phoenix.`,
          },
          remind_minutes: {
            type: "integer",
            minimum: 0,
            maximum: MAX_REMIND_MINUTES,
            description: `Remind this many minutes before a booking starts (default ${DEFAULT_REMIND_MINUTES}; 0 turns reminders off).`,
          },
        },
      },
      state_rules: [
        {
          match: "calcom.booking.starting_soon",
          effect: { state: "WARNING", explain: "Starting soon: {subject}", ttlMs: 5 * 60_000 },
        },
      ],
    },
    init(ctx) {
      lifetime = ctx.signal;
      client = undefined;
      clientKey = "";
      items = [];
      polled = false;
      failure = undefined;
      failures = 0;
      // History rule: bookings made or cancelled before this moment are background, not news.
      diff = new BookingDiff(now());
      startPolling(
        ctx,
        async () => {
          await pollOnce(ctx);
          failures = failure ? failures + 1 : 0;
          return nextDelay(settings(ctx).pollMs, failures, failure);
        },
        sleep,
      );
    },
    commands: {
      async status(_input, ctx): Promise<ServiceStatus> {
        if (!(await ctx.secret(SECRET_NAME))) {
          return { configured: false, items: [], note: NO_KEY_NOTE };
        }
        if (!polled) await pollOnce(ctx);
        if (failure) throw failure;
        return { configured: true, items };
      },
    },
    async health(ctx): Promise<HealthResult> {
      if (!(await ctx.secret(SECRET_NAME))) return { status: "degraded", message: NO_KEY_NOTE };
      if (!polled) return { status: "healthy", message: "Reading Cal.com…" };
      if (failure?.kind === "auth" || failure?.kind === "rate_limit") {
        return { status: "degraded", message: failure.message };
      }
      if (failure) return { status: "unhealthy", message: failure.message };
      return { status: "healthy", message: `${items.length} upcoming booking(s)` };
    },
  });
}
