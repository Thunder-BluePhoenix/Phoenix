// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { trackActivity } from "../../src/lid-actions/activity";
import {
  DEFAULT_LID_ACTIONS,
  isBundleId,
  parseLidActionsConfig,
} from "../../src/lid-actions/config";
import { parseBrightness } from "../../src/lid-actions/actions/display";
import { parseFrozen } from "../../src/lid-actions/actions/freeze-core";
import {
  DEFAULT_OUTPUT_ID,
  createOsascriptAudio,
  createProcessLister,
  parseDefaultOutputName,
  parsePsLine,
  realSignaler,
} from "../../src/lid-actions/real";
import type { Runner } from "../../src/system";
import { FakeClock, FakeFeed } from "../../testing/fakes";

describe("config", () => {
  it("defaults: apps, mute, display and Low Power Mode on; Docker and App Nap off", () => {
    const c = parseLidActionsConfig(undefined);
    expect(c).toMatchObject({
      enabled: true,
      display: true,
      freezeApps: true,
      mute: true,
      lowPower: true,
      dockerFreeze: false,
      appNap: false,
    });
    expect(c.freezeList).toEqual(["slack", "whatsapp", "discord"]);
    expect(c.appNapList).toEqual([]);
    expect(DEFAULT_LID_ACTIONS.dockerFreeze).toBe(false);
  });

  it("wrong types fall back to the default; unknown apps and bad bundle ids are dropped and counted", () => {
    const c = parseLidActionsConfig({
      display: "yes",
      docker_freeze: 1,
      freeze_apps_list: ["slack", "Terminal", "/bin/sh"],
      app_nap: true,
      app_nap_apps: ["com.example.App", "com.example.App", "-bad.id", "a b.c", "com.x;rm", 5],
    });
    expect(c.display).toBe(true);
    expect(c.dockerFreeze).toBe(false);
    expect(c.freezeList).toEqual(["slack"]);
    expect(c.appNapList).toEqual(["com.example.App"]);
    expect(c.dropped).toBe(2 + 4);
  });

  it("garbage config never throws", () => {
    for (const raw of [
      null,
      5,
      "x",
      [],
      { freeze_apps_list: "slack" },
      { app_nap_apps: { a: 1 } },
    ]) {
      expect(() => parseLidActionsConfig(raw)).not.toThrow();
    }
  });

  it("bundle ids are strict", () => {
    for (const ok of ["com.apple.Safari", "net.whatsapp.WhatsApp", "a-b.c1"])
      expect(isBundleId(ok)).toBe(true);
    for (const bad of [
      "",
      "single",
      "-x.y",
      "a..b",
      "a.b c",
      "a.b;c",
      "a.b\n",
      "$(x).y",
      "a/b.c",
      `com.${"x".repeat(200)}`,
    ]) {
      expect(isBundleId(bad), bad).toBe(false);
    }
  });
});

describe("parsers", () => {
  it("parsePsLine reads a table line and ignores anything else", () => {
    expect(
      parsePsLine(
        "  123     1   501 S    Tue Oct 20 09:00:00 2026 /Applications/Slack.app/Contents/MacOS/Slack",
      ),
    ).toEqual({
      pid: 123,
      ppid: 1,
      uid: 501,
      state: "S",
      start: "Tue Oct 20 09:00:00 2026",
      command: "/Applications/Slack.app/Contents/MacOS/Slack",
    });
    expect(parsePsLine("garbage")).toBeUndefined();
    expect(parsePsLine("0 1 501 S Tue Oct 20 09:00:00 2026 /x")).toBeUndefined();
  });

  it("parseBrightness reads only well-formed display lines", () => {
    expect(
      parseBrightness(
        "display 0: main, active\ndisplay 0: brightness 0.500000\ndisplay 1: brightness 1\n",
      ),
    ).toEqual([
      { index: 0, level: 0.5 },
      { index: 1, level: 1 },
    ]);
    expect(parseBrightness("display 0: brightness 7.5\nnonsense\n")).toEqual([]);
  });

  it("parseFrozen drops malformed or tampered entries (pid < 2, no start, huge command)", () => {
    const parsed = parseFrozen([
      { pid: 5, start: "s", command: "/a" },
      { pid: 1, start: "s", command: "/a" },
      { pid: 0, start: "s", command: "/a" },
      { pid: -3, start: "s", command: "/a" },
      { pid: "5", start: "s", command: "/a" },
      { pid: 6, start: "", command: "/a" },
      { pid: 7, start: "s", command: "x".repeat(5000) },
      null,
    ]);
    expect(parsed.procs).toEqual([{ pid: 5, start: "s", command: "/a" }]);
    expect(parsed.invalid).toBe(7);
  });
});

describe("real adapters, over a fake Runner", () => {
  it("the process lister throws when ps fails (so nothing is signalled from a guess)", async () => {
    const run: Runner = () => Promise.resolve({ code: 1, stdout: "", stderr: "" });
    await expect(createProcessLister(run)()).rejects.toThrow();
  });

  it("the process lister parses ps output", async () => {
    const run: Runner = (file, args) => {
      expect([file, ...args]).toEqual([
        "/usr/bin/env",
        "TZ=UTC",
        "LC_ALL=C",
        "/bin/ps",
        "-axo",
        "pid=,ppid=,uid=,state=,lstart=,comm=",
      ]);
      return Promise.resolve({
        code: 0,
        stdout: "  10   1  501 S    Tue Oct 20 09:00:00 2026 /a/b\nbad\n",
        stderr: "",
      });
    };
    expect(await createProcessLister(run)()).toEqual([
      {
        pid: 10,
        ppid: 1,
        uid: 501,
        state: "S",
        start: "Tue Oct 20 09:00:00 2026",
        command: "/a/b",
      },
    ]);
  });

  const PROFILER = JSON.stringify({
    SPAudioDataType: [
      {
        _items: [
          { _name: "Studio Display", coreaudio_default_audio_output_device: "spaudio_yes" },
          { _name: "MacBook Microphone", coreaudio_default_audio_input_device: "spaudio_yes" },
        ],
      },
    ],
  });

  it("the osascript audio adapter runs only constant scripts, for the default output only, and reads its name read-only", async () => {
    const seen: string[] = [];
    const run: Runner = (file, args) => {
      seen.push([file, ...args].join(" "));
      return Promise.resolve(
        file === "/usr/sbin/system_profiler"
          ? { code: 0, stdout: PROFILER, stderr: "" }
          : { code: 0, stdout: "false\n", stderr: "" },
      );
    };
    const audio = createOsascriptAudio(run);
    expect(await audio.listOutputs()).toEqual([
      { id: DEFAULT_OUTPUT_ID, muted: false, name: "Studio Display" },
    ]);
    await audio.setMuted(DEFAULT_OUTPUT_ID, true);
    await audio.setMuted(DEFAULT_OUTPUT_ID, false);
    await expect(audio.setMuted("headphones", true)).rejects.toThrow();
    expect(seen).toEqual([
      "/usr/bin/osascript -e output muted of (get volume settings)",
      "/usr/sbin/system_profiler SPAudioDataType -json",
      "/usr/bin/osascript -e set volume output muted true",
      "/usr/bin/osascript -e set volume output muted false",
    ]);
  });

  it("the device name is never put into a script, and an unreadable name is null (identity unknown)", async () => {
    const evil = JSON.stringify({
      SPAudioDataType: [
        {
          _items: [
            {
              _name: 'x" & do shell script "id',
              coreaudio_default_audio_output_device: "spaudio_yes",
            },
          ],
        },
      ],
    });
    const run: Runner = (file) =>
      Promise.resolve(
        file === "/usr/sbin/system_profiler"
          ? { code: 0, stdout: evil, stderr: "" }
          : { code: 0, stdout: "false\n", stderr: "" },
      );
    // A quote-bearing name is still plain ASCII text here: it is only ever compared, never run.
    const [device] = await createOsascriptAudio(run).listOutputs();
    expect(device?.name).toBe('x" & do shell script "id');
    const broken: Runner = (file) =>
      Promise.resolve(
        file === "/usr/sbin/system_profiler"
          ? { code: 1, stdout: "", stderr: "" }
          : { code: 0, stdout: "false\n", stderr: "" },
      );
    expect((await createOsascriptAudio(broken).listOutputs())[0]?.name).toBeNull();
    expect(parseDefaultOutputName("not json")).toBeNull();
    expect(
      parseDefaultOutputName(JSON.stringify({ SPAudioDataType: [{ _items: [] }] })),
    ).toBeNull();
  });

  it("an output without a mute control reads as unknown, and a failing osascript as no outputs", async () => {
    const missing: Runner = (file) =>
      Promise.resolve({
        code: 0,
        stdout: file === "/usr/sbin/system_profiler" ? PROFILER : "missing value\n",
        stderr: "",
      });
    expect(await createOsascriptAudio(missing).listOutputs()).toEqual([
      { id: DEFAULT_OUTPUT_ID, muted: null, name: "Studio Display" },
    ]);
    const failing: Runner = () => Promise.resolve({ code: 1, stdout: "", stderr: "" });
    expect(await createOsascriptAudio(failing).listOutputs()).toEqual([]);
    expect(await createOsascriptAudio(failing).defaultOutputId()).toBeNull();
  });

  it("the real signaler refuses pid 0, 1, negative, fractional, NaN and Phoenix's own pid BEFORE any kill", () => {
    for (const pid of [0, 1, -1, -2, 1.5, Number.NaN, process.pid]) {
      expect(() => realSignaler(pid, "SIGSTOP"), String(pid)).toThrow();
    }
  });
});

describe("activity tracking (protected state and agent pids)", () => {
  const publish = (feed: FakeFeed, type: string, payload: Record<string, unknown> = {}) =>
    feed.publish(type, payload);

  it("is unknown without a feed (fails closed)", () => {
    const a = trackActivity(undefined, new FakeClock());
    expect(a.protectedState()).toBe("unknown");
    expect(a.agentPids()).toEqual([]);
  });

  it("meeting, recording, dictation and voice make it active until their end event", async () => {
    const feed = new FakeFeed();
    const a = trackActivity(feed, new FakeClock());
    expect(a.protectedState()).toBe("idle");
    for (const [on, off] of [
      ["kage.meeting.started", "kage.meeting.ended"],
      ["notetaker.recording", "notetaker.idle"],
      ["dictation.listening", "dictation.idle"],
      ["voice.listening", "voice.idle"],
    ] as const) {
      await publish(feed, on);
      expect(a.protectedState(), on).toBe("active");
      await publish(feed, off);
      expect(a.protectedState(), off).toBe("idle");
    }
  });

  it("a lost end event of a short activity (dictation) stops counting after three hours", async () => {
    const feed = new FakeFeed();
    const clock = new FakeClock();
    const a = trackActivity(feed, clock);
    await publish(feed, "dictation.listening");
    clock.current += 3 * 60 * 60_000 - 1;
    expect(a.protectedState()).toBe("active");
    clock.current += 2;
    expect(a.protectedState()).toBe("idle");
  });

  it("collects the pids of live agents and forgets finished ones; ignores bad pids", async () => {
    const feed = new FakeFeed();
    const a = trackActivity(feed, new FakeClock());
    await publish(feed, "agent.working", { agent_id: "a1", pid: 500 });
    await publish(feed, "agent.working", { agent_id: "a2", pid: 501 });
    await publish(feed, "agent.working", { agent_id: "a3", pid: 1 });
    await publish(feed, "agent.working", { agent_id: "a4", pid: "7" });
    expect([...a.agentPids()].sort()).toEqual([500, 501]);
    await publish(feed, "agent.completed", { agent_id: "a1" });
    expect(a.agentPids()).toEqual([501]);
    a.stop();
    expect(feed.subscribers).toBe(0);
  });
});
