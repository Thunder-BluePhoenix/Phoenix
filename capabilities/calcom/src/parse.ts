// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cal.com API v2 "Get all bookings" (GET /v2/bookings), read defensively: titles, locations and
// attendee fields are typed by strangers who booked a slot, so every field is untrusted text.
import { redact } from "@phoenix/logging";
import { epochMs, expectObject, httpsUrl, parseList, str, type Json } from "@phoenix/service-kit";

export const MAX_TEXT = 200;
/** Bookings read per poll. */
export const PAGE_SIZE = 50;
/** Cal.com booking uids are short url-safe strings; anything else never reaches a link. */
const UID = /^[A-Za-z0-9_-]{1,100}$/;

export type BookingStatus = "accepted" | "pending" | "cancelled" | "rejected";
const STATUSES: ReadonlySet<string> = new Set(["accepted", "pending", "cancelled", "rejected"]);

export interface Booking {
  uid: string;
  title: string;
  status: BookingStatus;
  /** Epoch ms. */
  start: number;
  end: number | undefined;
  /** When it was booked, and when it last changed (cancelling changes it). */
  createdAt: number;
  updatedAt: number;
  /** Set on the NEW booking that replaced an old one. */
  rescheduledFromUid: string | undefined;
  /** Set on the OLD booking that was replaced. */
  rescheduledToUid: string | undefined;
  attendeeCount: number;
  /** https only. */
  meetingUrl: string | undefined;
}

/** Free text from the remote: clipped, control characters removed, secret-looking values redacted. */
export function text(value: unknown, max = MAX_TEXT): string | undefined {
  const clipped = str(value, max * 4);
  if (clipped === undefined) return undefined;
  const clean = String(redact(clipped));
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function uid(value: unknown): string | undefined {
  const s = str(value, 100);
  return s !== undefined && UID.test(s) ? s : undefined;
}

function parseBooking(raw: Json): Booking | undefined {
  const id = uid(raw.uid);
  const start = epochMs(raw.start);
  const status = str(raw.status, 20)?.toLowerCase();
  if (id === undefined || start === undefined || status === undefined || !STATUSES.has(status)) {
    return undefined;
  }
  const createdAt = epochMs(raw.createdAt) ?? start;
  return {
    uid: id,
    title: text(raw.title) ?? "Booking",
    status: status as BookingStatus,
    start,
    end: epochMs(raw.end),
    createdAt,
    updatedAt: epochMs(raw.updatedAt) ?? createdAt,
    rescheduledFromUid: uid(raw.rescheduledFromUid),
    rescheduledToUid: uid(raw.rescheduledToUid),
    attendeeCount: Array.isArray(raw.attendees) ? Math.min(raw.attendees.length, 1000) : 0,
    meetingUrl: httpsUrl(raw.meetingUrl),
  };
}

/** `{ status: "success", data: [...] }`. A malformed entry is skipped; a malformed body throws. */
export function parseBookings(body: unknown): Booking[] {
  const object = expectObject(body);
  if (object.status !== undefined && object.status !== "success") {
    throw new TypeError("error response");
  }
  return parseList(object.data, parseBooking, PAGE_SIZE);
}
