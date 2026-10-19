// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Player observations → spotify.track.* events. Pure: the poller passes what it saw before and
// what it sees now.
import type { NowPlaying } from "./parse";

export interface TrackEvent {
  event_type: "spotify.track.playing" | "spotify.track.paused";
  severity: "info";
  correlation_id: string;
  subject: string;
  data_classification: "internal";
  payload: Record<string, unknown>;
}

/** What the last observation was, to tell a change from a repeat. */
export interface Observed {
  playing: boolean;
  track: string;
}

export const NOTHING_OBSERVED: Observed = { playing: false, track: "" };

function trackKey(np: NowPlaying): string {
  return `${np.title ?? ""}\u0000${np.artist ?? ""}\u0000${np.album ?? ""}`;
}

function describe(np: NowPlaying): string {
  return [np.title, np.artist].filter(Boolean).join(" · ") || "Spotify";
}

function event(type: TrackEvent["event_type"], np: NowPlaying): TrackEvent {
  return {
    event_type: type,
    severity: "info",
    correlation_id: "spotify-playback",
    subject: describe(np),
    data_classification: "internal",
    payload: {
      ...(np.title ? { title: np.title } : {}),
      ...(np.artist ? { artist: np.artist } : {}),
      ...(np.album ? { album: np.album } : {}),
      ...(np.duration_s !== undefined ? { duration_s: np.duration_s } : {}),
    },
  };
}

/**
 * `track.playing` when playback starts or the track changes while playing; `track.paused` when
 * it stops being played (paused, stopped, or the app was closed). Nothing for a repeat of the same
 * observation, and nothing when it was not playing before and is not playing now.
 */
export function diffPlayback(
  before: Observed,
  now: NowPlaying,
): { events: TrackEvent[]; observed: Observed } {
  const playing = now.state === "playing";
  const track = trackKey(now);
  const observed: Observed = { playing, track: playing ? track : before.track };
  if (playing && (!before.playing || before.track !== track)) {
    return { events: [event("spotify.track.playing", now)], observed };
  }
  if (!playing && before.playing) {
    return { events: [event("spotify.track.paused", now)], observed };
  }
  return { events: [], observed };
}
