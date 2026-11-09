// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for "play <query> on <service>" (Phase 94): a search card, never playback. */
export const musicPlay = {
  "musicPlay.title": "Search for music",
  "musicPlay.body":
    "Phoenix does not play anything and does not pick a result. Open the search page and choose a result yourself.",
  "musicPlay.service": "Site: {service}",
  "musicPlay.query": "Search for: {query}",
  "musicPlay.open": "Open search page",
  "musicPlay.checking": "Checking that this site is allowed…",
  "musicPlay.off": "{service} is off. Turn it on in Settings, under music sites, then ask again.",
  "musicPlay.failed": "The search address could not be made.",
  "musicPlay.refused.unknown_service":
    "Only SoundCloud, Bandcamp and YouTube can be searched this way.",
  "musicPlay.refused.empty_query": "Say or type what to search for.",
  "musicPlay.refused.too_long": "That search is longer than {max} characters.",
  "musicPlay.refused.bad_characters": "That search has characters that are not allowed.",
} as const;
