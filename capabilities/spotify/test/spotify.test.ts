// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SCRIPTS,
  NOW_PLAYING_SCRIPT,
  PLAY_PAUSE_SCRIPT,
  SEEK_SCRIPT,
  VOLUME_SCRIPT,
  createSpotifyCapability,
  diffPlayback,
  fetchCover,
  isSpotifyCdn,
  parseNowPlaying,
  runControl,
  NOTHING_OBSERVED,
  FIELD_SEPARATOR,
  PlayerError,
  type NowPlaying,
} from "../src";
import * as scripts from "../src/scripts";
import { fakePlayer, type FakePlayer } from "../testing/fake-player";

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

/** Every exported `*_SCRIPT` constant of scripts.ts, with its name. */
function scriptConstants(): [string, string][] {
  const found: [string, string][] = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (name.endsWith("_SCRIPT") && typeof value === "string") found.push([name, value]);
  }
  return found;
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const imageFetch = (bytes: Uint8Array, init: ResponseInit = {}): typeof fetch =>
  (async () => new Response(new Blob([bytes as BlobPart]), init)) as unknown as typeof fetch;

async function ready(
  player: FakePlayer,
  extra: { platform?: NodeJS.Platform; fetchImpl?: typeof fetch } = {},
) {
  const clock = new Clock();
  h = createHarness({
    modules: [
      createSpotifyCapability({
        run: player.run,
        platform: extra.platform ?? "darwin",
        fetchImpl: extra.fetchImpl ?? imageFetch(JPEG),
        sleep: clock.sleep,
      }),
    ],
  });
  await h.enable("spotify");
  if ((extra.platform ?? "darwin") === "darwin") await clock.first();
  return clock;
}

describe("now_playing", () => {
  it("reports the track, converts ms to s and returns the cover as an inline image", async () => {
    const player = fakePlayer({ shuffling: true, repeating: true });
    await ready(player);
    const op = await h!.run("spotify", "now_playing");
    expect(op.status).toBe("succeeded");
    expect(op.result).toMatchObject({
      running: true,
      state: "playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      duration_s: 215,
      position_s: 30,
      volume: 60,
      shuffle: true,
      repeat: "all",
      cover_url: "https://i.scdn.co/image/abc123",
    });
    expect((op.result as NowPlaying).cover).toBe(
      `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`,
    );
  });

  it("reports not_running and does not launch the app when it is closed", async () => {
    const player = fakePlayer();
    player.running = false;
    await ready(player);
    const op = await h!.run("spotify", "now_playing");
    expect(op.result).toEqual({ running: false, state: "not_running" });
    const control = await h!.run("spotify", "play_pause");
    expect(control.status).toBe("failed");
    expect(control.error?.message).toBe("Spotify is not running");
  });

  it("every script that talks to Spotify returns before doing so when the app is closed", () => {
    const talking = scriptConstants().filter(([, script]) =>
      script.includes('tell application "Spotify"'),
    );
    expect(talking.length).toBe(8);
    for (const [name, script] of talking) {
      const guard = script.indexOf('if application "Spotify" is not running then return');
      expect(guard, name).toBeGreaterThanOrEqual(0);
      expect(guard, name).toBeLessThan(script.indexOf('tell application "Spotify"'));
    }
    // `is running` asks the system; it does not start the app.
    expect(scripts.RUNNING_SCRIPT).not.toMatch(/tell application/);
  });

  it("clips and cleans hostile text, drops a non-https or oversized cover URL", () => {
    const evil = "x".repeat(500);
    const out = parseNowPlaying(
      [
        "playing",
        evil,
        "<b>a</b>",
        "al",
        "1000",
        "5",
        "999",
        "true",
        "false",
        "javascript:alert(1)",
      ].join(FIELD_SEPARATOR),
    );
    expect(out.title).toHaveLength(200);
    expect(out.artist).toBe("<b>a</b>");
    expect(out.volume).toBe(100);
    expect(out.cover_url).toBeUndefined();
  });

  it("refuses an answer whose title smuggles extra fields", () => {
    expect(() =>
      parseNowPlaying(
        ["playing", `a${FIELD_SEPARATOR}b`, "x", "y", "1", "1", "1", "true", "true", ""].join(
          FIELD_SEPARATOR,
        ),
      ),
    ).toThrow(/unexpected answer/);
  });
});

describe("AppleScript injection", () => {
  const HOSTILE = [
    '"; do shell script "touch /tmp/zz-pwn"; "',
    '1) & (do shell script "id")',
    '60\nend tell\ndo shell script "id"',
  ];

  it("only ever runs the fixed scripts, whatever the track title says", async () => {
    const player = fakePlayer({ title: HOSTILE[0]!, artist: HOSTILE[1]!, album: HOSTILE[2]! });
    await ready(player);
    const op = await h!.run("spotify", "now_playing");
    expect(op.status).toBe("succeeded");
    await h!.run("spotify", "play_pause");
    expect(player.calls.length).toBeGreaterThan(1);
    for (const call of player.calls) expect(ALL_SCRIPTS.has(call.script)).toBe(true);
    // The hostile text came back as data, not as part of any script.
    expect((op.result as NowPlaying).title).toContain("do shell script");
    expect(player.calls.every((c) => !c.script.includes("touch /tmp/zz-pwn"))).toBe(true);
  });

  it("refuses hostile volume, seek, shuffle and repeat before any script runs", async () => {
    const player = fakePlayer();
    await ready(player);
    const before = player.calls.length;
    const bad: [string, unknown][] = [
      ["set_volume", { volume: HOSTILE[0] }],
      ["set_volume", { volume: 101 }],
      ["set_volume", { volume: -1 }],
      ["set_volume", { volume: 5.5 }],
      ["set_volume", { volume: "50" }],
      ["seek", { position_s: HOSTILE[1] }],
      ["seek", { position_s: 86_401 }],
      ["seek", { position_s: 1e21 }],
      ["set_shuffle", { enabled: "true" }],
      ["set_repeat", { mode: "one" }],
      ["set_repeat", { mode: HOSTILE[2] }],
      ["set_volume", { volume: 5, extra: HOSTILE[0] }],
    ];
    for (const [command, input] of bad) {
      expect(() => h!.manager.invoke("spotify", command, input), JSON.stringify(input)).toThrow();
    }
    expect(player.calls.length).toBe(before);
  });

  it("passes validated numbers as separate arguments, never inside the script", async () => {
    const player = fakePlayer();
    await ready(player);
    await h!.run("spotify", "set_volume", { volume: 42 });
    await h!.run("spotify", "seek", { position_s: 90 });
    const vol = player.calls.find((c) => c.script === VOLUME_SCRIPT);
    const seek = player.calls.find((c) => c.script === SEEK_SCRIPT);
    expect(vol?.args).toEqual(["42"]);
    expect(seek?.args).toEqual(["90"]);
    expect(player.track.volume).toBe(42);
    expect(player.track.positionS).toBe(90);
  });

  it("the handler-level guard refuses hostile input and unknown controls on its own", async () => {
    const player = fakePlayer();
    await expect(
      runControl(player.run, "darwin", "set_volume", { volume: HOSTILE[0] }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(runControl(player.run, "darwin", "rm -rf", {})).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(player.calls).toEqual([]);
  });
});

describe("controls and confirmation", () => {
  it("declares every control as a write that asks, and a declined control does nothing", async () => {
    const player = fakePlayer();
    await ready(player);
    const view = h!.manager.get("spotify");
    const effects = Object.fromEntries(view.commands.map((c) => [c.name, c.side_effect]));
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
    const before = player.calls.length;
    const op = await h!.run("spotify", "play_pause", {}, false);
    expect(op.status).toBe("failed");
    expect(player.calls.length).toBe(before);
    expect(player.calls.some((c) => c.script === PLAY_PAUSE_SCRIPT)).toBe(false);
  });

  it("an approved play_pause toggles playback and shuffle/repeat reach the player", async () => {
    const player = fakePlayer();
    await ready(player);
    expect((await h!.run("spotify", "play_pause")).status).toBe("succeeded");
    expect(player.track.state).toBe("paused");
    await h!.run("spotify", "set_shuffle", { enabled: true });
    await h!.run("spotify", "set_repeat", { mode: "all" });
    expect(player.track).toMatchObject({ shuffling: true, repeating: true });
  });

  it("reports a macOS permission refusal in words", async () => {
    const player = fakePlayer();
    await ready(player);
    player.failWith = new PlayerError(
      "permission",
      "macOS has not allowed Phoenix to control this app",
    );
    const op = await h!.run("spotify", "now_playing");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/macOS has not allowed/);
    expect((await h!.manager.checkHealth("spotify")).health).toMatchObject({ status: "degraded" });
  });
});

describe("other platforms", () => {
  it("is unsupported and degraded off macOS, and never runs a script", async () => {
    const player = fakePlayer();
    await ready(player, { platform: "linux" });
    const op = await h!.run("spotify", "now_playing");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/macOS only/);
    expect((await h!.run("spotify", "next")).status).toBe("failed");
    expect(player.calls).toEqual([]);
    expect((await h!.manager.checkHealth("spotify")).health).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/Unsupported/),
    });
  });
});

describe("track events", () => {
  it("emits playing / paused once per change, ephemeral, and nothing for a repeat", async () => {
    const player = fakePlayer({ state: "paused" });
    const clock = await ready(player);
    await h!.drain();
    expect(h!.types("spotify").filter((t) => t.startsWith("spotify.track."))).toEqual([]);

    player.track.state = "playing";
    await clock.tick();
    await clock.tick(); // same observation again: no second event
    player.track.title = "Next song";
    await clock.tick();
    player.track.state = "paused";
    await clock.tick();
    await h!.drain();
    expect(h!.types("spotify").filter((t) => t.startsWith("spotify.track."))).toEqual([
      "spotify.track.playing",
      "spotify.track.playing",
      "spotify.track.paused",
    ]);
    // Ephemeral: reaches subscribers but is not stored as history.
    expect(
      h!.db
        .prepare("select count(*) as n from events where event_type like 'spotify.track.%'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("closing the app while playing reads as paused", () => {
    const playing = diffPlayback(NOTHING_OBSERVED, { running: true, state: "playing", title: "a" });
    expect(playing.events.map((e) => e.event_type)).toEqual(["spotify.track.playing"]);
    const closed = diffPlayback(playing.observed, { running: false, state: "not_running" });
    expect(closed.events.map((e) => e.event_type)).toEqual(["spotify.track.paused"]);
    expect(diffPlayback(closed.observed, { running: false, state: "not_running" }).events).toEqual(
      [],
    );
  });

  it("declares no state_rules: no existing Fawkes state means listening to music", async () => {
    await ready(fakePlayer());
    expect("state_rules" in createSpotifyCapability().manifest).toBe(false);
  });
});

describe("cover art", () => {
  it("fetches only from Spotify's CDN over https", async () => {
    for (const url of [
      "http://i.scdn.co/a",
      "https://evil.example.com/a",
      "https://scdn.co.evil.example.com/a",
      "https://i.scdn.co:8443/a",
      "https://user:pw@i.scdn.co/a",
      "javascript:alert(1)",
    ]) {
      expect(isSpotifyCdn(url), url).toBe(false);
    }
    expect(isSpotifyCdn("https://i.scdn.co/image/x")).toBe(true);
    const fetchImpl = vi.fn(imageFetch(JPEG));
    expect(await fetchCover("https://evil.example.com/a", fetchImpl)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not turn HTML, SVG or an oversized body into a cover", async () => {
    const url = "https://i.scdn.co/image/x";
    const html = new TextEncoder().encode("<svg onload=alert(1)>");
    expect(await fetchCover(url, imageFetch(html))).toBeUndefined();
    const huge = new Uint8Array(500 * 1024);
    huge.set(JPEG);
    expect(await fetchCover(url, imageFetch(huge))).toBeUndefined();
    expect(await fetchCover(url, imageFetch(JPEG, { status: 404 }))).toBeUndefined();
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await fetchCover(url, boom)).toBeUndefined();
  });

  it("now_playing still answers when the cover cannot be fetched", async () => {
    await ready(fakePlayer(), { fetchImpl: imageFetch(new Uint8Array([1, 2, 3])) });
    const op = await h!.run("spotify", "now_playing");
    expect(op.status).toBe("succeeded");
    expect((op.result as NowPlaying).cover).toBeUndefined();
    expect((op.result as NowPlaying).title).toBe("Song");
  });
});

describe("source files", () => {
  it("keeps the script constants listed (a new script must be added to ALL_SCRIPTS)", () => {
    const constants = scriptConstants();
    for (const [name, script] of constants) expect(ALL_SCRIPTS.has(script), name).toBe(true);
    expect(ALL_SCRIPTS.has(NOW_PLAYING_SCRIPT)).toBe(true);
  });
});
