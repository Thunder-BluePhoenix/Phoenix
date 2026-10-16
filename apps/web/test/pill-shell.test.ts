// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createPcmAnalyser } from "../src/pill/analyser";
import {
  DICTATION_EVENT,
  browserOpener,
  tauriPillShell,
  type PillCommand,
} from "../src/pill/shell";

const frame = (value: number, samples = 1600) => new Int16Array(samples).fill(value);

describe("tauriPillShell", () => {
  it("is null without the Tauri globals", () => {
    expect(tauriPillShell({} as Window)).toBeNull();
    const win = { __TAURI__: { core: { invoke: vi.fn() } } } as unknown as Window;
    expect(tauriPillShell(win)).toBeNull();
  });

  it("maps to the shell commands with the exact names and arguments", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "dictation_paste" ? { pasted: "clipboard" } : undefined,
    );
    const listen = vi.fn(async () => () => {});
    const win = { __TAURI__: { core: { invoke }, event: { listen } } } as unknown as Window;
    const shell = tauriPillShell(win)!;

    expect(await shell.paste("some text")).toEqual({ pasted: "clipboard" });
    expect(invoke).toHaveBeenCalledWith("dictation_paste", { text: "some text" });
    shell.ended();
    expect(invoke).toHaveBeenCalledWith("dictation_ended");
    shell.openInPhoenix("/notetaker");
    expect(invoke).toHaveBeenCalledWith("open_in_phoenix", { route: "/notetaker" });
    shell.ready();
    expect(invoke).toHaveBeenCalledWith("pill_ready");
  });

  it("paste rejections reach the caller untouched; fire-and-forget failures are swallowed", async () => {
    const failure = { code: "secure_input", message: "A password field is focused." };
    const invoke = vi.fn(async (command: string) => {
      if (command === "dictation_paste") throw failure;
      throw new Error("denied");
    });
    const win = {
      __TAURI__: { core: { invoke }, event: { listen: vi.fn() } },
    } as unknown as Window;
    const shell = tauriPillShell(win)!;
    await expect(shell.paste("x")).rejects.toBe(failure);
    shell.ended();
    shell.ready();
    shell.openInPhoenix("/");
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(4); // and no unhandled rejection
  });

  it("onDictation listens on pill://dictation, forwards valid payloads and unsubscribes", async () => {
    const unlisten = vi.fn();
    let handler: ((e: { payload: unknown }) => void) | undefined;
    const listen = vi.fn(async (_event: string, next: (e: { payload: unknown }) => void) => {
      handler = next;
      return unlisten;
    });
    const win = {
      __TAURI__: { core: { invoke: vi.fn() }, event: { listen } },
    } as unknown as Window;
    const shell = tauriPillShell(win)!;
    const seen: PillCommand[] = [];
    const off = await shell.onDictation((command) => seen.push(command));
    expect(listen).toHaveBeenCalledWith("pill://dictation", expect.any(Function));
    expect(DICTATION_EVENT).toBe("pill://dictation");

    handler!({ payload: { action: "start", mode: "hold" } });
    handler!({ payload: { action: "stop" } });
    handler!({ payload: { action: "cancel" } });
    handler!({ payload: { action: "delete_everything" } });
    handler!({ payload: "start" });
    handler!({ payload: null });
    expect(seen).toEqual([
      { action: "start", mode: "hold" },
      { action: "stop" },
      { action: "cancel" },
    ]);

    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("onError listens on pill://error, forwards only nonempty string payloads up to 200 chars and unsubscribes", async () => {
    const unlisten = vi.fn();
    let handler: ((e: { payload: unknown }) => void) | undefined;
    const listen = vi.fn(async (_event: string, next: (e: { payload: unknown }) => void) => {
      handler = next;
      return unlisten;
    });
    const win = {
      __TAURI__: { core: { invoke: vi.fn() }, event: { listen } },
    } as unknown as Window;
    const shell = tauriPillShell(win)!;
    const seen: string[] = [];
    const off = await shell.onError((message) => seen.push(message));
    expect(listen).toHaveBeenCalledWith("pill://error", expect.any(Function));
    handler!({ payload: "Microphone permission is needed." });
    handler!({ payload: "x".repeat(200) });
    handler!({ payload: "x".repeat(201) });
    handler!({ payload: "" });
    handler!({ payload: { message: "not a string" } });
    handler!({ payload: null });
    expect(seen).toEqual(["Microphone permission is needed.", "x".repeat(200)]);
    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("browserOpener", () => {
  it("opens the hash route of the same origin in a new tab without an opener", () => {
    const open = vi.fn();
    const win = { open, location: { origin: "http://127.0.0.1:4870" } } as unknown as Window;
    browserOpener(win)("/notetaker");
    expect(open).toHaveBeenCalledWith("http://127.0.0.1:4870/#/notetaker", "_blank", "noopener");
  });

  it("swallows a blocked pop-up", () => {
    const win = {
      open: () => {
        throw new Error("blocked");
      },
      location: { origin: "http://127.0.0.1:4870" },
    } as unknown as Window;
    expect(() => browserOpener(win)("/")).not.toThrow();
  });
});

describe("createPcmAnalyser", () => {
  it("reads silence as 0 and ignores empty frames", () => {
    const analyser = createPcmAnalyser();
    analyser.push(frame(0));
    analyser.push(new Int16Array(0));
    expect(analyser.level()).toBe(0);
  });

  it("a loud frame drives the level close to 1 and never above it", () => {
    const analyser = createPcmAnalyser();
    for (let i = 0; i < 5; i++) analyser.push(frame(32767));
    expect(analyser.level()).toBeGreaterThan(0.95);
    expect(analyser.level()).toBeLessThanOrEqual(1);
  });

  it("rises with the voice and decays slower than it rises", () => {
    const analyser = createPcmAnalyser();
    analyser.push(frame(6000, 800)); // 50 ms of speech
    const risen = analyser.level();
    expect(risen).toBeGreaterThan(0.3);
    analyser.push(frame(0, 800)); // 50 ms of silence
    const decayed = analyser.level();
    expect(decayed).toBeLessThan(risen);
    expect(decayed).toBeGreaterThan(risen / 2); // slower than the attack
    for (let i = 0; i < 20; i++) analyser.push(frame(0, 800));
    expect(analyser.level()).toBeLessThan(0.01);
  });

  it("is louder for louder audio and ignores the sign of the samples", () => {
    const quiet = createPcmAnalyser();
    const loud = createPcmAnalyser();
    const negative = createPcmAnalyser();
    quiet.push(frame(500));
    loud.push(frame(5000));
    negative.push(frame(-5000));
    expect(loud.level()).toBeGreaterThan(quiet.level());
    expect(negative.level()).toBeCloseTo(loud.level(), 10);
  });

  it("the time constant depends on the audio pushed, not on a clock", () => {
    const short = createPcmAnalyser();
    const long = createPcmAnalyser();
    short.push(frame(6000, 160));
    long.push(frame(6000, 1600));
    expect(long.level()).toBeGreaterThan(short.level());
  });

  it("reset returns to silence", () => {
    const analyser = createPcmAnalyser();
    analyser.push(frame(20000));
    analyser.reset();
    expect(analyser.level()).toBe(0);
  });
});
