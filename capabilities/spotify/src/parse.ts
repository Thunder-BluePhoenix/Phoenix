// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the player says is untrusted text: clipped, typed, and never used as an instruction.
import { httpsUrl, int, str } from "@phoenix/service-kit";
import { PlayerError } from "./errors";
import { FIELD_SEPARATOR } from "./scripts";

export type PlayState = "playing" | "paused" | "stopped" | "not_running";

/** What `now_playing` returns. Spotify has no "repeat one": repeat is `off` or `all`. */
export interface NowPlaying {
  running: boolean;
  state: PlayState;
  title?: string;
  artist?: string;
  album?: string;
  position_s?: number;
  duration_s?: number;
  /** 0-100 */
  volume?: number;
  shuffle?: boolean;
  repeat?: "off" | "all";
  /** https URL of the cover on Spotify's CDN, as the app reports it. */
  cover_url?: string;
  /** The cover itself as an inline image (data: URI), when it could be fetched safely. */
  cover?: string;
}

const MAX_TEXT = 200;
const MAX_URL = 512;

// `player state as text` reads "playing", but some Spotify versions answer the four-letter code.
const STATES: Readonly<Record<string, PlayState>> = {
  playing: "playing",
  kPSP: "playing",
  paused: "paused",
  kPSp: "paused",
  stopped: "stopped",
  kPSS: "stopped",
};

function playState(raw: string): PlayState {
  const trimmed = raw.trim();
  const key = Object.hasOwn(STATES, trimmed)
    ? trimmed
    : Object.keys(STATES).find((k) => k.startsWith("k") && trimmed.endsWith(`${k}»`));
  return key !== undefined ? STATES[key]! : "stopped";
}

function flag(raw: string | undefined): boolean | undefined {
  return raw === "true" ? true : raw === "false" ? false : undefined;
}

/** Whole non-negative number, or undefined for the script's -1 "unknown" marker. */
function known(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^-?\d{1,9}$/.test(raw)) return undefined;
  const n = int(Number(raw));
  return n === undefined || n < 0 ? undefined : n;
}

/** Output of NOW_PLAYING_SCRIPT, or "not_running". */
export function parseNowPlaying(output: string): NowPlaying {
  if (output === "not_running") return { running: false, state: "not_running" };
  const f = output.split(FIELD_SEPARATOR);
  if (f.length !== 10) throw new PlayerError("player", "Spotify sent an unexpected answer");
  const state = playState(f[0]!);
  const duration = known(f[4]);
  const volume = known(f[6]);
  const title = str(f[1], MAX_TEXT);
  const artist = str(f[2], MAX_TEXT);
  const album = str(f[3], MAX_TEXT);
  const position = known(f[5]);
  const shuffle = flag(f[7]);
  const repeating = flag(f[8]);
  const cover = (f[9] ?? "").length <= MAX_URL ? httpsUrl(f[9]) : undefined;
  return {
    running: true,
    state,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(position !== undefined ? { position_s: position } : {}),
    // Spotify reports the length in milliseconds.
    ...(duration !== undefined ? { duration_s: Math.round(duration / 1000) } : {}),
    ...(volume !== undefined ? { volume: Math.min(volume, 100) } : {}),
    ...(shuffle !== undefined ? { shuffle } : {}),
    ...(repeating !== undefined ? { repeat: repeating ? ("all" as const) : ("off" as const) } : {}),
    ...(cover ? { cover_url: cover } : {}),
  };
}
