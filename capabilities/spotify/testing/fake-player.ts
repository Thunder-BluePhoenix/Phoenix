// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for the osascript runner. It never starts a process, so a test can never touch a
// real player. It records every (script, args) call and answers by script constant.
import {
  FIELD_SEPARATOR,
  NEXT_SCRIPT,
  NOW_PLAYING_SCRIPT,
  PLAY_PAUSE_SCRIPT,
  PREVIOUS_SCRIPT,
  REPEAT_SCRIPT,
  SEEK_SCRIPT,
  SHUFFLE_SCRIPT,
  VOLUME_SCRIPT,
  type OsaRunner,
} from "../src";

export interface FakeTrack {
  state: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  positionS: number;
  volume: number;
  shuffling: boolean;
  repeating: boolean;
  artworkUrl: string;
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
  /** When set, the next run rejects with it. */
  failWith?: Error;
}

export function fakePlayer(track: Partial<FakeTrack> = {}): FakePlayer {
  const player: FakePlayer = {
    calls: [],
    running: true,
    track: {
      state: "playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      durationMs: 215_000,
      positionS: 30,
      volume: 60,
      shuffling: false,
      repeating: false,
      artworkUrl: "https://i.scdn.co/image/abc123",
      ...track,
    },
    run: async (script, args) => {
      player.calls.push({ script, args });
      if (player.failWith) {
        const err = player.failWith;
        player.failWith = undefined;
        throw err;
      }
      if (!player.running) return "not_running";
      const t = player.track;
      const controls = new Map<string, () => void>([
        [PLAY_PAUSE_SCRIPT, () => (t.state = t.state === "playing" ? "paused" : "playing")],
        [NEXT_SCRIPT, () => undefined],
        [PREVIOUS_SCRIPT, () => undefined],
        [SEEK_SCRIPT, () => (t.positionS = Number(args[0]))],
        [VOLUME_SCRIPT, () => (t.volume = Number(args[0]))],
        [SHUFFLE_SCRIPT, () => (t.shuffling = args[0] === "true")],
        [REPEAT_SCRIPT, () => (t.repeating = args[0] === "true")],
      ]);
      if (script === NOW_PLAYING_SCRIPT) {
        return [
          t.state,
          t.title,
          t.artist,
          t.album,
          t.durationMs,
          t.positionS,
          t.volume,
          t.shuffling,
          t.repeating,
          t.artworkUrl,
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
