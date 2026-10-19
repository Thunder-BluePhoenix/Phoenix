// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Microbenchmark of the « OK Fawkes » audio gate (Phase 66): CPU milliseconds spent per second of
// 16 kHz mono audio by (a) the energy VAD alone and (b) the whole UtteranceGate (VAD + pre-roll
// ring), on deterministic synthetic audio, in 4096-sample frames (what the page's microphone
// helper delivers). CPU time is `process.cpuUsage()` (user + system), not wall time.
//
//   npx tsx scripts/bench-voice-vad.ts
//
// What this does NOT measure: the webview's microphone path (getUserMedia, the audio thread, the
// ScriptProcessor callback, Int16 conversion, the WebSocket send) or whole-app idle CPU. See
// docs/voice-assistant.md.
import { EnergyVad, UtteranceGate, wipeUtterance } from "../ai/multimodal/src/voice";

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 4096;
const SECONDS = 600; // of audio per run
const RUNS = 5;

/** A small deterministic generator (LCG): the same samples on every run and machine. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Low-level room noise: uniform noise at about 0.3 % of full scale (below the VAD's start level). */
function silence(seconds: number): Int16Array[] {
  const next = lcg(1);
  const frames: Int16Array[] = [];
  for (let n = 0; n < Math.ceil((seconds * SAMPLE_RATE) / FRAME_SAMPLES); n++) {
    const frame = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < frame.length; i++) frame[i] = Math.round((next() - 0.5) * 200);
    frames.push(frame);
  }
  return frames;
}

/** Speech-like audio: 2 s of loud modulated tone then 3 s of room noise, repeated. */
function speechLike(seconds: number): Int16Array[] {
  const next = lcg(2);
  const frames: Int16Array[] = [];
  let t = 0;
  for (let n = 0; n < Math.ceil((seconds * SAMPLE_RATE) / FRAME_SAMPLES); n++) {
    const frame = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < frame.length; i++, t++) {
      const second = (t / SAMPLE_RATE) % 5;
      frame[i] =
        second < 2
          ? Math.round(3000 * Math.sin(t * 0.07) * (0.6 + 0.4 * Math.sin(t * 0.0005)))
          : Math.round((next() - 0.5) * 200);
    }
    frames.push(frame);
  }
  return frames;
}

function cpuMs(work: () => void): number {
  const before = process.cpuUsage();
  work();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

interface Row {
  name: string;
  msPerAudioSecond: number;
  minMsPerAudioSecond: number;
  note: string;
}

function measure(name: string, frames: Int16Array[], run: (frames: Int16Array[]) => string): Row {
  run(frames.slice(0, 40)); // warm up the JIT
  const times: number[] = [];
  let note = "";
  for (let i = 0; i < RUNS; i++) times.push(cpuMs(() => void (note = run(frames))) / SECONDS);
  return {
    name,
    msPerAudioSecond: median(times),
    minMsPerAudioSecond: Math.min(...times),
    note,
  };
}

const quiet = silence(SECONDS);
const talking = speechLike(SECONDS);
const rows: Row[] = [
  measure("EnergyVad, room noise only", quiet, (frames) => {
    const vad = new EnergyVad();
    let starts = 0;
    for (const f of frames) if (vad.push(f).event === "start") starts++;
    return `${starts} utterances`;
  }),
  measure("EnergyVad, speech-like (40 % speech)", talking, (frames) => {
    const vad = new EnergyVad();
    let starts = 0;
    for (const f of frames) if (vad.push(f).event === "start") starts++;
    return `${starts} utterances`;
  }),
  measure("UtteranceGate (VAD + ring), room noise only", quiet, (frames) => {
    let utterances = 0;
    const gate = new UtteranceGate(() => void utterances++);
    for (const f of frames) gate.push(f);
    gate.stop();
    return `${utterances} utterances`;
  }),
  measure("UtteranceGate (VAD + ring), speech-like (40 % speech)", talking, (frames) => {
    let utterances = 0;
    const gate = new UtteranceGate((u) => {
      utterances++;
      wipeUtterance(u);
    });
    for (const f of frames) gate.push(f);
    gate.stop();
    return `${utterances} utterances`;
  }),
];

console.log(
  `node ${process.version} ${process.platform}/${process.arch}; ${SECONDS} s of audio per run, median of ${RUNS} runs, ${FRAME_SAMPLES}-sample frames`,
);
for (const row of rows) {
  const percent = (row.msPerAudioSecond / 1000) * 100;
  console.log(
    `${row.name.padEnd(58)} ${row.msPerAudioSecond.toFixed(4)} ms CPU per audio second (best ${row.minMsPerAudioSecond.toFixed(4)}) = ${percent.toFixed(4)} % of one core; ${row.note}`,
  );
}
