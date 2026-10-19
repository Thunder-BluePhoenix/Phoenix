// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The microphone seam of the "Dictate" button. `getUserMedia` is called ONLY from `start()`, which
// the button calls ONLY after the user clicked it and Core accepted the session. Audio is mono
// 16 kHz 16-bit PCM handed to `onPcm` in small frames and kept nowhere else.
//
// An AudioWorklet would need its own script file (the page's CSP is `script-src 'self'`), so this
// uses a ScriptProcessorNode like the one-shot capture does; the seam below is what tests fake.

import { translate } from "../i18n/store";

export interface DictationMicrophone {
  /** Asks the browser for the microphone and starts delivering PCM. Rejects if it is refused. */
  start(onPcm: (pcm: Int16Array) => void): Promise<void>;
  /** Stops delivery and releases the microphone (every track). Idempotent. */
  stop(): void;
}

export interface MicTrackLike {
  stop(): void;
}
export interface MicStreamLike {
  getTracks(): MicTrackLike[];
}
export interface MicMediaDevicesLike {
  getUserMedia(constraints: { audio: boolean; video: boolean }): Promise<MicStreamLike>;
}
export interface MicNodeLike {
  connect(next: unknown): unknown;
  disconnect(): void;
}
export interface MicProcessorLike extends MicNodeLike {
  onaudioprocess:
    ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null;
}
export interface MicAudioContextLike {
  readonly sampleRate: number;
  readonly destination: unknown;
  createMediaStreamSource(stream: MicStreamLike): MicNodeLike;
  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): MicProcessorLike;
  createGain(): MicNodeLike & { gain: { value: number } };
  close(): Promise<void>;
}

export interface BrowserMicrophoneDeps {
  mediaDevices: () => MicMediaDevicesLike | undefined;
  createAudioContext: (sampleRate: number) => MicAudioContextLike;
}

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 4096;

export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

/** The channel byte of a notetaker frame: 1 = your microphone ("You"), 2 = system audio ("Others"). */
export type NotetakerChannel = 1 | 2;

/** One notetaker frame: a 1-byte channel prefix, then the 16-bit little-endian PCM. */
export function withChannelPrefix(channel: NotetakerChannel, pcm: Int16Array): ArrayBuffer {
  const frame = new Uint8Array(1 + pcm.byteLength);
  frame[0] = channel;
  frame.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1);
  return frame.buffer;
}

export const browserDeps: BrowserMicrophoneDeps = {
  mediaDevices: () =>
    (typeof navigator === "undefined" ? undefined : navigator.mediaDevices) as
      MicMediaDevicesLike | undefined,
  createAudioContext: (sampleRate) =>
    new AudioContext({ sampleRate }) as unknown as MicAudioContextLike,
};

export function createBrowserMicrophone(
  deps: BrowserMicrophoneDeps = browserDeps,
): DictationMicrophone {
  let stream: MicStreamLike | null = null;
  let audio: MicAudioContextLike | null = null;
  let processor: MicProcessorLike | null = null;
  let source: MicNodeLike | null = null;
  let stopped = true;
  const stop = () => {
    stopped = true;
    if (processor) processor.onaudioprocess = null;
    for (const node of [source, processor]) {
      try {
        node?.disconnect();
      } catch {
        // already disconnected
      }
    }
    stream?.getTracks().forEach((track) => track.stop());
    void audio?.close().catch(() => {});
    stream = null;
    audio = null;
    processor = null;
    source = null;
  };
  return {
    stop,
    async start(onPcm) {
      const devices = deps.mediaDevices();
      if (!devices?.getUserMedia) throw new Error(translate("capture.mic.unsupported"));
      stopped = false;
      const granted = await devices.getUserMedia({ audio: true, video: false });
      if (stopped) {
        // Stopped while the browser prompt was open: release at once.
        granted.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = granted;
      try {
        audio = deps.createAudioContext(SAMPLE_RATE);
        if (audio.sampleRate !== SAMPLE_RATE) throw new Error(translate("capture.mic.sampleRate"));
        source = audio.createMediaStreamSource(granted);
        processor = audio.createScriptProcessor(FRAME_SAMPLES, 1, 1);
        processor.onaudioprocess = (event) => {
          if (!stopped) onPcm(floatToPcm16(event.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        // A processor only runs when connected onward; a zero-gain node keeps the mic silent.
        const silent = audio.createGain();
        silent.gain.value = 0;
        processor.connect(silent);
        silent.connect(audio.destination);
      } catch (err) {
        stop();
        throw err;
      }
    },
  };
}
