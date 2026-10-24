// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What a player says is untrusted text: clipped, typed, and never used as an instruction.
import { int, str } from "@phoenix/service-kit";
import { PlayerError } from "./errors";

export type PlayState = "playing" | "paused" | "stopped" | "not_running";

/** What `now_playing` returns: the same shape as the Spotify and Apple Music capabilities. */
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
  repeat?: "off" | "one" | "all";
}

/** ASCII unit separator: between fields of FORMAT's output. Control characters are cleaned from text. */
export const FIELD_SEPARATOR = "\u001f";

/**
 * The `--format` template for `playerctl metadata`, a constant with no input in it. Fields, in
 * order: status, title, artist, album, length (microseconds), position (microseconds), volume (0-1),
 * shuffle, loop (None|Track|Playlist).
 */
export const METADATA_FORMAT = [
  "{{ status }}",
  "{{ title }}",
  "{{ artist }}",
  "{{ album }}",
  "{{ mpris:length }}",
  "{{ position }}",
  "{{ volume }}",
  "{{ shuffle }}",
  "{{ loop }}",
].join(FIELD_SEPARATOR);

const MAX_TEXT = 200;

const STATES: Readonly<Record<string, PlayState>> = {
  playing: "playing",
  paused: "paused",
  stopped: "stopped",
};

/** `playerctl status` text: Playing, Paused or Stopped (anything else reads as stopped). */
export function playState(raw: string): PlayState {
  const key = raw.trim().toLowerCase();
  return Object.hasOwn(STATES, key) ? STATES[key]! : "stopped";
}

/** A whole number of microseconds as whole seconds; empty or malformed is undefined. */
function seconds(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,15}$/.test(raw)) return undefined;
  const n = int(Math.floor(Number(raw) / 1_000_000));
  return n === undefined ? undefined : n;
}

/** MPRIS volume is 0.0 to 1.0 (some players report more); 0 to 100, clamped. */
function percent(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,3}(\.\d{1,12})?$/.test(raw)) return undefined;
  return Math.min(100, Math.round(Number(raw) * 100));
}

function flag(raw: string | undefined): boolean | undefined {
  const key = raw?.trim().toLowerCase();
  return key === "true" || key === "on"
    ? true
    : key === "false" || key === "off"
      ? false
      : undefined;
}

const REPEATS: Readonly<Record<string, "off" | "one" | "all">> = {
  none: "off",
  track: "one",
  playlist: "all",
};

function repeat(raw: string | undefined): "off" | "one" | "all" | undefined {
  const key = raw?.trim().toLowerCase();
  return key !== undefined && Object.hasOwn(REPEATS, key) ? REPEATS[key] : undefined;
}

/** Output of `playerctl metadata --format=METADATA_FORMAT`. */
export function parseNowPlaying(output: string): NowPlaying {
  const f = output.split(FIELD_SEPARATOR);
  if (f.length !== 9) throw new PlayerError("player", "The player sent an unexpected answer");
  const title = str(f[1], MAX_TEXT);
  const artist = str(f[2], MAX_TEXT);
  const album = str(f[3], MAX_TEXT);
  const duration = seconds(f[4]);
  const position = seconds(f[5]);
  const volume = percent(f[6]?.trim());
  const shuffle = flag(f[7]);
  const loop = repeat(f[8]);
  return {
    running: true,
    state: playState(f[0]!),
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(position !== undefined ? { position_s: position } : {}),
    ...(duration !== undefined ? { duration_s: duration } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(shuffle !== undefined ? { shuffle } : {}),
    ...(loop !== undefined ? { repeat: loop } : {}),
  };
}
