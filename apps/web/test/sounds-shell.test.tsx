// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SoundSettingsSection } from "../src/components/SoundSettings";
import { tauriSoundsShell, type SoundsShell } from "../src/commands/sounds-shell";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { soundHostFor } from "../src/core/sounds";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

// The Rust allow-list and the asset ids as raw text, to compare them.
const RUST_SOURCE = import.meta.glob("../../desktop/src-tauri/src/sounds_folder.rs", {
  query: "?raw",
  import: "default",
  eager: true,
});
const ASSET_SOURCE = import.meta.glob("../../../pet/assets/src/sounds.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

/** A plain 16-bit mono PCM WAV of `samples` samples (what `inspectWav` accepts). */
function wav(samples: number, rate = 8000): Uint8Array {
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

class FakeShell implements SoundsShell {
  asked: string[] = [];
  files = new Map<string, Uint8Array>();
  fail = false;
  location: string | null = "/data/dev.phoenix.desktop/sounds";
  async override(id: string) {
    this.asked.push(id);
    if (this.fail) throw new Error("forbidden");
    return this.files.get(id) ?? null;
  }
  async folder() {
    if (this.fail) throw new Error("forbidden");
    return this.location;
  }
}

function setup(shell: SoundsShell | null | undefined) {
  const state = { sounds: { enabled: true, volume: 50 } };
  const api = fakeApi({
    "GET /api/ui/sounds": () => state.sounds,
    "POST /api/ui/sounds": (body: unknown) => {
      state.sounds = { ...state.sounds, ...(body as object) };
      return state.sounds;
    },
    "GET /api/notifications/preferences": () => ({
      enabled: true,
      min_severity: "warning",
      muted_sources: [],
    }),
    "GET /api/proactive": () => ({
      preferences: {
        enabled: false,
        capabilities: [],
        quietHours: null,
        maxPerHour: 3,
        cadenceMinutes: null,
      },
      source: { capability_id: "kage", available: false, mode: "manual" },
      noise: { delivered: 0, dismissed: 0, suppressed: 0, dismissalRate: 0 },
    }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const played: Uint8Array[] = [];
  const host = soundHostFor(client, {
    backend: { play: async (bytes) => void played.push(bytes) },
    shell,
    gesture: () => true,
  });
  return { client, host, played };
}

describe("the user sounds folder through the desktop shell", () => {
  it("plays a valid override from the shell instead of the built-in sound", async () => {
    const shell = new FakeShell();
    const mine = wav(800);
    shell.files.set("poke", mine);
    const t = setup(shell);
    await t.host.reload();
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(shell.asked).toEqual(["poke"]);
    expect(t.played).toHaveLength(1);
    expect([...t.played[0]!]).toEqual([...mine]);
  });

  it("asks for the sound id of the event, one of the fixed ids, never a path", async () => {
    const shell = new FakeShell();
    const t = setup(shell);
    await t.host.reload();
    for (const event of [
      "launch",
      "poke",
      "dizzy",
      "recover",
      "completion",
      "needs-you",
      "failure",
    ] as const)
      await t.host.player.trigger(event);
    expect(shell.asked.sort()).toEqual(
      ["dizzy", "error", "greet", "jump", "poke", "recover", "waiting"].sort(),
    );
    expect(shell.asked.every((id) => /^[a-z]+$/.test(id))).toBe(true);
  });

  it("still validates the bytes: garbage, too long and empty fall back to the built-in sound", async () => {
    const shell = new FakeShell();
    shell.files.set("poke", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    shell.files.set("dizzy", wav(8000 * 6)); // six seconds: over the five-second limit
    shell.files.set("jump", new Uint8Array(0));
    const t = setup(shell);
    await t.host.reload();
    for (const event of ["poke", "dizzy", "completion"] as const)
      expect(await t.host.player.trigger(event)).toBe("played");
    expect(t.played).toHaveLength(3);
    for (const bytes of t.played) {
      expect(bytes.byteLength).toBeGreaterThan(44);
      expect(shell.files.get("poke")).not.toBe(bytes);
    }
    // The built-in sound is a real WAV the shell did not supply.
    expect(t.played.every((b) => ![...shell.files.values()].includes(b))).toBe(true);
  });

  it("a shell that refuses or fails means the built-in sound plays", async () => {
    const shell = new FakeShell();
    shell.fail = true;
    const t = setup(shell);
    await t.host.reload();
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(t.played).toHaveLength(1);
  });

  it("without a shell (an ordinary browser) nothing is asked and the built-in sound plays", async () => {
    const t = setup(null);
    await t.host.reload();
    expect(await t.host.player.trigger("poke")).toBe("played");
    expect(await t.host.soundsFolder()).toBeNull();
  });

  it("an override never plays while quiet or disabled: the folder is not even read when off", async () => {
    const shell = new FakeShell();
    shell.files.set("poke", wav(800));
    const t = setup(shell);
    await t.host.reload();
    await t.host.save({ enabled: false });
    expect(await t.host.player.trigger("poke")).toBe("disabled");
    expect(shell.asked).toEqual([]);
    expect(t.played).toEqual([]);
  });

  it("a preview uses the override too", async () => {
    const shell = new FakeShell();
    const mine = wav(800);
    shell.files.set("poke", mine);
    const t = setup(shell);
    await t.host.reload();
    expect(await t.host.preview("poke", 50)).toBe("played");
    expect([...t.played[0]!]).toEqual([...mine]);
  });
});

describe("the Tauri bridge", () => {
  it("is null outside the shell", () => {
    expect(tauriSoundsShell({} as Window)).toBeNull();
    expect(tauriSoundsShell(undefined)).toBeNull();
  });

  it("calls only sound_override, with an id or nothing, and never a path", async () => {
    const calls: { command: string; args: unknown }[] = [];
    const win = {
      __TAURI__: {
        core: {
          invoke: async (command: string, args?: Record<string, unknown>) => {
            calls.push({ command, args });
            return args?.id === "poke"
              ? { folder: "/f", wav: [82, 73, 70, 70] }
              : { folder: "/f", wav: null };
          },
        },
      },
    } as unknown as Window;
    const shell = tauriSoundsShell(win)!;
    expect([...(await shell.override("poke"))!]).toEqual([82, 73, 70, 70]);
    expect(await shell.override("greet")).toBeNull();
    expect(await shell.folder()).toBe("/f");
    expect(calls).toEqual([
      { command: "sound_override", args: { id: "poke" } },
      { command: "sound_override", args: { id: "greet" } },
      { command: "sound_override", args: {} },
    ]);
  });

  it("treats a malformed answer as no override and no folder", async () => {
    for (const answer of [
      null,
      "x",
      { wav: "abc", folder: 3 },
      { wav: [1, 300] },
      { wav: [1.5] },
      {},
    ]) {
      const win = {
        __TAURI__: { core: { invoke: async () => answer } },
      } as unknown as Window;
      const shell = tauriSoundsShell(win)!;
      expect(await shell.override("poke")).toBeNull();
      expect(await shell.folder()).toBeNull();
    }
  });

  it("the three lists of sound ids agree: pet assets, the shell and the Rust allow-list", () => {
    const ids = (text: string, re: RegExp) =>
      [...(re.exec(text)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    const assets = ids(Object.values(ASSET_SOURCE)[0] ?? "", /SOUND_IDS = \[([^\]]*)\]/);
    const rust = ids(Object.values(RUST_SOURCE)[0] ?? "", /SOUND_IDS: \[&str; 7\] = \[([^\]]*)\]/);
    expect(assets).toHaveLength(7);
    expect(rust).toEqual(assets);
  });
});

describe("Settings > Fawkes sounds: the folder", () => {
  function mount(shell: SoundsShell | null) {
    const t = setup(shell);
    render(
      <CoreProvider client={t.client}>
        <SoundSettingsSection />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    return screen.getByRole("heading", { name: "Fawkes sounds" }).closest("section")!;
  }

  it("shows where the folder is in the desktop app and says the user creates it", async () => {
    const section = mount(new FakeShell());
    await waitFor(() =>
      expect(within(section).getByText(/\/data\/dev\.phoenix\.desktop\/sounds/)).toBeTruthy(),
    );
    const text = section.textContent ?? "";
    expect(text).toContain("create this folder yourself");
    expect(text).toContain("greet.wav");
    expect(text).toContain("never creates or lists");
  });

  it("in a browser says the folder is a desktop feature and shows no path", () => {
    const section = mount(null);
    expect(section.textContent).toContain("only in the Phoenix desktop app");
  });

  it("a shell that cannot say keeps the browser note", async () => {
    const shell = new FakeShell();
    shell.location = null;
    const section = mount(shell);
    await new Promise((r) => setTimeout(r, 10));
    expect(section.textContent).toContain("only in the Phoenix desktop app");
  });
});
