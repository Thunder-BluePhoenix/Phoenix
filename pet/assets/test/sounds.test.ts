// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  encodeWav,
  inspectWav,
  MAX_OVERRIDE_BYTES,
  renderPcm,
  SOUND_EVENT_TABLE,
  SOUND_EVENTS,
  SOUND_IDS,
  SOUNDS,
  synthesize,
} from "../src";

describe("synthesised sounds", () => {
  it.each(SOUND_IDS)("%s renders a short, non-silent, unclipped, deterministic WAV", (id) => {
    const pcm = renderPcm(SOUNDS[id]);
    expect(pcm.length / 22_050).toBeLessThan(1.5);
    const peak = pcm.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(2_000);
    expect(peak).toBeLessThan(32_767 * 0.6);
    expect(pcm[0]).toBe(0); // starts at zero: no click
    expect(synthesize(id)).toEqual(synthesize(id));
    const wav = synthesize(id);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(inspectWav(wav)).toMatchObject({ channels: 1, bitsPerSample: 16, sampleRate: 22_050 });
  });

  it("every sound differs from every other", () => {
    const hashes = SOUND_IDS.map((id) => Array.from(synthesize(id)).join(","));
    expect(new Set(hashes).size).toBe(SOUND_IDS.length);
  });

  it("every sound event maps to a built-in sound", () => {
    expect(Object.keys(SOUND_EVENT_TABLE).sort()).toEqual([...SOUND_EVENTS].sort());
    for (const id of Object.values(SOUND_EVENT_TABLE)) expect(SOUND_IDS).toContain(id);
  });
});

describe("inspectWav (user overrides)", () => {
  const good = encodeWav(new Int16Array(2_000));

  it("accepts plain PCM WAV", () => {
    expect(inspectWav(good)).not.toBeNull();
  });

  it("rejects garbage, truncation, oversize, non-PCM and over-long audio", () => {
    expect(inspectWav(new Uint8Array(10))).toBeNull();
    expect(inspectWav(new Uint8Array(200))).toBeNull();
    expect(inspectWav(good.subarray(0, 30))).toBeNull();
    expect(inspectWav(new Uint8Array(MAX_OVERRIDE_BYTES + 1))).toBeNull();
    const compressed = good.slice();
    new DataView(compressed.buffer).setUint16(20, 3, true);
    expect(inspectWav(compressed)).toBeNull();
    expect(inspectWav(encodeWav(new Int16Array(22_050 * 6)))).toBeNull();
    const empty = encodeWav(new Int16Array(0));
    expect(inspectWav(empty)).toBeNull();
  });
});
