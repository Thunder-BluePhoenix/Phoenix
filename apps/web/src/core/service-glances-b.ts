// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the Resend, Notion and Cal.com `status` commands return, reduced to the few fields a glance
// may show. Everything is checked field by field; anything unexpected is dropped, never rendered.
// Privacy is decided HERE, before a component sees the data: Resend subjects and recipient domains,
// and Cal.com booking titles and attendee details, are not copied out of the raw result at all.
import { intlLocale, type ActiveLocale } from "../i18n/supported";
import type { MessageKey } from "../i18n/en";
import { safeHttpsUrl } from "./format";
import { cleanText, isoTime, rawStatus } from "./service-glances";

/** A title is clipped to this many characters on screen. */
export const TITLE_CHARS = 80;
/** Bookings listed before "N more". */
export const BOOKINGS_SHOWN = 5;

// ---- Resend -------------------------------------------------------------------------------

export type ResendBucket =
  "delivered" | "inFlight" | "delayed" | "bounced" | "complained" | "failed" | "other";

/** Display order: the outcomes that need attention come after the good news. */
export const RESEND_BUCKETS: readonly ResendBucket[] = [
  "delivered",
  "inFlight",
  "delayed",
  "bounced",
  "complained",
  "failed",
  "other",
];

export const RESEND_BUCKET_TEXT: Record<ResendBucket, MessageKey> = {
  delivered: "services.glance.resend.state.delivered",
  inFlight: "services.glance.resend.state.inFlight",
  delayed: "services.glance.resend.state.delayed",
  bounced: "services.glance.resend.state.bounced",
  complained: "services.glance.resend.state.complained",
  failed: "services.glance.resend.state.failed",
  other: "services.glance.resend.state.other",
};

/** Resend's `last_event` words. Opens and clicks only happen after delivery. */
const RESEND_STATES: Readonly<Record<string, ResendBucket>> = {
  delivered: "delivered",
  opened: "delivered",
  clicked: "delivered",
  sent: "inFlight",
  queued: "inFlight",
  scheduled: "inFlight",
  delivery_delayed: "delayed",
  bounced: "bounced",
  complained: "complained",
  failed: "failed",
};

export interface ResendGlanceData {
  configured: boolean;
  total: number;
  counts: Record<ResendBucket, number>;
  /** ISO time of the newest email, if any. */
  newest?: string;
}

/** Counts per delivery state. Subjects, recipients and links in the result are never read. */
export function parseResendGlance(raw: unknown): ResendGlanceData | null {
  const status = rawStatus(raw);
  if (status === null) return null;
  const counts: Record<ResendBucket, number> = {
    delivered: 0,
    inFlight: 0,
    delayed: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    other: 0,
  };
  let newest: string | undefined;
  for (const item of status.items) {
    const state = typeof item.state === "string" ? item.state : "";
    const bucket = Object.hasOwn(RESEND_STATES, state) ? RESEND_STATES[state]! : "other";
    counts[bucket]++;
    const at = isoTime(item.at);
    if (at !== undefined && (newest === undefined || Date.parse(at) > Date.parse(newest))) {
      newest = at;
    }
  }
  return {
    configured: status.configured,
    total: status.items.length,
    counts,
    ...(newest ? { newest } : {}),
  };
}

// ---- Notion -------------------------------------------------------------------------------

export type NotionKind = "page" | "database" | "archived";

export interface NotionGlanceItem {
  id: string;
  /** Cleaned and clipped, or undefined when the object has no usable title. */
  title?: string;
  kind: NotionKind;
  at?: string;
  /** Only ever a Notion address (https, notion.so / notion.site). */
  url?: string;
}

export interface NotionGlanceData {
  configured: boolean;
  items: NotionGlanceItem[];
}

const NOTION_HOST = /^(?:[a-z0-9-]+\.)*notion\.(?:so|site)$/i;

/** An https link to Notion itself; anything else stays unlinked. */
export function notionLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const href = safeHttpsUrl(value);
  if (href === null) return undefined;
  return NOTION_HOST.test(new URL(href).hostname) ? href : undefined;
}

/** The watched pages and databases: title (cleaned, clipped), kind and edit time. */
export function parseNotionGlance(raw: unknown): NotionGlanceData | null {
  const status = rawStatus(raw);
  if (status === null) return null;
  const items: NotionGlanceItem[] = [];
  for (const item of status.items) {
    const kind: NotionKind =
      item.state === "database" || item.state === "archived" ? item.state : "page";
    const id = typeof item.id === "string" ? item.id.slice(0, 100) : "";
    if (id === "") continue;
    const title = cleanText(item.title, TITLE_CHARS);
    const at = isoTime(item.at);
    const url = notionLink(item.url);
    items.push({
      id,
      kind,
      ...(title ? { title } : {}),
      ...(at ? { at } : {}),
      ...(url ? { url } : {}),
    });
  }
  items.sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0);
  return { configured: status.configured, items };
}

// ---- Cal.com ------------------------------------------------------------------------------

export type CalStatus = "accepted" | "pending" | "other";

export const CAL_STATUS_TEXT: Record<CalStatus, MessageKey> = {
  accepted: "services.glance.calcom.status.accepted",
  pending: "services.glance.calcom.status.pending",
  other: "services.glance.calcom.status.other",
};

export interface CalBooking {
  id: string;
  status: CalStatus;
  /** ISO start time. */
  start: string;
  /** How many people booked; the people themselves are not part of the result. */
  attendees?: number;
}

export interface CalGlanceData {
  configured: boolean;
  bookings: CalBooking[];
}

const ATTENDEES = /^(\d{1,4}) attendees?$/;

/**
 * Upcoming bookings: start time, status and the attendee count. The booking title is NOT copied:
 * Cal.com's default titles name the people who booked ("30 min between A and B"), and the
 * capability does not return the event type separately.
 */
export function parseCalGlance(raw: unknown): CalGlanceData | null {
  const status = rawStatus(raw);
  if (status === null) return null;
  const bookings: CalBooking[] = [];
  for (const item of status.items) {
    const start = isoTime(item.at);
    const id = typeof item.id === "string" ? item.id.slice(0, 100) : "";
    if (start === undefined || id === "") continue;
    // Cancelled and rejected bookings are not upcoming.
    if (item.state === "cancelled" || item.state === "rejected") continue;
    const match = typeof item.detail === "string" ? ATTENDEES.exec(item.detail) : null;
    bookings.push({
      id,
      start,
      status: item.state === "accepted" || item.state === "pending" ? item.state : "other",
      ...(match ? { attendees: Number(match[1]) } : {}),
    });
  }
  bookings.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { configured: status.configured, bookings };
}

/** "Oct 24, 2026, 2:30 PM" in the language on screen; "" for a bad date. */
export function formatDateTime(iso: string, locale: ActiveLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
