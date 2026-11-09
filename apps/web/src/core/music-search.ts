// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 94: what the page does with "play <query> on <service>" (typed in the command box, or the
// `music_search` action Core attaches to a spoken request). It is re-checked HERE whatever its
// source: a service from the allow-list, a bounded query without control or bidirectional
// characters, and the search address rebuilt locally. Nothing is opened, fetched or played.
import {
  MAX_PLAY_QUERY_CHARS,
  routePlayRequest,
  routeSearch,
  type PlayRoute,
  type PlayRouteRefusal,
} from "../../../../capabilities/youtube-music/src/index";
import type { MessageKey } from "../i18n";

export { MAX_PLAY_QUERY_CHARS, routeSearch };
export type { PlayRoute, PlayRouteRefusal };

/** The command box text, routed; `null` when the text is not shaped like a play request at all. */
export function routeCommandText(text: string): PlayRoute | null {
  const route = routePlayRequest(text);
  return !route.ok && route.reason === "not_play_request" ? null : route;
}

export const REFUSAL_TEXT: Record<Exclude<PlayRouteRefusal, "not_play_request">, MessageKey> = {
  unknown_service: "musicPlay.refused.unknown_service",
  empty_query: "musicPlay.refused.empty_query",
  too_long: "musicPlay.refused.too_long",
  bad_characters: "musicPlay.refused.bad_characters",
};

export const SERVICE_NAME = {
  youtube: "browserProfiles.music.site.youtube",
  soundcloud: "browserProfiles.music.site.soundcloud",
  bandcamp: "browserProfiles.music.site.bandcamp",
} as const satisfies Record<string, MessageKey>;

/** The route Core's `POST /api/music/connectors/:site/search` answer must match, or it is not used. */
export function sameAddress(route: Extract<PlayRoute, { ok: true }>, answer: unknown): boolean {
  return typeof answer === "string" && answer === route.url;
}
