// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UTTERANCE_CONFIG,
  DEFAULT_VAD_CONFIG,
  EnergyVad,
  UtteranceGate,
  frameRms,
  wipeUtterance,
  type Utterance,
  type VadConfig,
} from "../../src";
import { tone } from "./helpers";

// 0.5 of full scale and 0.0 are exact in Int16: 16384 and 0.
const CONFIG: VadConfig = {
  sampleRate: 16_000,
  startRms: 0.5,
  stopRms: 0.25,
  minSpeechMs: 40,
  hangoverMs: 100,
};
const LOUD = 16384; // rms 0.5 exactly
const MID = 8192; // rms 0.25 exactly
const QUIET = 100;

describe("EnergyVad", () => {
  it("measures RMS as a fraction of full scale", () => {
    expect(frameRms(tone(10, 16384))).toBeCloseTo(0.5, 10);
    expect(frameRms(new Int16Array(0))).toBe(0);
    expect(frameRms(tone(10, -16384))).toBeCloseTo(0.5, 10);
  });

  it("stays silent on quiet audio of any length", () => {
    const vad = new EnergyVad(CONFIG);
    for (let i = 0; i < 100; i++) expect(vad.push(tone(20, QUIET)).event).toBe("none");
    expect(vad.speaking).toBe(false);
  });

  it("start threshold is inclusive: exactly startRms for minSpeechMs starts speech", () => {
    const vad = new EnergyVad(CONFIG);
    expect(vad.push(tone(20, LOUD)).event).toBe("none");
    expect(vad.push(tone(20, LOUD)).event).toBe("start");
    const below = new EnergyVad(CONFIG);
    expect(below.push(tone(40, LOUD - 4)).event).toBe("none");
    expect(below.speaking).toBe(false);
  });

  it("a click shorter than minSpeechMs, or loud audio broken by quiet, is not speech", () => {
    const vad = new EnergyVad(CONFIG);
    expect(vad.push(tone(30, LOUD)).event).toBe("none");
    expect(vad.push(tone(20, QUIET)).event).toBe("none");
    // the loud run was reset: another 30 ms is not enough either
    expect(vad.push(tone(30, LOUD)).event).toBe("none");
    expect(vad.speaking).toBe(false);
  });

  it("hysteresis: between stopRms and startRms inside speech does not end it", () => {
    const vad = new EnergyVad(CONFIG);
    vad.push(tone(40, LOUD));
    expect(vad.speaking).toBe(true);
    for (let i = 0; i < 50; i++) expect(vad.push(tone(20, MID)).event).toBe("none");
    expect(vad.speaking).toBe(true);
    // just below stopRms is quiet
    const hang = new EnergyVad(CONFIG);
    hang.push(tone(40, LOUD));
    expect(hang.push(tone(100, MID - 4)).event).toBe("end");
  });

  it("hangover: speech ends only after hangoverMs of quiet, and loud audio resets the count", () => {
    const vad = new EnergyVad(CONFIG);
    vad.push(tone(40, LOUD));
    expect(vad.push(tone(80, QUIET)).event).toBe("none");
    expect(vad.push(tone(20, LOUD)).event).toBe("none"); // resets the hangover
    expect(vad.push(tone(80, QUIET)).event).toBe("none");
    const end = vad.push(tone(20, QUIET));
    expect(end).toMatchObject({ event: "end", speaking: false });
    expect(vad.speaking).toBe(false);
    // and it can start again afterwards
    expect(vad.push(tone(40, LOUD)).event).toBe("start");
  });

  it("an empty frame changes nothing", () => {
    const vad = new EnergyVad(CONFIG);
    vad.push(tone(20, LOUD));
    expect(vad.push(new Int16Array(0))).toMatchObject({ event: "none", rms: 0 });
    expect(vad.push(tone(20, LOUD)).event).toBe("start");
  });

  it("refuses configurations that cannot work", () => {
    expect(() => new EnergyVad({ ...CONFIG, stopRms: CONFIG.startRms })).toThrow(RangeError);
    expect(() => new EnergyVad({ ...CONFIG, startRms: 0 })).toThrow(RangeError);
    expect(() => new EnergyVad({ ...CONFIG, hangoverMs: 0 })).toThrow(RangeError);
    expect(() => new EnergyVad({ ...CONFIG, sampleRate: Number.NaN })).toThrow(RangeError);
  });

  it("the defaults ignore a quiet room and catch ordinary speech", () => {
    const vad = new EnergyVad(DEFAULT_VAD_CONFIG);
    // room noise at ~0.3 % of full scale
    for (let i = 0; i < 50; i++) expect(vad.push(tone(20, 100)).event).toBe("none");
    // speech at ~6 % of full scale
    let started = false;
    for (let i = 0; i < 10; i++) started ||= vad.push(tone(20, 2000)).event === "start";
    expect(started).toBe(true);
  });
});

const GATE = {
  vad: CONFIG,
  preRollMs: 40,
  maxUtteranceMs: 400,
};

describe("UtteranceGate", () => {
  function gate(config = GATE) {
    const utterances: Utterance[] = [];
    const g = new UtteranceGate((u) => utterances.push(u), config);
    return { g, utterances };
  }

  it("emits nothing for silence and one utterance, with pre-roll, for speech", () => {
    const { g, utterances } = gate();
    for (let i = 0; i < 10; i++) g.push(tone(20, QUIET));
    expect(utterances).toHaveLength(0);
    g.push(tone(20, 7)); // pre-roll marker
    g.push(tone(20, LOUD));
    g.push(tone(20, LOUD)); // VAD fires here
    g.push(tone(20, LOUD));
    for (let i = 0; i < 5; i++) g.push(tone(20, QUIET));
    expect(utterances).toHaveLength(1);
    const first = utterances[0]!.chunks.flatMap((c) => [...c]);
    // the ring held the last 40 ms before the trigger frame: the marker then the first loud frame
    expect(first.slice(0, 320).every((s) => s === 7)).toBe(true);
    expect(first[320]).toBe(LOUD);
    expect(utterances[0]!.reason).toBe("silence");
    expect(utterances[0]!.samples).toBe(first.length);
  });

  it("caps an utterance's length and ends it", () => {
    const { g, utterances } = gate();
    for (let i = 0; i < 40; i++) g.push(tone(20, LOUD));
    expect(utterances.length).toBeGreaterThanOrEqual(1);
    expect(utterances[0]!.reason).toBe("max_length");
    expect(utterances[0]!.samples).toBeLessThanOrEqual(16 * 400 + 16 * 40);
  });

  it("zeroes the ring and any partial utterance on stop()", () => {
    const { g, utterances } = gate();
    const ring = (g as unknown as { ring: Int16Array }).ring;
    g.push(tone(20, 123));
    expect(ring.some((s) => s === 123)).toBe(true);
    g.stop();
    expect(ring.every((s) => s === 0)).toBe(true);

    // a partial utterance: the chunks the gate holds are zeroed by stop()
    g.push(tone(20, LOUD));
    g.push(tone(20, LOUD));
    g.push(tone(20, LOUD));
    const held = (g as unknown as { chunks: Int16Array[] }).chunks.slice();
    expect(held.length).toBeGreaterThan(0);
    expect(held.some((c) => c.some((s) => s !== 0))).toBe(true);
    g.stop();
    expect(held.every((c) => c.every((s) => s === 0))).toBe(true);
    expect(g.speaking).toBe(false);
    expect(utterances).toHaveLength(0);
  });

  it("zeroes the ring the moment it moves into an utterance, and the gate never keeps the caller's frame", () => {
    const { g } = gate();
    const frame = tone(20, 55);
    g.push(frame);
    const ring = (g as unknown as { ring: Int16Array }).ring;
    g.push(tone(20, LOUD));
    g.push(tone(20, LOUD));
    expect(ring.every((s) => s === 0)).toBe(true);
    frame.fill(0);
    // the pre-roll copy was independent of the caller's array
    const chunks = (g as unknown as { chunks: Int16Array[] }).chunks;
    expect(chunks[0]!.some((s) => s === 55)).toBe(true);
  });

  it("zeroes the utterance when the consumer throws, and wipeUtterance is idempotent", () => {
    let seen: Utterance | undefined;
    const g = new UtteranceGate((u) => {
      seen = u;
      throw new Error("consumer failed");
    }, GATE);
    g.push(tone(20, LOUD));
    g.push(tone(20, LOUD));
    for (let i = 0; i < 6; i++) g.push(tone(20, QUIET));
    expect(seen).toBeDefined();
    expect(seen!.chunks).toHaveLength(0);
    wipeUtterance(seen!);
    wipeUtterance(seen!);
  });

  it("refuses a pre-roll shorter than the VAD onset", () => {
    expect(() => new UtteranceGate(() => {}, { ...GATE, preRollMs: 10 })).toThrow(RangeError);
    expect(DEFAULT_UTTERANCE_CONFIG.preRollMs).toBeGreaterThanOrEqual(
      DEFAULT_UTTERANCE_CONFIG.vad.minSpeechMs,
    );
  });
});
