// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for the osascript runner. It never starts a process, so a test can never touch a
// real player. It records every (script, args) call and answers by script constant.
import {
  COVER_SCRIPT,
  FIELD_SEPARATOR,
  NEXT_SCRIPT,
  PlayerError,
  NOW_PLAYING_SCRIPT,
  PLAY_PAUSE_SCRIPT,
  PREVIOUS_SCRIPT,
  REPEAT_SCRIPT,
  SEEK_SCRIPT,
  SHUFFLE_SCRIPT,
  VOLUME_SCRIPT,
  type OsaLimits,
  type OsaRunner,
} from "../src";

/** How `osascript` prints raw data (artwork): `«data tdta<hex>»`. */
export function dataLiteral(bytes: Uint8Array): string {
  return `«data tdta${Buffer.from(bytes).toString("hex").toUpperCase()}»`;
}

export interface FakeTrack {
  state: string;
  title: string;
  artist: string;
  album: string;
  durationS: number;
  positionS: number;
  volume: number;
  shuffling: boolean;
  repeat: string;
}

export interface RecordedRun {
  script: string;
  args: readonly string[];
}

export interface FakePlayer {
  run: OsaRunner;
  calls: RecordedRun[];
  /** False = the app is closed: every script answers "not_running". */
  running: boolean;
  track: FakeTrack;
  /**
   * What COVER_SCRIPT answers, verbatim (default "none"). Use `dataLiteral(bytes)` for the
   * `«data tdta<hex>»` form `osascript` prints for artwork.
   */
  coverOutput: string;
  /** The limits the capability passed with the last COVER_SCRIPT run. */
  coverLimits?: OsaLimits;
  /** When set, every COVER_SCRIPT run rejects with it. */
  coverFailWith?: Error;
  /** When set to a promise, COVER_SCRIPT waits for it before answering (a hung player). */
  coverGate?: Promise<void>;
  /** When set, the next run rejects with it. */
  failWith?: Error;
}

export function fakePlayer(track: Partial<FakeTrack> = {}): FakePlayer {
  const player: FakePlayer = {
    calls: [],
    running: true,
    coverOutput: "none",
    track: {
      state: "playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      durationS: 215,
      positionS: 30,
      volume: 60,
      shuffling: false,
      repeat: "off",
      ...track,
    },
    run: async (script, args, limits) => {
      player.calls.push({ script, args });
      if (player.failWith) {
        const err = player.failWith;
        player.failWith = undefined;
        throw err;
      }
      if (!player.running) return "not_running";
      if (script === COVER_SCRIPT) {
        player.coverLimits = limits;
        await player.coverGate;
        if (player.coverFailWith) throw player.coverFailWith;
        // Like the real runner: an answer over the cap is refused, not truncated.
        if (Buffer.byteLength(player.coverOutput) > (limits?.maxOutputBytes ?? 256 * 1024)) {
          throw new PlayerError("too_large", "The player's answer was too large");
        }
        return player.coverOutput;
      }
      const t = player.track;
      const controls = new Map<string, () => void>([
        [PLAY_PAUSE_SCRIPT, () => (t.state = t.state === "playing" ? "paused" : "playing")],
        [NEXT_SCRIPT, () => undefined],
        [PREVIOUS_SCRIPT, () => undefined],
        [SEEK_SCRIPT, () => (t.positionS = Number(args[0]))],
        [VOLUME_SCRIPT, () => (t.volume = Number(args[0]))],
        [SHUFFLE_SCRIPT, () => (t.shuffling = args[0] === "true")],
        [REPEAT_SCRIPT, () => (t.repeat = args[0] ?? "off")],
      ]);
      if (script === NOW_PLAYING_SCRIPT) {
        return [
          t.state,
          t.title,
          t.artist,
          t.album,
          t.durationS,
          t.positionS,
          t.volume,
          t.shuffling,
          t.repeat,
        ].join(FIELD_SEPARATOR);
      }
      const action = controls.get(script);
      if (!action) throw new Error("fake player: unknown script");
      action();
      return "ok";
    },
  };
  return player;
}
