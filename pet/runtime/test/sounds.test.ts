// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { encodeWav, SOUND_EVENT_TABLE, synthesize, type SoundId } from "@phoenix/pet-assets";
import { describe, expect, it } from "vitest";
import {
  createSoundPlayer,
  DEFAULT_SOUND_SETTINGS,
  inQuietHours,
  webAudioBackend,
  type AudioContextLike,
  type SoundSettings,
} from "../src";

function setup(overrides: Partial<SoundSettings> = {}, quiet = false) {
  const played: { wav: Uint8Array; volume: number }[] = [];
  const state = { settings: { ...DEFAULT_SOUND_SETTINGS, ...overrides }, quiet };
  const resolved: SoundId[] = [];
  const overrideBytes: Partial<Record<SoundId, Uint8Array | "throw">> = {};
  const player = createSoundPlayer({
    backend: {
      play: async (wav, volume) => {
        played.push({ wav, volume });
      },
    },
    settings: () => state.settings,
    isQuiet: () => state.quiet,
    resolver: {
      resolve: async (id) => {
        resolved.push(id);
        const bytes = overrideBytes[id];
        if (bytes === "throw") throw new Error("denied");
        return bytes ?? null;
      },
    },
  });
  return { player, played, state, resolved, overrideBytes };
}

describe("sound policy", () => {
  it("is off by default", async () => {
    expect(DEFAULT_SOUND_SETTINGS.enabled).toBe(false);
    const { player, played, resolved } = setup();
    expect(await player.trigger("completion")).toBe("disabled");
    expect(played).toEqual([]);
    expect(resolved).toEqual([]); // not even the sounds folder is read
  });

  it("plays the built-in sound bound to the event when enabled, at the set volume", async () => {
    const { player, played } = setup({ enabled: true, volume: 0.25 });
    expect(await player.trigger("completion")).toBe("played");
    expect(played).toHaveLength(1);
    expect(played[0]!.volume).toBe(0.25);
    expect(played[0]!.wav).toEqual(synthesize(SOUND_EVENT_TABLE.completion));
  });

  it("mute and zero volume silence everything", async () => {
    const muted = setup({ enabled: true, muted: true });
    expect(await muted.player.trigger("launch")).toBe("muted");
    const zero = setup({ enabled: true, volume: 0 });
    expect(await zero.player.trigger("launch")).toBe("silent-volume");
    const nan = setup({ enabled: true, volume: Number.NaN });
    expect(await nan.player.trigger("launch")).toBe("silent-volume");
    expect([...muted.played, ...zero.played, ...nan.played]).toEqual([]);
  });

  it("clamps volume above 1", async () => {
    const { player, played } = setup({ enabled: true, volume: 7 });
    await player.trigger("poke");
    expect(played[0]!.volume).toBe(1);
  });

  it("stays silent in quiet mode / quiet hours, and resumes after", async () => {
    const { player, played, state } = setup({ enabled: true }, true);
    expect(await player.trigger("failure")).toBe("quiet");
    expect(played).toEqual([]);
    state.quiet = false;
    expect(await player.trigger("failure")).toBe("played");
  });

  it("does not play if quiet mode begins while an override file is being read", async () => {
    const { state, played } = setup({ enabled: true });
    const gate = Promise.withResolvers<Uint8Array | null>();
    const player = createSoundPlayer({
      backend: { play: async (wav, volume) => void played.push({ wav, volume }) },
      settings: () => state.settings,
      isQuiet: () => state.quiet,
      resolver: { resolve: () => gate.promise },
    });
    const pending = player.trigger("launch");
    state.quiet = true;
    gate.resolve(null);
    expect(await pending).toBe("quiet");
    expect(played).toEqual([]);
  });
});

describe("sounds folder override", () => {
  it("uses a valid user file instead of the built-in sound", async () => {
    const { player, played, overrideBytes } = setup({ enabled: true });
    const custom = encodeWav(new Int16Array(1_000).fill(1_000));
    overrideBytes[SOUND_EVENT_TABLE.launch] = custom;
    await player.trigger("launch");
    expect(played[0]!.wav).toBe(custom);
  });

  it("falls back to the built-in sound for an invalid file or a resolver failure", async () => {
    const { player, played, overrideBytes } = setup({ enabled: true });
    overrideBytes[SOUND_EVENT_TABLE.launch] = new Uint8Array([1, 2, 3]);
    overrideBytes[SOUND_EVENT_TABLE.poke] = "throw";
    expect(await player.trigger("launch")).toBe("played");
    expect(await player.trigger("poke")).toBe("played");
    expect(played[0]!.wav).toEqual(synthesize(SOUND_EVENT_TABLE.launch));
    expect(played[1]!.wav).toEqual(synthesize(SOUND_EVENT_TABLE.poke));
  });

  it("reports a backend failure without throwing", async () => {
    const player = createSoundPlayer({
      backend: {
        play: async () => {
          throw new Error("no audio device");
        },
      },
      settings: () => ({ ...DEFAULT_SOUND_SETTINGS, enabled: true }),
      isQuiet: () => false,
    });
    expect(await player.trigger("launch")).toBe("failed");
  });
});

describe("inQuietHours", () => {
  const at = (iso: string) => Date.parse(iso);
  const night = { timezone: "UTC", start: "22:00", end: "07:00" };

  it("handles a window that wraps midnight", () => {
    expect(inQuietHours(at("2026-01-01T23:30:00Z"), night)).toBe(true);
    expect(inQuietHours(at("2026-01-01T03:00:00Z"), night)).toBe(true);
    expect(inQuietHours(at("2026-01-01T07:00:00Z"), night)).toBe(false);
    expect(inQuietHours(at("2026-01-01T12:00:00Z"), night)).toBe(false);
  });

  it("uses the configured timezone", () => {
    const tokyo = { timezone: "Asia/Tokyo", start: "09:00", end: "10:00" };
    expect(inQuietHours(at("2026-01-01T00:30:00Z"), tokyo)).toBe(true);
    expect(inQuietHours(at("2026-01-01T09:30:00Z"), tokyo)).toBe(false);
  });

  it("is never quiet without a window, and always quiet for a malformed one", () => {
    expect(inQuietHours(0, null)).toBe(false);
    expect(inQuietHours(0, { timezone: "UTC", start: "08:00", end: "08:00" })).toBe(false);
    expect(inQuietHours(0, { timezone: "UTC", start: "8am", end: "07:00" })).toBe(true);
    expect(inQuietHours(0, { timezone: "Not/AZone", start: "08:00", end: "09:00" })).toBe(true);
  });
});

describe("webAudioBackend", () => {
  it("decodes, applies the volume through a gain node, and waits for the end", async () => {
    const calls: string[] = [];
    let source: { onended: (() => void) | null } | null = null;
    const gainNode = { gain: { value: 1 }, connect: () => calls.push("gain.connect") };
    const ctx: AudioContextLike = {
      destination: "dest",
      resume: async () => void calls.push("resume"),
      decodeAudioData: async (data) => {
        calls.push(`decode:${data.byteLength}`);
        return { duration: 0.1 };
      },
      createGain: () => gainNode,
      createBufferSource: () => {
        const s = {
          buffer: null as unknown,
          onended: null as (() => void) | null,
          connect: () => calls.push("source.connect"),
          start: () => calls.push("start"),
        };
        source = s;
        return s as never;
      },
    };
    const wav = synthesize("poke");
    const done = webAudioBackend(() => ctx).play(wav, 0.4);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(gainNode.gain.value).toBe(0.4);
    expect(calls).toContain("start");
    source!.onended?.();
    await done;
    expect(calls[0]).toBe("resume");
    expect(calls).toContain(`decode:${wav.byteLength}`);
  });
});
