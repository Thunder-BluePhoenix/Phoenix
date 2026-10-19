// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { formatNumber } from "./format";

/** The media capabilities with a Now playing glance, in the order they are shown. */
export const MEDIA_SERVICES = [
  { id: "spotify", name: "Spotify" },
  { id: "apple-music", name: "Apple Music" },
] as const;

export type MediaServiceId = (typeof MEDIA_SERVICES)[number]["id"];
export type MediaState = "playing" | "paused" | "stopped" | "not_running";
export type MediaRepeat = "off" | "one" | "all";

/** What a media capability's `now_playing` command reports, after `readNowPlaying`. */
export interface NowPlaying {
  running: boolean;
  state: MediaState;
  title?: string;
  artist?: string;
  album?: string;
  position_s?: number;
  duration_s?: number;
  /** 0-100 */
  volume?: number;
  shuffle?: boolean;
  repeat?: MediaRepeat;
  /** Only ever a `data:image/(jpeg|png|webp);base64,` URI, see `validCover`. */
  cover?: string;
}

/** The page's CSP is `img-src 'self' data:`; a cover is shown only when it is such an inline image. */
const COVER = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const MAX_COVER_CHARS = 600_000;

/** The cover URI when it is a small inline raster image, else undefined (URLs, SVG, script: all dropped). */
export function validCover(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_COVER_CHARS) return undefined;
  return COVER.test(value) ? value : undefined;
}

/** "3:05", "1:02:03". Unknown or negative times read "0:00". */
export function formatClock(seconds: number | undefined): string {
  const total =
    seconds === undefined || !Number.isFinite(seconds) || seconds < 0 ? 0 : Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const two = (n: number) => formatNumber(n, undefined, { minimumIntegerDigits: 2 });
  const s = two(total % 60);
  return h > 0 ? `${formatNumber(h)}:${two(m)}:${s}` : `${formatNumber(m)}:${s}`;
}

/**
 * What the repeat button asks for next. Spotify only distinguishes off and all; Apple Music cycles
 * off → all → one → off.
 */
export function nextRepeat(current: MediaRepeat, service: MediaServiceId): MediaRepeat {
  if (service === "spotify") return current === "off" ? "all" : "off";
  if (current === "off") return "all";
  return current === "all" ? "one" : "off";
}

const STATES: Record<MediaState, true> = {
  playing: true,
  paused: true,
  stopped: true,
  not_running: true,
};
const REPEATS: Record<MediaRepeat, true> = { off: true, one: true, all: true };

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

/** A `now_playing` result checked field by field; anything unexpected is dropped, never rendered. */
export function readNowPlaying(raw: unknown): NowPlaying | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== "string" || !Object.hasOwn(STATES, r.state)) return null;
  const volume = count(r.volume);
  return {
    running: r.running === true,
    state: r.state as MediaState,
    title: text(r.title),
    artist: text(r.artist),
    album: text(r.album),
    position_s: count(r.position_s),
    duration_s: count(r.duration_s),
    volume: volume === undefined ? undefined : Math.min(100, volume),
    shuffle: typeof r.shuffle === "boolean" ? r.shuffle : undefined,
    repeat:
      typeof r.repeat === "string" && Object.hasOwn(REPEATS, r.repeat)
        ? (r.repeat as MediaRepeat)
        : undefined,
    cover: validCover(r.cover),
  };
}
