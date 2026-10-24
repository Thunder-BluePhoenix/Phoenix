// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for the `playerctl` runner. It never starts a process, so a test can never touch a real
// player or the session bus. It records every argument list and answers the way playerctl's documented
// commands do. It was written from playerctl's README and source, not from a run of the real tool.
import {
  FIELD_SEPARATOR,
  METADATA_FORMAT,
  PlayerError,
  type PlayerctlRunner,
  type RunLimits,
} from "../src";

export interface FakeTrack {
  /** As playerctl prints it: Playing, Paused or Stopped. */
  status: string;
  title: string;
  artist: string;
  album: string;
  lengthUs: number | string;
  positionUs: number | string;
  /** 0.0-1.0 */
  volume: number | string;
  shuffle: string;
  /** None, Track or Playlist */
  loop: string;
}

export interface RecordedRun {
  args: readonly string[];
  limits: RunLimits | undefined;
}

export interface FakePlayerctl {
  run: PlayerctlRunner;
  calls: RecordedRun[];
  /** Player instance names `--list-all` prints, one per line. Empty = no player. */
  players: string[];
  /** Raw text `--list-all` prints instead of `players`, when set (hostile bus names). */
  listOutput?: string;
  track: FakeTrack;
  /** When true, `metadata` prints nothing (a player with no current track). */
  noTrack: boolean;
  /** When set, the next run rejects with it. */
  failWith?: Error;
  /** The control arguments (everything after `--player=`) of every command that changed the player. */
  controls: string[][];
}

export function fakePlayerctl(track: Partial<FakeTrack> = {}): FakePlayerctl {
  const fake: FakePlayerctl = {
    calls: [],
    controls: [],
    players: ["spotify"],
    noTrack: false,
    track: {
      status: "Playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      lengthUs: 215_000_000,
      positionUs: 30_000_000,
      volume: 0.6,
      shuffle: "false",
      loop: "None",
      ...track,
    },
    run: async (args, limits) => {
      fake.calls.push({ args, limits });
      if (fake.failWith) {
        const err = fake.failWith;
        fake.failWith = undefined;
        throw err;
      }
      const rest = args.filter((a) => !a.startsWith("--player="));
      const selected = args.find((a) => a.startsWith("--player="))?.slice("--player=".length);
      if (rest[0] === "--list-all") return fake.listOutput ?? fake.players.join("\n");
      const live = selected
        ? fake.players.some((p) => p === selected || p.startsWith(`${selected}.`))
        : fake.players.length > 0;
      if (!live) throw new PlayerError("player", "The player did not answer");
      const t = fake.track;
      const [command, value] = rest;
      // Like the real runner: an answer over the cap is refused, not truncated.
      const answer = (text: string): string => {
        if (Buffer.byteLength(text) > (limits?.maxOutputBytes ?? 64 * 1024)) {
          throw new PlayerError("too_large", "The player's answer was too large");
        }
        return text;
      };
      if (command === "metadata") {
        if (rest[1] !== `--format=${METADATA_FORMAT}`) throw new Error("fake playerctl: format");
        if (fake.noTrack) return "";
        return answer(
          [
            t.status,
            t.title,
            t.artist,
            t.album,
            t.lengthUs,
            t.positionUs,
            t.volume,
            t.shuffle,
            t.loop,
          ].join(FIELD_SEPARATOR),
        );
      }
      if (command === "status") return answer(t.status);
      fake.controls.push(rest);
      if (command === "play-pause") t.status = t.status === "Playing" ? "Paused" : "Playing";
      else if (command === "next" || command === "previous") return "";
      else if (command === "position") t.positionUs = Number(value) * 1_000_000;
      else if (command === "volume") t.volume = Number(value);
      else if (command === "shuffle") t.shuffle = value === "On" ? "true" : "false";
      else if (command === "loop") t.loop = value ?? "None";
      else throw new Error(`fake playerctl: unknown command ${String(command)}`);
      return "";
    },
  };
  return fake;
}
