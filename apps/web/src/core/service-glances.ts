// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What every service capability's read-only `status` command returns (sdk/service-kit ServiceStatus),
// checked field by field before a glance sees it. The text is from another system: it is cleaned and
// clipped here, and a component renders it as text only. Anything unexpected is dropped, never shown.

/** How often a visible glance asks the capability again. Bounded: never faster than this. */
export const GLANCE_REFRESH_MS = 60_000;
/** A glance lists at most this many items (the capabilities send 10 or fewer). */
export const MAX_GLANCE_ITEMS = 25;

// Control characters, line/paragraph separators and the bidirectional overrides and isolates that
// can reorder surrounding text (U+202A–202E, U+2066–2069, U+200E/F, U+061C).
const UNSAFE = /[\p{C}\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/gu;

/** A short single-line text: unsafe characters removed, whitespace collapsed, clipped with "…". */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Bound the work first: a hostile value may be megabytes long.
  const text = value
    .slice(0, max * 8)
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return undefined;
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

const MAX_URL_CHARS = 300;

/** The address when it is a plain https URL without credentials (as the browser parses it), else undefined. */
export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_URL_CHARS || /[\s\p{C}]/u.test(value)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname === "") {
    return undefined;
  }
  return url.href;
}

/** An ISO-looking time that parses, else undefined. */
export function isoTime(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

export interface GlanceItem {
  id: string;
  title: string;
  /** Lower-case state word, cleaned. */
  state: string;
  detail?: string;
  /** https only. */
  url?: string;
  at?: string;
}

export interface ServiceStatusView {
  configured: boolean;
  items: GlanceItem[];
}

/** A raw `status` result: its object, `configured` and the raw items; null when the shape is wrong. */
export function rawStatus(raw: unknown): {
  configured: boolean;
  items: Record<string, unknown>[];
  record: Record<string, unknown>;
} | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.configured !== "boolean" || !Array.isArray(record.items)) return null;
  const items = record.items
    .slice(0, MAX_GLANCE_ITEMS)
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null);
  return { configured: record.configured, items, record };
}

/** One `ServiceItem`, or null when it has no usable id or title. */
export function readItem(raw: Record<string, unknown>): GlanceItem | null {
  const id = cleanText(raw.id, 100);
  const title = cleanText(raw.title, 80);
  if (id === undefined || title === undefined) return null;
  const detail = cleanText(raw.detail, 120);
  const url = httpsUrl(raw.url);
  const at = isoTime(raw.at);
  return {
    id,
    title,
    state: (cleanText(raw.state, 30) ?? "unknown").toLowerCase(),
    ...(detail === undefined ? {} : { detail }),
    ...(url === undefined ? {} : { url }),
    ...(at === undefined ? {} : { at }),
  };
}

/** The generic `status` result; null when it is not one. */
export function parseServiceStatus(raw: unknown): ServiceStatusView | null {
  const status = rawStatus(raw);
  if (status === null) return null;
  const items: GlanceItem[] = [];
  for (const entry of status.items) {
    const item = readItem(entry);
    if (item !== null) items.push(item);
  }
  return { configured: status.configured, items };
}
