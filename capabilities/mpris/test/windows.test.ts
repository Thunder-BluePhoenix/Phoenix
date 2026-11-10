// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Windows route: a pure script string, an output parser and a fake runner. NEVER RUN ON WINDOWS:
// no PowerShell, WinRT type or media session was ever involved, so the script's behaviour and the
// property/enum names it reads are unconfirmed.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARG_VARIABLE,
  COMMAND_VARIABLE,
  WINDOWS_COMMANDS,
  WINDOWS_SCRIPT,
  createMprisCapability,
  parseWindowsNowPlaying,
  readWindowsNowPlaying,
  runWindowsControl,
  windowsControlRequest,
  type WindowsRequest,
  type WindowsRunner,
} from "../src";
import { fakePlayerctl } from "../testing/fake-playerctl";

const SEP = "\u001f";
const TICKS = 10_000_000;

interface FakeWindows {
  run: WindowsRunner;
  requests: WindowsRequest[];
}

/** A fake of the script's contract (not of Windows): records requests, answers like the docs say. */
function fakeWindows(answer: string | ((r: WindowsRequest) => string) = "ok"): FakeWindows {
  const requests: WindowsRequest[] = [];
  const run: WindowsRunner = async (request) => {
    requests.push(request);
    return typeof answer === "function" ? answer(request) : answer;
  };
  return { run, requests };
}

const nowLine = (f: Partial<Record<number, string>> = {}) =>
  [
    f[0] ?? "Playing",
    f[1] ?? "Song",
    f[2] ?? "Artist",
    f[3] ?? "Album",
    f[4] ?? String(215 * TICKS),
    f[5] ?? String(30 * TICKS),
    f[6] ?? "False",
    f[7] ?? "None",
  ].join(SEP);

describe("the script is one constant with no input in it", () => {
  it("is a string constant that names only the allowed WinRT calls", () => {
    expect(typeof WINDOWS_SCRIPT).toBe("string");
    const calls = [...WINDOWS_SCRIPT.matchAll(/\.(Try\w+Async)\(/g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(
      [
        "TryChangeAutoRepeatModeAsync",
        "TryChangePlaybackPositionAsync",
        "TryChangeShuffleActiveAsync",
        "TryGetMediaPropertiesAsync",
        "TrySkipNextAsync",
        "TrySkipPreviousAsync",
        "TryTogglePlayPauseAsync",
      ].sort(),
    );
    // The script reads the two variables and nothing else of the environment.
    expect([...WINDOWS_SCRIPT.matchAll(/\$env:(\w+)/g)].map((m) => m[1]).sort()).toEqual(
      [ARG_VARIABLE, COMMAND_VARIABLE].sort(),
    );
    // No way to run text, start a process or reach the network from the script.
    expect(WINDOWS_SCRIPT).not.toMatch(
      /Invoke-Expression|\biex\b|Start-Process|Invoke-WebRequest|Invoke-RestMethod|DownloadString|New-Object\s+Net|Add-Type\s+-TypeDefinition|\[Reflection\.Assembly\]::Load|-Command|cmd(\.exe)?\b/i,
    );
  });

  it("validates both variables again, and its switch has exactly the allowed command arms", () => {
    const arms = [...WINDOWS_SCRIPT.matchAll(/^ {2}'(\w+)' \{/gm)].map((m) => m[1]);
    expect(arms.filter((a) => (WINDOWS_COMMANDS as readonly string[]).includes(a!)).sort()).toEqual(
      [...WINDOWS_COMMANDS].sort(),
    );
    expect(WINDOWS_SCRIPT).toContain("default { throw 'command' }");
    expect(WINDOWS_SCRIPT).toContain("'^[0-9]{1,12}$'");
    expect(WINDOWS_SCRIPT).toContain("$arg -ne 'on' -and $arg -ne 'off'");
    expect(WINDOWS_SCRIPT).toContain("default { throw 'argument' }");
  });

  it("awaits WinRT operations through AsTask by reflection with a 3 s bound", () => {
    expect(WINDOWS_SCRIPT).toContain("System.Runtime.WindowsRuntime");
    expect(WINDOWS_SCRIPT).toContain("ContentType=WindowsRuntime");
    expect(WINDOWS_SCRIPT).toContain("IAsyncOperation`1");
    expect(WINDOWS_SCRIPT).toContain("$task.Wait(3000)");
  });
});

describe("requests are built from validated input only", () => {
  it("maps each control to a fixed word and a digit or word argument", () => {
    expect(windowsControlRequest("play_pause", {})).toEqual({ command: "play_pause", arg: "" });
    expect(windowsControlRequest("next", undefined)).toEqual({ command: "next", arg: "" });
    expect(windowsControlRequest("previous", {})).toEqual({ command: "previous", arg: "" });
    expect(windowsControlRequest("seek", { position_s: 90 })).toEqual({
      command: "seek",
      arg: String(90 * TICKS),
    });
    expect(windowsControlRequest("seek", { position_s: 86_400 }).arg).toBe("864000000000");
    expect(windowsControlRequest("set_shuffle", { enabled: true }).arg).toBe("on");
    expect(windowsControlRequest("set_shuffle", { enabled: false }).arg).toBe("off");
    for (const mode of ["off", "one", "all"]) {
      expect(windowsControlRequest("set_repeat", { mode }).arg).toBe(mode);
    }
  });

  it("every argument the runner can receive matches what the script accepts", () => {
    for (const request of [
      windowsControlRequest("seek", { position_s: 86_400 }),
      windowsControlRequest("set_shuffle", { enabled: true }),
      windowsControlRequest("set_repeat", { mode: "all" }),
    ]) {
      expect(request.arg).toMatch(/^([0-9]{1,12}|on|off|one|all)$/);
    }
  });

  it.each([
    ["seek", { position_s: -1 }],
    ["seek", { position_s: 86_401 }],
    ["seek", { position_s: 1.5 }],
    ["seek", { position_s: "5" }],
    ["seek", { position_s: "5; Start-Process calc" }],
    ["seek", {}],
    ["set_shuffle", { enabled: "true" }],
    ["set_shuffle", {}],
    ["set_repeat", { mode: "Track" }],
    ["set_repeat", { mode: "all'; calc #" }],
    ["set_repeat", {}],
    ["nope", {}],
    ["now_playing", {}],
    ["__proto__", {}],
    ["constructor", {}],
  ])("refuses %s with %j", (command, input) => {
    expect(() => windowsControlRequest(command, input)).toThrow(/./);
  });

  it("refuses a player name (the current session is the only target) and says volume is unsupported", () => {
    for (const player of ["spotify", "", "-x", "%any"]) {
      expect(() => windowsControlRequest("play_pause", { player })).toThrow(/not supported/);
    }
    expect(() => windowsControlRequest("set_volume", { volume: 50 })).toThrow(/no volume control/);
  });

  it("no command word outside the fixed list ever reaches the runner", async () => {
    const fake = fakeWindows();
    for (const command of ["nope", "now_playing", "play_pause; calc", "toString"]) {
      await expect(runWindowsControl(fake.run, command, {})).rejects.toThrow();
    }
    await runWindowsControl(fake.run, "next", {});
    expect(fake.requests).toEqual([{ command: "next", arg: "" }]);
    expect(
      fake.requests.every((r) => (WINDOWS_COMMANDS as readonly string[]).includes(r.command)),
    ).toBe(true);
  });
});

describe("parsing what the script prints", () => {
  it("reads a full line", () => {
    expect(parseWindowsNowPlaying(nowLine({ 6: "True", 7: "Track", 0: "Paused" }))).toEqual({
      running: true,
      state: "paused",
      title: "Song",
      artist: "Artist",
      album: "Album",
      position_s: 30,
      duration_s: 215,
      shuffle: true,
      repeat: "one",
    });
  });

  it("maps the repeat enum names None, Track and List", () => {
    expect(parseWindowsNowPlaying(nowLine({ 7: "None" })).repeat).toBe("off");
    expect(parseWindowsNowPlaying(nowLine({ 7: "Track" })).repeat).toBe("one");
    expect(parseWindowsNowPlaying(nowLine({ 7: "List" })).repeat).toBe("all");
    expect(parseWindowsNowPlaying(nowLine({ 7: "Weird" })).repeat).toBeUndefined();
  });

  it("maps an unknown or non-playing status to stopped, and `none` to not running", () => {
    expect(parseWindowsNowPlaying(nowLine({ 0: "Stopped" })).state).toBe("stopped");
    expect(parseWindowsNowPlaying(nowLine({ 0: "Changing" })).state).toBe("stopped");
    expect(parseWindowsNowPlaying(nowLine({ 0: "<script>" })).state).toBe("stopped");
    expect(parseWindowsNowPlaying("none")).toEqual({ running: false, state: "not_running" });
  });

  it("cleans and clips text, drops bad numbers, never executes anything", () => {
    const np = parseWindowsNowPlaying(
      nowLine({ 1: "A\u202eB\u0007" + "x".repeat(500), 2: "", 4: "-5", 5: "1e9", 6: "maybe" }),
    );
    expect(np.title).not.toMatch(/[\u202e\u0007]/);
    expect(np.title!.length).toBeLessThanOrEqual(200);
    expect(np.artist).toBeUndefined();
    expect(np.duration_s).toBeUndefined();
    expect(np.position_s).toBeUndefined();
    expect(np.shuffle).toBeUndefined();
  });

  it("keeps the exact seconds from a 100-ns tick count above 2^53", () => {
    // 2^53 ticks is under 2^53/1e7 s: a double still floors correctly at this size.
    expect(parseWindowsNowPlaying(nowLine({ 4: String(5 * 3600 * TICKS) })).duration_s).toBe(
      18_000,
    );
  });

  describe("a hostile title cannot break the line (script cleaning, then the strict parser)", () => {
    // The script's own clean step, rebuilt from the pattern and limit it contains (the test reads
    // them out of WINDOWS_SCRIPT, so changing the script changes what is exercised here).
    const m =
      /function Clean\(\$s\) \{ \$t = \[regex\]::Replace\(\[string\]\$s, '([^']+)', ' '\); if \(\$t\.Length -gt (\d+)\)/.exec(
        WINDOWS_SCRIPT,
      );
    const clean = (s: string): string => {
      if (!m) throw new Error("the script has no Clean step");
      const t = s.replace(new RegExp(m[1]!, "g"), " ");
      return t.length > Number(m[2]) ? t.slice(0, Number(m[2])) : t;
    };
    const scriptLine = (title: string, artist = "Artist", album = "Album") =>
      [
        "Playing",
        clean(title),
        clean(artist),
        clean(album),
        String(215 * TICKS),
        String(30 * TICKS),
        "False",
        "None",
      ].join(SEP);

    it("the script cleans each of Title, Artist and AlbumTitle before the join", () => {
      expect(m).not.toBeNull();
      expect(m![2]).toBe("200");
      for (const prop of ["Title", "Artist", "AlbumTitle"]) {
        expect(WINDOWS_SCRIPT).toContain(`(Clean $props.${prop})`);
      }
      expect(WINDOWS_SCRIPT).not.toMatch(/\[string\]\$props\./);
    });

    it("a title with U+001F parses with its fields intact", () => {
      const np = parseWindowsNowPlaying(scriptLine("Intro" + SEP + "Outro", "A" + SEP + "B"));
      expect(np.title).toBe("Intro Outro");
      expect(np.artist).toBe("A B");
      expect(np.album).toBe("Album");
      expect(np.duration_s).toBe(215);
      expect(np.position_s).toBe(30);
    });

    it("the same title without the clean step is an unexpected answer (the F9 failure)", () => {
      const raw = nowLine({ 1: "Intro" + SEP + "Outro" });
      expect(() => parseWindowsNowPlaying(raw)).toThrow(/unexpected answer/);
    });

    it("a very long title is cut to 200 characters and the line stays small", () => {
      const line = scriptLine("x".repeat(200_000), "y".repeat(50_000), "z".repeat(50_000));
      expect(Buffer.byteLength(line, "utf8")).toBeLessThan(2048);
      const np = parseWindowsNowPlaying(line);
      expect(np.title).toBe("x".repeat(200));
      expect(np.artist).toBe("y".repeat(200));
      expect(np.album).toBe("z".repeat(200));
    });

    it("controls, line breaks and bidi marks become spaces", () => {
      const np = parseWindowsNowPlaying(scriptLine("a\r\nb\u0000c\u202ed\u2028e"));
      expect(np.title).toBe("a  b c d e");
    });
  });

  it.each([
    ["too few fields", "Playing" + SEP + "x"],
    ["too many fields", nowLine() + SEP + "extra"],
    ["empty", ""],
    ["an exception text", 'Exception calling "Wait" with "1" argument(s)'],
  ])("%s is an unexpected answer", (_n, out) => {
    expect(() => parseWindowsNowPlaying(out)).toThrow(/unexpected answer/);
  });

  it("readWindowsNowPlaying asks only for now_playing", async () => {
    const fake = fakeWindows(nowLine());
    expect((await readWindowsNowPlaying(fake.run)).title).toBe("Song");
    expect(fake.requests).toEqual([{ command: "now_playing", arg: "" }]);
    await expect(readWindowsNowPlaying(fake.run, "spotify")).rejects.toThrow(/not supported/);
  });

  it("a control reports no session, a refusal and a success distinctly", async () => {
    await expect(runWindowsControl(fakeWindows("none").run, "next", {})).rejects.toMatchObject({
      kind: "not_running",
    });
    await expect(runWindowsControl(fakeWindows("refused").run, "next", {})).rejects.toMatchObject({
      kind: "player",
      message: "The player did not accept the command",
    });
    await expect(
      runWindowsControl(fakeWindows("anything else <b>").run, "next", {}),
    ).rejects.toMatchObject({ kind: "player" });
    await expect(runWindowsControl(fakeWindows("ok").run, "next", {})).resolves.toBeUndefined();
  });
});

describe("the capability on win32", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  async function ready(windows: FakeWindows, config?: Record<string, unknown>) {
    const player = fakePlayerctl();
    const waits: number[] = [];
    h = createHarness({
      modules: [
        createMprisCapability({
          run: player.run,
          runWindows: windows.run,
          platform: "win32",
          sleep: (ms, signal) => {
            waits.push(ms);
            const w = Promise.withResolvers<void>();
            signal.addEventListener("abort", () => w.resolve(), { once: true });
            return w.promise;
          },
        }),
      ],
    });
    if (config) h.manager.configure("mpris", config);
    await h.enable("mpris");
    await vi.waitFor(() => expect(waits.length).toBeGreaterThan(0));
    return player;
  }

  it("polls and answers now_playing through the Windows runner, never playerctl", async () => {
    const windows = fakeWindows(nowLine());
    const player = await ready(windows);
    const op = await h!.run("mpris", "now_playing");
    expect(op.result).toMatchObject({ running: true, state: "playing", title: "Song" });
    expect(windows.requests.every((r) => r.command === "now_playing")).toBe(true);
    expect(player.calls).toEqual([]);
    expect((await h!.manager.checkHealth("mpris")).health).toMatchObject({ status: "healthy" });
  });

  it("controls run the fixed requests and still ask (side effect write)", async () => {
    const windows = fakeWindows((r) => (r.command === "now_playing" ? nowLine() : "ok"));
    await ready(windows);
    const manifest = h!.manager.get("mpris");
    expect(JSON.stringify(manifest)).toContain('"write"');
    expect((await h!.run("mpris", "play_pause")).status).toBe("succeeded");
    expect((await h!.run("mpris", "seek", { position_s: 3 })).status).toBe("succeeded");
    expect((await h!.run("mpris", "set_repeat", { mode: "all" })).status).toBe("succeeded");
    expect(windows.requests.filter((r) => r.command !== "now_playing")).toEqual([
      { command: "play_pause", arg: "" },
      { command: "seek", arg: String(3 * TICKS) },
      { command: "set_repeat", arg: "all" },
    ]);
  });

  it("refuses set_volume and a player choice, without running the script", async () => {
    const windows = fakeWindows((r) => (r.command === "now_playing" ? nowLine() : "ok"));
    await ready(windows);
    const before = windows.requests.length;
    const volume = await h!.run("mpris", "set_volume", { volume: 40 });
    expect(volume.status).toBe("failed");
    expect(volume.error?.message).toMatch(/no volume control/);
    const named = await h!.run("mpris", "next", { player: "spotify" });
    expect(named.status).toBe("failed");
    expect(windows.requests.length).toBe(before);
  });

  it("reports a failing script with a fixed message and degraded health", async () => {
    const windows = fakeWindows("Exception: C:\\Users\\someone\\secret track");
    await ready(windows);
    const op = await h!.run("mpris", "now_playing");
    expect(op.status).toBe("failed");
    expect(JSON.stringify(op)).not.toMatch(/someone|secret track/);
    expect((await h!.manager.checkHealth("mpris")).health.status).toBe("degraded");
  });
});
