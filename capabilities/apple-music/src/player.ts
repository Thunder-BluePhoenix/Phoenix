// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The control surface: validated input in, one fixed script out. Nothing here builds script text.
import { PlayerError } from "./errors";
import type { OsaRunner } from "./osascript";
import { parseNowPlaying, type NowPlaying } from "./parse";
import {
  NEXT_SCRIPT,
  NOW_PLAYING_SCRIPT,
  PLAY_PAUSE_SCRIPT,
  PREVIOUS_SCRIPT,
  REPEAT_SCRIPT,
  SEEK_SCRIPT,
  SHUFFLE_SCRIPT,
  VOLUME_SCRIPT,
} from "./scripts";

export const MAX_SEEK_S = 86_400;

/** A whole number in [min, max]; anything else (strings, floats, NaN, out of range) is refused. */
export function boundedInt(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new PlayerError("invalid", `${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function field(input: unknown, name: string): unknown {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)[name]
    : undefined;
}

interface Control {
  script: string;
  /** The `argv` for the script, from validated input. Values only, never script text. */
  args(input: unknown): string[];
}

const NO_ARGS = () => [];

/** Every command that changes the player, by name. */
export const CONTROLS: Readonly<Record<string, Control>> = {
  play_pause: { script: PLAY_PAUSE_SCRIPT, args: NO_ARGS },
  next: { script: NEXT_SCRIPT, args: NO_ARGS },
  previous: { script: PREVIOUS_SCRIPT, args: NO_ARGS },
  seek: {
    script: SEEK_SCRIPT,
    args: (input) => [String(boundedInt(field(input, "position_s"), "position_s", 0, MAX_SEEK_S))],
  },
  set_volume: {
    script: VOLUME_SCRIPT,
    args: (input) => [String(boundedInt(field(input, "volume"), "volume", 0, 100))],
  },
  set_shuffle: {
    script: SHUFFLE_SCRIPT,
    args(input) {
      const enabled = field(input, "enabled");
      if (typeof enabled !== "boolean") {
        throw new PlayerError("invalid", "enabled must be true or false");
      }
      return [String(enabled)];
    },
  },
  set_repeat: {
    script: REPEAT_SCRIPT,
    args(input) {
      const mode = field(input, "mode");
      if (mode !== "off" && mode !== "one" && mode !== "all") {
        throw new PlayerError("invalid", 'mode must be "off", "one" or "all"');
      }
      return [mode];
    },
  },
};

function requireMac(platform: NodeJS.Platform): void {
  if (platform !== "darwin") {
    throw new PlayerError("unsupported", "Apple Music control works on macOS only");
  }
}

export async function readNowPlaying(
  run: OsaRunner,
  platform: NodeJS.Platform,
): Promise<NowPlaying> {
  requireMac(platform);
  return parseNowPlaying(await run(NOW_PLAYING_SCRIPT, []));
}

/** Runs one control command. A closed app is reported ("not running"), never launched. */
export async function runControl(
  run: OsaRunner,
  platform: NodeJS.Platform,
  command: string,
  input: unknown,
): Promise<void> {
  requireMac(platform);
  const control = Object.hasOwn(CONTROLS, command) ? CONTROLS[command] : undefined;
  if (!control) throw new PlayerError("invalid", "Unknown control");
  const args = control.args(input);
  const out = await run(control.script, args);
  if (out === "not_running") throw new PlayerError("not_running", "Apple Music is not running");
  if (out !== "ok") throw new PlayerError("player", "Apple Music sent an unexpected answer");
}
