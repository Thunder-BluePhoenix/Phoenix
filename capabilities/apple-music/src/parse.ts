// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the player says is untrusted text: clipped, typed, and never used as an instruction.
import { int, str } from "@phoenix/service-kit";
import { PlayerError } from "./errors";
import { FIELD_SEPARATOR } from "./scripts";

export type PlayState = "playing" | "paused" | "stopped" | "not_running";
export type RepeatMode = "off" | "one" | "all";

/** What `now_playing` returns. No cover: Music exposes artwork only as raw data (README). */
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
  repeat?: RepeatMode;
}

const MAX_TEXT = 200;

// AppleScript coerces an enumeration to text as its name, or as its four-letter code when the
// name is not available to the script: both are accepted.
const STATES: Readonly<Record<string, PlayState>> = {
  playing: "playing",
  kPSP: "playing",
  paused: "paused",
  kPSp: "paused",
  stopped: "stopped",
  kPSS: "stopped",
};

const REPEATS: Readonly<Record<string, RepeatMode>> = {
  off: "off",
  kRpO: "off",
  one: "one",
  kRp1: "one",
  all: "all",
  kRpA: "all",
};

/** The first known word or code inside `raw` (the unquoted `«constant ****kPSP»` form). */
function enumKey(
  table: Readonly<Record<string, unknown>>,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (Object.hasOwn(table, trimmed)) return trimmed;
  return Object.keys(table).find((k) => k.startsWith("k") && trimmed.endsWith(`${k}»`));
}

function lookup<T>(table: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
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
  if (f.length !== 9) throw new PlayerError("player", "Apple Music sent an unexpected answer");
  const title = str(f[1], MAX_TEXT);
  const artist = str(f[2], MAX_TEXT);
  const album = str(f[3], MAX_TEXT);
  const duration = known(f[4]);
  const position = known(f[5]);
  const volume = known(f[6]);
  const shuffle = flag(f[7]);
  const repeat = lookup(REPEATS, enumKey(REPEATS, f[8]));
  return {
    running: true,
    state: lookup(STATES, enumKey(STATES, f[0])) ?? "stopped",
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(position !== undefined ? { position_s: position } : {}),
    ...(duration !== undefined ? { duration_s: duration } : {}),
    ...(volume !== undefined ? { volume: Math.min(volume, 100) } : {}),
    ...(shuffle !== undefined ? { shuffle } : {}),
    ...(repeat ? { repeat } : {}),
  };
}
