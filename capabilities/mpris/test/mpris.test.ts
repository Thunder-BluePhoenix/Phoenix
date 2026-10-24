// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTROLS,
  FIELD_SEPARATOR,
  METADATA_FORMAT,
  NOTHING_OBSERVED,
  PLAYER_NAME,
  createMprisCapability,
  diffPlayback,
  parseNowPlaying,
  readNowPlaying,
  runControl,
  type NowPlaying,
} from "../src";
import { fakePlayerctl, type FakePlayerctl } from "../testing/fake-playerctl";

/** The poller's waits: each ends only when the test says so. */
class Clock {
  readonly sleeps: number[] = [];
  private pending: PromiseWithResolvers<void> | undefined;
  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    this.pending = wait;
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };
  async tick(): Promise<void> {
    const before = this.sleeps.length;
    this.pending?.resolve();
    await vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(before));
  }
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function ready(
  player: FakePlayerctl,
  platform: NodeJS.Platform = "linux",
  config?: Record<string, unknown>,
) {
  const clock = new Clock();
  h = createHarness({
    modules: [createMprisCapability({ run: player.run, platform, sleep: clock.sleep })],
  });
  if (config) h.manager.configure("mpris", config);
  await h.enable("mpris");
  if (platform === "linux") await clock.first();
  return clock;
}

/** Names that must never reach `playerctl`: options, lists, the %any wildcard, injection, control characters. */
const HOSTILE_NAMES = [
  "-h",
  "--help",
  "--player=vlc",
  "-a",
  "vlc,spotify",
  "%any",
  "vlc --all-players",
  "vlc\nnext",
  "vlc\u0000",
  "vlc; id",
  "$(id)",
  "`id`",
  "vlc|cat",
  "../vlc",
  "",
  " vlc",
  "vlc ",
  "é",
  "a".repeat(65),
  "a".repeat(100_000),
];

describe("now_playing", () => {
  it("reports the track in seconds with volume, shuffle and repeat, and runs only fixed playerctl arguments", async () => {
    const player = fakePlayerctl({ shuffle: "true", loop: "Playlist" });
    await ready(player);
    const op = await h!.run("mpris", "now_playing");
    expect(op.result).toEqual({
      running: true,
      state: "playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      position_s: 30,
      duration_s: 215,
      volume: 60,
      shuffle: true,
      repeat: "all",
    });
    for (const call of player.calls) {
      expect(
        call.args.every(
          (a) => a === "--list-all" || a === "metadata" || a === `--format=${METADATA_FORMAT}`,
        ),
      ).toBe(true);
    }
  });

  it("maps playerctl's loop words and statuses", () => {
    const f = (status: string, loop: string) =>
      parseNowPlaying([status, "", "", "", "", "", "", "", loop].join(FIELD_SEPARATOR));
    expect(f("Paused", "Track")).toMatchObject({ state: "paused", repeat: "one" });
    expect(f("Stopped", "None")).toMatchObject({ state: "stopped", repeat: "off" });
    expect(f("???", "Something")).toMatchObject({ state: "stopped" });
    expect(f("???", "Something").repeat).toBeUndefined();
  });

  it("reports not_running, without starting anything, when no player is on the bus", async () => {
    const player = fakePlayerctl();
    player.players = [];
    await ready(player);
    expect((await h!.run("mpris", "now_playing")).result).toEqual({
      running: false,
      state: "not_running",
    });
    const op = await h!.run("mpris", "next");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toBe("No media player is running");
    expect(player.controls).toEqual([]);
    expect(player.calls.every((c) => c.args.join(" ") === "--list-all")).toBe(true);
  });

  it("reports the state alone for a player with no current track", async () => {
    const player = fakePlayerctl({ status: "Stopped" });
    player.noTrack = true;
    await ready(player);
    expect((await h!.run("mpris", "now_playing")).result).toEqual({
      running: true,
      state: "stopped",
    });
  });

  it("addresses the named player, matching its instances", async () => {
    const player = fakePlayerctl();
    player.players = ["vlc.instance42", "spotify"];
    await ready(player);
    const op = await h!.run("mpris", "now_playing", { player: "vlc" });
    expect(op.status).toBe("succeeded");
    expect(player.calls.at(-1)?.args).toEqual([
      "--player=vlc",
      "metadata",
      `--format=${METADATA_FORMAT}`,
    ]);
    expect((await h!.run("mpris", "now_playing", { player: "mpv" })).result).toEqual({
      running: false,
      state: "not_running",
    });
  });

  it("uses the player set in the settings, and a call's own player wins", async () => {
    const player = fakePlayerctl();
    player.players = ["vlc", "spotify"];
    await ready(player, "linux", { player: "spotify" });
    await h!.run("mpris", "now_playing");
    expect(player.calls.at(-1)?.args[0]).toBe("--player=spotify");
    await h!.run("mpris", "play_pause", { player: "vlc" });
    expect(player.controls).toEqual([["play-pause"]]);
    expect(player.calls.at(-1)?.args).toEqual(["--player=vlc", "play-pause"]);
  });

  it("a failing player makes health degraded with a fixed message, and recovers", async () => {
    const player = fakePlayerctl();
    await ready(player);
    player.failWith = new Error("playerctl exploded: /home/me/secret.txt");
    const op = await h!.run("mpris", "now_playing");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toBe("The player did not answer");
    expect(JSON.stringify(op)).not.toContain("secret.txt");
    expect((await h!.manager.checkHealth("mpris")).health).toMatchObject({ status: "degraded" });
    await h!.run("mpris", "now_playing");
    expect((await h!.manager.checkHealth("mpris")).health).toMatchObject({ status: "healthy" });
  });
});

describe("hostile player output", () => {
  it("cleans control characters and clips oversized text; never runs a thing it says", async () => {
    const evil = "x".repeat(5_000);
    const player = fakePlayerctl({
      title: `line1\nline2\u0007\u202eend ${evil}`,
      artist: "$(touch /tmp/zz-pwn) `id` ; --player=evil",
      album: "-h",
    });
    await ready(player);
    const op = await h!.run("mpris", "now_playing");
    const np = op.result as NowPlaying;
    expect(np.title).toHaveLength(200);
    expect(np.title).not.toMatch(/[\u0000-\u001f\u202e]/);
    expect(np.artist).toBe("$(touch /tmp/zz-pwn) `id` ; --player=evil");
    expect(np.album).toBe("-h");
    await h!.run("mpris", "next");
    for (const call of player.calls) {
      for (const arg of call.args) expect(arg).not.toContain("zz-pwn");
    }
    expect(player.controls).toEqual([["next"]]);
  });

  it("drops malformed numbers and refuses an answer of the wrong shape", () => {
    const f = ["Playing", "T", "A", "B", "-5", "1e9", "99", "maybe", "Loopy"].join(FIELD_SEPARATOR);
    const np = parseNowPlaying(f);
    expect(np).toEqual({
      running: true,
      state: "playing",
      title: "T",
      artist: "A",
      album: "B",
      volume: 100,
    });
    expect(() => parseNowPlaying(["Playing", "only", "three"].join(FIELD_SEPARATOR))).toThrow(
      /unexpected answer/,
    );
    expect(() => parseNowPlaying(`a${FIELD_SEPARATOR}`.repeat(30))).toThrow();
  });

  it("an oversized answer is refused by the runner's cap, not parsed", async () => {
    const player = fakePlayerctl({ title: "t".repeat(40_000) });
    await ready(player);
    const op = await h!.run("mpris", "now_playing");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toBe("The player's answer was too large");
    const metadata = player.calls.find((c) => c.args.includes("metadata"));
    expect(metadata?.limits).toEqual({ maxOutputBytes: 16 * 1024 });
  });

  it("ignores hostile names in the bus list: they never count as a player", async () => {
    const player = fakePlayerctl();
    player.listOutput = [
      "--help",
      "vlc,spotify",
      "%any",
      "bad name",
      "$(id)",
      "a".repeat(500),
    ].join("\n");
    await ready(player);
    expect((await h!.run("mpris", "now_playing")).result).toEqual({
      running: false,
      state: "not_running",
    });
    expect((await h!.run("mpris", "play_pause")).status).toBe("failed");
    expect(player.controls).toEqual([]);
  });
});

describe("controls", () => {
  it("every control is a write that asks; a declined one never reaches playerctl", async () => {
    const player = fakePlayerctl();
    await ready(player);
    const effects = Object.fromEntries(
      h!.manager.get("mpris").commands.map((c) => [c.name, c.side_effect]),
    );
    expect(effects).toEqual({
      now_playing: "read",
      play_pause: "write",
      next: "write",
      previous: "write",
      seek: "write",
      set_volume: "write",
      set_shuffle: "write",
      set_repeat: "write",
    });
    const inputs: Record<string, unknown> = {
      play_pause: {},
      next: {},
      previous: {},
      seek: { position_s: 10 },
      set_volume: { volume: 20 },
      set_shuffle: { enabled: true },
      set_repeat: { mode: "all" },
    };
    const before = player.calls.length;
    for (const [command, input] of Object.entries(inputs)) {
      expect((await h!.run("mpris", command, input, false)).status, command).toBe("failed");
    }
    expect(player.calls.length).toBe(before);
    expect(player.controls).toEqual([]);
  });

  it("an approved play/pause, next, previous, seek, volume, shuffle and repeat each reach playerctl as separate fixed arguments", async () => {
    const player = fakePlayerctl();
    await ready(player);
    const steps: [string, unknown][] = [
      ["play_pause", {}],
      ["next", {}],
      ["previous", {}],
      ["seek", { position_s: 90 }],
      ["set_volume", { volume: 42 }],
      ["set_volume", { volume: 0 }],
      ["set_volume", { volume: 100 }],
      ["set_shuffle", { enabled: true }],
      ["set_shuffle", { enabled: false }],
      ["set_repeat", { mode: "one" }],
      ["set_repeat", { mode: "all" }],
      ["set_repeat", { mode: "off" }],
    ];
    for (const [command, input] of steps) {
      expect((await h!.run("mpris", command, input)).status, command).toBe("succeeded");
    }
    expect(player.controls).toEqual([
      ["play-pause"],
      ["next"],
      ["previous"],
      ["position", "90"],
      ["volume", "0.42"],
      ["volume", "0.00"],
      ["volume", "1.00"],
      ["shuffle", "On"],
      ["shuffle", "Off"],
      ["loop", "Track"],
      ["loop", "Playlist"],
      ["loop", "None"],
    ]);
    expect(player.track).toMatchObject({ status: "Paused", positionUs: 90_000_000, loop: "None" });
    // A control's playerctl call carries no player option unless one was chosen.
    expect(player.calls.filter((c) => c.args[0] === "play-pause")).toHaveLength(1);
  });

  it("an approved control for a named player puts it in one --player= argument", async () => {
    const player = fakePlayerctl();
    player.players = ["spotify", "vlc.instance1"];
    await ready(player);
    expect((await h!.run("mpris", "next", { player: "vlc.instance1" })).status).toBe("succeeded");
    expect(player.calls.at(-1)?.args).toEqual(["--player=vlc.instance1", "next"]);
  });

  it("shows the chosen player in the approval prompt", async () => {
    for (const command of createMprisCapability().manifest.commands) {
      const schema = command.input_schema as {
        properties: Record<string, Record<string, unknown>>;
      };
      expect(schema.properties.player!["x-phoenix-confirm"], command.name).toBe(true);
    }
  });
});

describe("input validation", () => {
  it("refuses hostile player names at the schema, before anything runs", async () => {
    const player = fakePlayerctl();
    await ready(player);
    const before = player.calls.length;
    for (const name of HOSTILE_NAMES) {
      for (const command of ["now_playing", "play_pause", "next", "previous"]) {
        expect(
          () => h!.manager.invoke("mpris", command, { player: name }),
          `${command} ${JSON.stringify(name).slice(0, 40)}`,
        ).toThrow();
      }
      expect(() => h!.manager.invoke("mpris", "seek", { position_s: 1, player: name })).toThrow();
    }
    expect(player.calls.length).toBe(before);
  });

  it("the handler-level guard refuses hostile names on its own (schema bypassed)", async () => {
    const player = fakePlayerctl();
    for (const name of HOSTILE_NAMES) {
      expect(PLAYER_NAME.test(name), JSON.stringify(name).slice(0, 40)).toBe(false);
      await expect(runControl(player.run, "linux", "next", { player: name })).rejects.toMatchObject(
        {
          kind: "invalid",
        },
      );
      await expect(readNowPlaying(player.run, "linux", name)).rejects.toMatchObject({
        kind: "invalid",
      });
    }
    await expect(runControl(player.run, "linux", "next", { player: 5 })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(runControl(player.run, "linux", "next", {}, "--help")).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(player.calls).toEqual([]);
  });

  it("refuses a hostile player in the settings", async () => {
    const player = fakePlayerctl();
    h = createHarness({ modules: [createMprisCapability({ run: player.run, platform: "linux" })] });
    for (const bad of ["--help", "-h", "vlc,spotify", "%any", "a".repeat(65), 5]) {
      expect(() => h!.manager.configure("mpris", { player: bad }), String(bad)).toThrow();
    }
    expect(player.calls).toEqual([]);
  });

  it("accepts ordinary player names", () => {
    for (const name of [
      "spotify",
      "vlc",
      "mpv",
      "firefox.instance_1_94",
      "chromium.instance1234",
      "org-x.Player",
      "0ad",
    ]) {
      expect(PLAYER_NAME.test(name), name).toBe(true);
    }
  });

  it("refuses hostile volume, seek, shuffle and repeat before playerctl runs", async () => {
    const player = fakePlayerctl();
    await ready(player);
    const before = player.calls.length;
    const bad: [string, unknown][] = [
      ["set_volume", { volume: "50; id" }],
      ["set_volume", { volume: "--help" }],
      ["set_volume", { volume: 101 }],
      ["set_volume", { volume: -1 }],
      ["set_volume", { volume: 5.5 }],
      ["set_volume", { volume: "0.5" }],
      ["seek", { position_s: "-5" }],
      ["seek", { position_s: -1 }],
      ["seek", { position_s: 86_401 }],
      ["seek", { position_s: 1e21 }],
      ["set_shuffle", { enabled: "On" }],
      ["set_repeat", { mode: "Track" }],
      ["set_repeat", { mode: "--help" }],
      ["set_repeat", { mode: "ALL" }],
      ["play_pause", { extra: "--help" }],
    ];
    for (const [command, input] of bad) {
      expect(() => h!.manager.invoke("mpris", command, input), JSON.stringify(input)).toThrow();
    }
    expect(player.calls.length).toBe(before);
  });

  it("the handler-level guard refuses bad values and unknown controls on its own", async () => {
    const player = fakePlayerctl();
    const bad: [string, unknown][] = [
      ["set_volume", { volume: "--help" }],
      ["set_volume", { volume: Number.NaN }],
      ["set_volume", { volume: Infinity }],
      ["seek", { position_s: "-5" }],
      ["seek", { position_s: 0.5 }],
      ["set_shuffle", { enabled: "yes" }],
      ["set_repeat", { mode: "__proto__" }],
      ["set_repeat", { mode: "toString" }],
      ["__proto__", {}],
      ["constructor", {}],
      ["list-all", {}],
    ];
    for (const [command, input] of bad) {
      await expect(
        runControl(player.run, "linux", command, input),
        `${command}`,
      ).rejects.toMatchObject({
        kind: "invalid",
      });
    }
    expect(Object.keys(CONTROLS).sort()).toEqual(
      ["next", "play_pause", "previous", "seek", "set_repeat", "set_shuffle", "set_volume"].sort(),
    );
    expect(player.calls).toEqual([]);
  });
});

describe("other platforms", () => {
  it.each(["darwin", "win32", "freebsd"] as const)(
    "is unsupported and degraded on %s, and never runs playerctl",
    async (platform) => {
      const player = fakePlayerctl();
      await ready(player, platform);
      expect((await h!.run("mpris", "now_playing")).error?.message).toMatch(/Linux only/);
      expect((await h!.run("mpris", "seek", { position_s: 3 })).status).toBe("failed");
      expect((await h!.run("mpris", "play_pause")).status).toBe("failed");
      expect(player.calls).toEqual([]);
      expect((await h!.manager.checkHealth("mpris")).health).toMatchObject({
        status: "degraded",
        message: expect.stringMatching(/Unsupported/),
      });
    },
  );

  it("says plainly that Windows is not implemented", async () => {
    await ready(fakePlayerctl(), "win32");
    expect((await h!.manager.checkHealth("mpris")).health.message).toMatch(
      /Windows is not implemented/,
    );
  });
});

describe("track events", () => {
  it("emits mpris.track.playing/paused once per change, not stored as history", async () => {
    const player = fakePlayerctl({ status: "Paused" });
    const clock = await ready(player);
    player.track.status = "Playing";
    await clock.tick();
    await clock.tick();
    player.track.status = "Paused";
    await clock.tick();
    await h!.drain();
    expect(h!.types("mpris").filter((t) => t.includes(".track."))).toEqual([
      "mpris.track.playing",
      "mpris.track.paused",
    ]);
    expect(
      h!.db.prepare("select count(*) as n from events where event_type like 'mpris.track.%'").get(),
    ).toEqual({ n: 0 });
  });

  it("diffPlayback: a new track while playing is a new event; a player that went away reads as paused", () => {
    const a: NowPlaying = { running: true, state: "playing", title: "A" };
    const first = diffPlayback(NOTHING_OBSERVED, a);
    expect(first.events.map((e) => e.event_type)).toEqual(["mpris.track.playing"]);
    expect(diffPlayback(first.observed, a).events).toEqual([]);
    const b = diffPlayback(first.observed, { ...a, title: "B" });
    expect(b.events.map((e) => e.event_type)).toEqual(["mpris.track.playing"]);
    const gone = diffPlayback(b.observed, { running: false, state: "not_running" });
    expect(gone.events.map((e) => e.event_type)).toEqual(["mpris.track.paused"]);
  });

  it("declares no state_rules", async () => {
    expect("state_rules" in createMprisCapability().manifest).toBe(false);
  });

  it("does not poll, and polls on Linux only", async () => {
    const player = fakePlayerctl();
    await ready(player, "darwin");
    await new Promise((r) => setTimeout(r, 20));
    expect(player.calls).toEqual([]);
  });
});
