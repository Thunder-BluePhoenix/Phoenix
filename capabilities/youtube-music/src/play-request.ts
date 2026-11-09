// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 94: "play <query> on <service>" typed in the command box or said to Fawkes becomes a SEARCH
// address for the named service and nothing more. Pure: no I/O, nothing is opened, fetched or
// played, and no result is ever picked. A person looks at the card that shows the service and the
// exact query, and only their own click opens the search page.
import { searchUrl, type Site } from "./index";

/** The services a request may name. Spotify Web has a search address but is not routable here. */
export const PLAY_SERVICES = ["soundcloud", "bandcamp", "youtube"] as const;
export type PlayService = (typeof PLAY_SERVICES)[number] & Site;

/**
 * Longest query. It is also the longest a person can read in full in the card and in the
 * confirmation Phoenix shows for a spoken request, so what is searched is all of what they saw.
 */
export const MAX_PLAY_QUERY_CHARS = 80;

export type PlayRouteRefusal =
  "not_play_request" | "unknown_service" | "empty_query" | "too_long" | "bad_characters";

export type PlayRoute =
  | { ok: true; service: PlayService; query: string; url: string }
  | { ok: false; reason: PlayRouteRefusal };

const REQUEST = /^(?:please\s+)?play\s+(.+?)\s+on\s+(\S+)$/iu;

/** Control, format (zero-width, bidi marks, embeddings, isolates) and line/paragraph separators. */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function isPlayService(value: unknown): value is PlayService {
  return typeof value === "string" && (PLAY_SERVICES as readonly string[]).includes(value);
}

/**
 * Checks a query as it will be searched and shown: 1 to {@link MAX_PLAY_QUERY_CHARS} characters
 * after trimming, with no control, bidirectional or other invisible format characters.
 */
export function checkPlayQuery(
  raw: string,
): { ok: true; query: string } | { ok: false; reason: PlayRouteRefusal } {
  if (FORBIDDEN.test(raw)) return { ok: false, reason: "bad_characters" };
  const query = raw.trim();
  if (query.length === 0) return { ok: false, reason: "empty_query" };
  if ([...query].length > MAX_PLAY_QUERY_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, query };
}

/** The route for an already-parsed service and query (what a spoken request carries), re-checked. */
export function routeSearch(service: unknown, rawQuery: unknown): PlayRoute {
  if (!isPlayService(service)) return { ok: false, reason: "unknown_service" };
  if (typeof rawQuery !== "string") return { ok: false, reason: "empty_query" };
  const checked = checkPlayQuery(rawQuery);
  if (!checked.ok) return checked;
  return { ok: true, service, query: checked.query, url: searchUrl(service, checked.query) };
}

/**
 * Routes request text ("play lo-fi beats on soundcloud") to a search. Text that is not shaped like
 * a play request is `not_play_request` so the caller can treat it as something else; text that is
 * but names a service outside the allow-list, or carries a bad query, is refused with the reason.
 */
export function routePlayRequest(text: string): PlayRoute {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length > 400) return { ok: false, reason: "too_long" };
  if (FORBIDDEN.test(trimmed) && /^(?:please\s+)?play\b/iu.test(trimmed))
    return { ok: false, reason: "bad_characters" };
  const match = REQUEST.exec(trimmed);
  if (!match) return { ok: false, reason: "not_play_request" };
  return routeSearch(match[2]!.toLowerCase(), match[1]);
}
