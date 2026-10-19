// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cal.com → Phoenix events. History rule (see ChangeTracker): a booking first seen that was made
// (or, if cancelled, cancelled) before the capability was enabled is recorded silently. After
// that: a new booking is `created` (or `rescheduled` when it replaces another), a booking that
// turns cancelled/rejected is `cancelled`, and one whose start moved is `rescheduled`.
// `starting_soon` is ephemeral: a reminder that is not kept in history.
import { ChangeTracker } from "@phoenix/service-kit";
import { bookingUrl } from "./client";
import type { Booking } from "./parse";

export interface CalEvent {
  event_type: string;
  severity: "info" | "warning";
  correlation_id: string;
  subject: string;
  payload: Record<string, unknown>;
}

/** Reminders remembered; a booking that starts is past the window long before this fills. */
const MAX_REMINDED = 500;
const GONE: ReadonlySet<string> = new Set(["cancelled", "rejected"]);

function stateOf(booking: Booking): string {
  return `${booking.status}|${booking.start}`;
}

function payloadOf(booking: Booking, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    booking_uid: booking.uid,
    title: booking.title,
    status: booking.status,
    start: new Date(booking.start).toISOString(),
    ...(booking.end !== undefined ? { end: new Date(booking.end).toISOString() } : {}),
    attendee_count: booking.attendeeCount,
    url: bookingUrl(booking.uid),
    ...(booking.meetingUrl ? { meeting_url: booking.meetingUrl } : {}),
    ...extra,
  };
}

function event(
  type: "created" | "cancelled" | "rescheduled" | "starting_soon",
  booking: Booking,
  extra?: Record<string, unknown>,
): CalEvent {
  return {
    event_type: `calcom.booking.${type}`,
    severity: type === "cancelled" ? "warning" : "info",
    correlation_id: `calcom-booking-${booking.uid}`,
    subject: booking.title,
    payload: payloadOf(booking, extra),
  };
}

export function startingSoonEvent(booking: Booking, minutes: number): CalEvent {
  return event("starting_soon", booking, { minutes_until: Math.max(0, Math.ceil(minutes)) });
}

export class BookingDiff {
  private readonly tracker: ChangeTracker<Booking>;
  private readonly reminded = new Set<string>();

  constructor(liveSince: number) {
    this.tracker = new ChangeTracker<Booking>({
      key: (booking) => booking.uid,
      state: stateOf,
      // A booking cancelled while we were away is news at the time of cancelling, not of booking.
      at: (booking) => (GONE.has(booking.status) ? booking.updatedAt : booking.createdAt),
      liveSince,
    });
  }

  update(bookings: readonly Booking[]): CalEvent[] {
    const out: CalEvent[] = [];
    for (const change of this.tracker.update(bookings)) {
      const booking = change.item;
      // The old booking of a reschedule turns cancelled; the new one carries the news.
      if (GONE.has(booking.status)) {
        if (booking.rescheduledToUid === undefined) out.push(event("cancelled", booking));
      } else if (change.kind === "new") {
        out.push(
          booking.rescheduledFromUid
            ? event("rescheduled", booking, { rescheduled_from: booking.rescheduledFromUid })
            : event("created", booking),
        );
      } else if (change.previous !== undefined && !change.previous.endsWith(`|${booking.start}`)) {
        out.push(event("rescheduled", booking));
      }
    }
    return out;
  }

  /**
   * Bookings starting within `windowMs` that have not been reminded about at this start time.
   * Past or already-started bookings never remind.
   */
  reminders(bookings: readonly Booking[], now: number, windowMs: number): CalEvent[] {
    const out: CalEvent[] = [];
    for (const booking of bookings) {
      if (booking.status !== "accepted" || booking.start <= now || booking.start - now > windowMs) {
        continue;
      }
      const key = `${booking.uid}|${booking.start}`;
      if (this.reminded.has(key)) continue;
      if (this.reminded.size >= MAX_REMINDED) this.reminded.clear();
      this.reminded.add(key);
      out.push(startingSoonEvent(booking, (booking.start - now) / 60_000));
    }
    return out;
  }
}
