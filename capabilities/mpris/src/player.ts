// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The control surface: validated input in, one fixed `playerctl` argument list out. Nothing a player
// reports and nothing a caller types is ever placed in an argument without passing through here.
import { PlayerError } from "./errors";
import { METADATA_FORMAT, parseNowPlaying, playState, type NowPlaying } from "./parse";
import type { PlayerctlRunner } from "./playerctl";

export const MAX_SEEK_S = 86_400;

/**
 * An MPRIS player name or instance as `playerctl --list-all` prints it (`spotify`, `vlc`,
 * `chromium.instance1234`). It must start with a letter or digit, so it can never look like an option,
 * and it has no `,` (a list), `%` (the `%any` wildcard), space, quote or control character.
 */
export const PLAYER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** The same rule as a JSON Schema pattern, for the command and config schemas. */
export const PLAYER_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$";

const MAX_PLAYERS = 64;
const LIST_LIMITS = { maxOutputBytes: 8 * 1024 };
const METADATA_LIMITS = { maxOutputBytes: 16 * 1024 };
const SMALL_LIMITS = { maxOutputBytes: 1024 };

/** The player to address, or undefined for "whichever playerctl finds first". Anything else throws. */
export function validPlayer(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !PLAYER_NAME.test(value)) {
    throw new PlayerError(
      "invalid",
      "player must be a player name such as spotify or vlc (letters, digits, . _ -)",
    );
  }
  return value;
}

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
  /** The `playerctl` arguments after `--player`, from validated input. Words and numbers only. */
  args(input: unknown): string[];
}

const LOOP_WORDS = { off: "None", one: "Track", all: "Playlist" } as const;

/** Every command that changes the player, by name. */
export const CONTROLS: Readonly<Record<string, Control>> = {
  play_pause: { args: () => ["play-pause"] },
  next: { args: () => ["next"] },
  previous: { args: () => ["previous"] },
  seek: {
    args: (input) => [
      "position",
      String(boundedInt(field(input, "position_s"), "position_s", 0, MAX_SEEK_S)),
    ],
  },
  set_volume: {
    // MPRIS volume is 0.0-1.0. A fixed two-decimal string: no sign, no exponent.
    args: (input) => [
      "volume",
      (boundedInt(field(input, "volume"), "volume", 0, 100) / 100).toFixed(2),
    ],
  },
  set_shuffle: {
    args(input) {
      const enabled = field(input, "enabled");
      if (typeof enabled !== "boolean") {
        throw new PlayerError("invalid", "enabled must be true or false");
      }
      return ["shuffle", enabled ? "On" : "Off"];
    },
  },
  set_repeat: {
    args(input) {
      const mode = field(input, "mode");
      if (typeof mode !== "string" || !Object.hasOwn(LOOP_WORDS, mode)) {
        throw new PlayerError("invalid", 'mode must be "off", "one" or "all"');
      }
      return ["loop", LOOP_WORDS[mode as keyof typeof LOOP_WORDS]];
    },
  },
};

function requireLinux(platform: NodeJS.Platform): void {
  if (platform !== "linux") {
    throw new PlayerError("unsupported", "MPRIS media control works on Linux only");
  }
}

/** `--player=NAME` (one argument, so a name can never be read as a separate option), or nothing. */
function target(player: string | undefined): string[] {
  return player === undefined ? [] : [`--player=${player}`];
}

/** Is a matching player on the session bus? Phoenix never starts one. */
async function isRunning(run: PlayerctlRunner, player: string | undefined): Promise<boolean> {
  const names = (await run(["--list-all"], LIST_LIMITS))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, MAX_PLAYERS)
    // Only well-formed names count: a hostile bus name is not evidence of anything.
    .filter((line) => PLAYER_NAME.test(line));
  if (player === undefined) return names.length > 0;
  return names.some((name) => name === player || name.startsWith(`${player}.`));
}

export async function readNowPlaying(
  run: PlayerctlRunner,
  platform: NodeJS.Platform,
  player?: string,
): Promise<NowPlaying> {
  requireLinux(platform);
  const name = validPlayer(player);
  if (!(await isRunning(run, name))) return { running: false, state: "not_running" };
  const out = await run(
    [...target(name), "metadata", `--format=${METADATA_FORMAT}`],
    METADATA_LIMITS,
  );
  if (out !== "") return parseNowPlaying(out);
  // A player with no current track has no metadata: report its state alone.
  const status = await run([...target(name), "status"], SMALL_LIMITS);
  return { running: true, state: playState(status) };
}

/** Runs one control command. A missing player is reported ("not running"), never started. */
export async function runControl(
  run: PlayerctlRunner,
  platform: NodeJS.Platform,
  command: string,
  input: unknown,
  defaultPlayer?: string,
): Promise<void> {
  requireLinux(platform);
  const control = Object.hasOwn(CONTROLS, command) ? CONTROLS[command] : undefined;
  if (!control) throw new PlayerError("invalid", "Unknown control");
  const name = validPlayer(field(input, "player") ?? defaultPlayer);
  const args = control.args(input);
  if (!(await isRunning(run, name)))
    throw new PlayerError("not_running", "No media player is running");
  await run([...target(name), ...args], SMALL_LIMITS);
}
