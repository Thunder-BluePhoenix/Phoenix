// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SCRIPTS,
  COVER_SCRIPT,
  FIELD_SEPARATOR,
  MAX_COVER_BYTES,
  PLAY_PAUSE_SCRIPT,
  REPEAT_SCRIPT,
  VOLUME_SCRIPT,
  NOTHING_OBSERVED,
  createAppleMusicCapability,
  diffPlayback,
  parseCover,
  parseNowPlaying,
  readCover,
  runControl,
  type NowPlaying,
} from "../src";
import * as scripts from "../src/scripts";
import { dataLiteral, fakePlayer, type FakePlayer } from "../testing/fake-player";

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

async function ready(player: FakePlayer, platform: NodeJS.Platform = "darwin") {
  const clock = new Clock();
  h = createHarness({
    modules: [createAppleMusicCapability({ run: player.run, platform, sleep: clock.sleep })],
  });
  await h.enable("apple-music");
  if (platform === "darwin") await clock.first();
  return clock;
}

const HOSTILE = [
  '"; do shell script "touch /tmp/zz-pwn"; "',
  '1) & (do shell script "id")',
  '60\nend tell\ndo shell script "id"',
];

describe("now_playing", () => {
  it("reports the track in seconds with shuffle and repeat", async () => {
    await ready(fakePlayer({ shuffling: true, repeat: "one" }));
    const op = await h!.run("apple-music", "now_playing");
    expect(op.result).toEqual({
      running: true,
      state: "playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      duration_s: 215,
      position_s: 30,
      volume: 60,
      shuffle: true,
      repeat: "one",
    });
  });

  it("reads the four-letter codes AppleScript uses when it has no name for a constant", () => {
    const out = parseNowPlaying(
      ["«constant ****kPSp»", "t", "a", "b", "10", "1", "5", "false", "«constant ****kRpA»"].join(
        FIELD_SEPARATOR,
      ),
    );
    expect(out).toMatchObject({ state: "paused", repeat: "all", shuffle: false });
  });

  it("reports not_running and never launches Music", async () => {
    const player = fakePlayer();
    player.running = false;
    await ready(player);
    expect((await h!.run("apple-music", "now_playing")).result).toEqual({
      running: false,
      state: "not_running",
    });
    const op = await h!.run("apple-music", "next");
    expect(op.status).toBe("failed");
    expect(op.error?.message).toBe("Apple Music is not running");
  });

  it("every script that talks to Music returns before doing so when the app is closed", () => {
    const talking = scriptConstants().filter(([, script]) =>
      script.includes('tell application "Music"'),
    );
    expect(talking.length).toBe(9);
    for (const [name, script] of talking) {
      const guard = script.indexOf('if application "Music" is not running then return');
      expect(guard, name).toBeGreaterThanOrEqual(0);
      expect(guard, name).toBeLessThan(script.indexOf('tell application "Music"'));
    }
    expect(scripts.RUNNING_SCRIPT).not.toMatch(/tell application/);
  });

  it("cleans hostile text and rejects an answer with injected extra fields", () => {
    const ok = parseNowPlaying(
      ["playing", "x".repeat(500), "<b>a</b>", "al", "1", "1", "500", "true", "off"].join(
        FIELD_SEPARATOR,
      ),
    );
    expect(ok.title).toHaveLength(200);
    expect(ok.volume).toBe(100);
    expect(() =>
      parseNowPlaying(
        ["playing", `a${FIELD_SEPARATOR}b`, "", "", "1", "1", "1", "true", "off"].join(
          FIELD_SEPARATOR,
        ),
      ),
    ).toThrow(/unexpected answer/);
  });
});

/** Magic bytes followed by filler, `size` bytes in all. */
function image(magic: number[], size = 64): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x41);
  bytes.set(magic);
  return bytes;
}
const PNG = image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = image([0xff, 0xd8, 0xff, 0xe0]);
const dataUrl = (type: string, bytes: Uint8Array) =>
  `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
const text = (s: string) => new TextEncoder().encode(s);

describe("cover art", () => {
  it("returns a PNG and a JPEG as an inline image, read through the fixed cover script", async () => {
    const player = fakePlayer();
    await ready(player);
    player.coverOutput = dataLiteral(PNG);
    expect((await h!.run("apple-music", "now_playing")).result).toMatchObject({
      cover: dataUrl("png", PNG),
    });
    player.track.title = "Other";
    player.coverOutput = dataLiteral(JPEG);
    expect((await h!.run("apple-music", "now_playing")).result).toMatchObject({
      cover: dataUrl("jpeg", JPEG),
    });
    const cover = player.calls.filter((c) => c.script === COVER_SCRIPT);
    expect(cover).toHaveLength(2);
    for (const call of cover) expect(call.args).toEqual([]);
    expect(player.coverLimits?.maxOutputBytes).toBeGreaterThan(MAX_COVER_BYTES * 2);
  });

  it("asks Music once per track, and again when the track changes", async () => {
    const player = fakePlayer();
    await ready(player);
    player.coverOutput = dataLiteral(PNG);
    const coverRuns = () => player.calls.filter((c) => c.script === COVER_SCRIPT).length;
    await h!.run("apple-music", "now_playing");
    await h!.run("apple-music", "now_playing");
    expect(coverRuns()).toBe(1);
    player.track.title = "Next one";
    await h!.run("apple-music", "now_playing");
    expect(coverRuns()).toBe(2);
  });

  it("accepts exactly the size cap and refuses one byte more", () => {
    const at = image([0xff, 0xd8, 0xff], MAX_COVER_BYTES);
    expect(parseCover(dataLiteral(at))).toBe(dataUrl("jpeg", at));
    const over = image([0xff, 0xd8, 0xff], MAX_COVER_BYTES + 1);
    expect(parseCover(dataLiteral(over))).toBeUndefined();
  });

  it("refuses an oversize answer: the runner is told the cap and the capability shows no cover", async () => {
    const player = fakePlayer();
    await ready(player);
    player.coverOutput = dataLiteral(
      image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 3_000_000),
    );
    const op = await h!.run("apple-music", "now_playing");
    expect(op.status).toBe("succeeded");
    expect((op.result as NowPlaying).cover).toBeUndefined();
    expect((op.result as NowPlaying).title).toBe("Song");
    // The runner is not what enforces the cap alone: even a runner that returned it is refused.
    const huge = dataLiteral(
      image([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], MAX_COVER_BYTES + 1),
    );
    expect(await readCover(async () => huge, "darwin")).toEqual({ failed: false });
  });

  it.each([
    ["SVG", dataLiteral(text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))],
    ["HTML", dataLiteral(text("<!doctype html><script>alert(1)</script>"))],
    ["garbage bytes", dataLiteral(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))],
    ["WebP", dataLiteral(image([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))],
    ["GIF", dataLiteral(text("GIF89a......"))],
    ["a PNG signature cut short", dataLiteral(image([0x89, 0x50, 0x4e, 0x47]))],
    ["an empty literal", "«data tdta»"],
    ["odd hex", "«data tdta89504E4»"],
    ["text that is not a literal", "hello"],
    ["a data URI printed as text", dataUrl("png", PNG)],
    ["a literal with trailing text", `${dataLiteral(PNG)} extra`],
    ["a literal with leading text", `x${dataLiteral(PNG)}`],
    ["none", "none"],
    ["empty output", ""],
  ])("shows no cover for %s", async (_name, output) => {
    const player = fakePlayer();
    await ready(player);
    player.coverOutput = output;
    const op = await h!.run("apple-music", "now_playing");
    expect(op.status).toBe("succeeded");
    expect((op.result as NowPlaying).cover).toBeUndefined();
    expect((op.result as NowPlaying).title).toBe("Song");
  });

  it("shows no cover, and does not throw, when the runner fails; the next call tries again", async () => {
    const player = fakePlayer();
    await ready(player);
    player.coverOutput = dataLiteral(PNG);
    player.coverFailWith = new Error("osascript exploded with /Users/me/secret.txt");
    const op = await h!.run("apple-music", "now_playing");
    expect(op.status).toBe("succeeded");
    expect((op.result as NowPlaying).cover).toBeUndefined();
    expect(JSON.stringify(op)).not.toContain("secret.txt");
    player.coverFailWith = undefined;
    expect((await h!.run("apple-music", "now_playing")).result).toMatchObject({
      cover: dataUrl("png", PNG),
    });
  });

  it("shows no cover when the player never answers (timeout)", async () => {
    const player = fakePlayer();
    player.coverGate = new Promise<void>(() => undefined);
    const started = Date.now();
    expect(await readCover(player.run, "darwin", undefined, 20)).toEqual({ failed: true });
    expect(Date.now() - started).toBeLessThan(2_000);
    // A caller that cancels (the command was aborted) gets the same answer at once.
    const gone = AbortSignal.abort();
    expect(await readCover(player.run, "darwin", gone)).toEqual({ failed: true });
  });

  it("does not ask for a cover when the app is closed, off macOS, or the track is unknown", async () => {
    const closed = fakePlayer();
    closed.running = false;
    await ready(closed);
    await h!.run("apple-music", "now_playing");
    expect(closed.calls.some((c) => c.script === COVER_SCRIPT)).toBe(false);
    const other = fakePlayer();
    expect(await readCover(other.run, "linux")).toEqual({ failed: false });
    expect(other.calls).toEqual([]);
    const midway = fakePlayer();
    midway.running = false;
    expect(await readCover(midway.run, "darwin")).toEqual({ failed: true });
  });

  it("COVER_SCRIPT is a constant that takes no input and only reads", () => {
    expect(ALL_SCRIPTS.has(COVER_SCRIPT)).toBe(true);
    expect(COVER_SCRIPT).not.toMatch(
      /\$\{|item \d+ of argv|do shell script|set \w+ to .*artwork|write|file/i,
    );
    expect(COVER_SCRIPT).toContain('if application "Music" is not running then return');
    expect(COVER_SCRIPT).toContain("raw data of artwork 1 of current track");
  });

  it("whatever the track says, the cover script is the same constant with no arguments", async () => {
    const player = fakePlayer({ title: HOSTILE[0]!, artist: HOSTILE[1]!, album: HOSTILE[2]! });
    await ready(player);
    player.coverOutput = dataLiteral(PNG);
    await h!.run("apple-music", "now_playing");
    const cover = player.calls.filter((c) => c.script === COVER_SCRIPT);
    expect(cover).toEqual([{ script: COVER_SCRIPT, args: [] }]);
    for (const call of player.calls) expect(ALL_SCRIPTS.has(call.script)).toBe(true);
  });
});

describe("AppleScript injection", () => {
  it("only ever runs the fixed scripts, whatever the track title says", async () => {
    const player = fakePlayer({ title: HOSTILE[0]!, artist: HOSTILE[1]!, album: HOSTILE[2]! });
    await ready(player);
    const op = await h!.run("apple-music", "now_playing");
    await h!.run("apple-music", "play_pause");
    expect((op.result as NowPlaying).title).toContain("do shell script");
    expect(player.calls.length).toBeGreaterThan(1);
    for (const call of player.calls) expect(ALL_SCRIPTS.has(call.script)).toBe(true);
  });

  it("refuses hostile volume, seek, shuffle and repeat before any script runs", async () => {
    const player = fakePlayer();
    await ready(player);
    const before = player.calls.length;
    const bad: [string, unknown][] = [
      ["set_volume", { volume: HOSTILE[0] }],
      ["set_volume", { volume: 101 }],
      ["set_volume", { volume: 5.5 }],
      ["seek", { position_s: HOSTILE[1] }],
      ["seek", { position_s: -1 }],
      ["set_shuffle", { enabled: "yes" }],
      ["set_repeat", { mode: HOSTILE[2] }],
      ["set_repeat", { mode: "ALL" }],
    ];
    for (const [command, input] of bad) {
      expect(
        () => h!.manager.invoke("apple-music", command, input),
        JSON.stringify(input),
      ).toThrow();
    }
    expect(player.calls.length).toBe(before);
  });

  it("the handler-level guard refuses hostile input and unknown controls on its own", async () => {
    const player = fakePlayer();
    await expect(
      runControl(player.run, "darwin", "set_repeat", { mode: HOSTILE[0] }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      runControl(player.run, "darwin", "set_volume", { volume: HOSTILE[1] }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(runControl(player.run, "darwin", "__proto__", {})).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(player.calls).toEqual([]);
  });

  it("passes validated values as separate arguments, never inside the script", async () => {
    const player = fakePlayer();
    await ready(player);
    await h!.run("apple-music", "set_volume", { volume: 42 });
    await h!.run("apple-music", "set_repeat", { mode: "one" });
    expect(player.calls.find((c) => c.script === VOLUME_SCRIPT)?.args).toEqual(["42"]);
    expect(player.calls.find((c) => c.script === REPEAT_SCRIPT)?.args).toEqual(["one"]);
    expect(player.track).toMatchObject({ volume: 42, repeat: "one" });
  });
});

describe("controls and confirmation", () => {
  it("every control is a write that asks; a declined one never reaches the player", async () => {
    const player = fakePlayer();
    await ready(player);
    const effects = Object.fromEntries(
      h!.manager.get("apple-music").commands.map((c) => [c.name, c.side_effect]),
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
    const before = player.calls.length;
    expect((await h!.run("apple-music", "play_pause", {}, false)).status).toBe("failed");
    expect(player.calls.length).toBe(before);
    expect((await h!.run("apple-music", "play_pause")).status).toBe("succeeded");
    expect(player.calls.at(-1)?.script).toBe(PLAY_PAUSE_SCRIPT);
    expect(player.track.state).toBe("paused");
  });
});

describe("other platforms", () => {
  it("is unsupported and degraded off macOS, and never runs a script", async () => {
    const player = fakePlayer();
    await ready(player, "win32");
    expect((await h!.run("apple-music", "now_playing")).error?.message).toMatch(/macOS only/);
    expect((await h!.run("apple-music", "seek", { position_s: 3 })).status).toBe("failed");
    expect(player.calls).toEqual([]);
    expect((await h!.manager.checkHealth("apple-music")).health).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/Unsupported/),
    });
  });
});

describe("track events", () => {
  it("emits apple_music.track.playing/paused once per change, not stored as history", async () => {
    const player = fakePlayer({ state: "paused" });
    const clock = await ready(player);
    player.track.state = "playing";
    await clock.tick();
    await clock.tick();
    player.track.state = "paused";
    await clock.tick();
    await h!.drain();
    expect(h!.types("apple-music").filter((t) => t.includes(".track."))).toEqual([
      "apple_music.track.playing",
      "apple_music.track.paused",
    ]);
    expect(
      h!.db
        .prepare("select count(*) as n from events where event_type like 'apple_music.track.%'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("a track change while playing is announced again; closing the app reads as paused", () => {
    const a = diffPlayback(NOTHING_OBSERVED, { running: true, state: "playing", title: "a" });
    const b = diffPlayback(a.observed, { running: true, state: "playing", title: "b" });
    expect(b.events.map((e) => e.event_type)).toEqual(["apple_music.track.playing"]);
    const closed = diffPlayback(b.observed, { running: false, state: "not_running" });
    expect(closed.events.map((e) => e.event_type)).toEqual(["apple_music.track.paused"]);
  });
});
