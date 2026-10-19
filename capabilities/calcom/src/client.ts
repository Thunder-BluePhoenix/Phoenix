// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cal.com is watched, never driven: this client is a ReadOnlyClient, which has no method that
// sends a body, so nothing here can book, cancel or reschedule.
import { ReadOnlyClient } from "@phoenix/service-kit";
import { PAGE_SIZE } from "./parse";

export const SERVICE = "Cal.com";
export const DEFAULT_BASE_URL = "https://api.cal.com";
export const SECRET_NAME = "api_key";
/** Fixed: the bookings endpoint is versioned by this header and the parsers expect this shape. */
export const CAL_API_VERSION = "2024-08-13";
/** Where a booking can be opened: built from the validated uid, never copied from the response. */
export const BOOKING_PAGE = "https://app.cal.com/booking/";
const LOOKBACK_MS = 24 * 60 * 60_000;

export function calClient(baseUrl: string, apiKey: string, signal: AbortSignal): ReadOnlyClient {
  return new ReadOnlyClient({
    service: SERVICE,
    baseUrl,
    secret: apiKey,
    auth: (key) => ({ authorization: `Bearer ${key}` }),
    headers: { "cal-api-version": CAL_API_VERSION },
    signal,
  });
}

/**
 * Upcoming, unconfirmed and cancelled bookings starting from yesterday on, soonest first. The
 * lower bound keeps old cancelled bookings from filling the page.
 */
export function bookingsPath(nowMs: number): string {
  const after = new Date(nowMs - LOOKBACK_MS).toISOString();
  return `/v2/bookings?status=upcoming,unconfirmed,cancelled&sortStart=asc&take=${PAGE_SIZE}&afterStart=${encodeURIComponent(after)}`;
}

export function bookingUrl(uid: string): string {
  return `${BOOKING_PAGE}${encodeURIComponent(uid)}`;
}
