// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
/// <reference lib="dom" />
import {
  CaptureUnavailableError,
  type CaptureDriver,
  type CaptureKind,
  type CapturedInput,
} from "./session";

/** Browser media permission is additional to the mandatory Phoenix capability grant and confirmation. */
export class BrowserCaptureDriver implements CaptureDriver {
  async start(kind: CaptureKind, signal: AbortSignal): Promise<CapturedInput> {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      (kind === "microphone" && !navigator.mediaDevices.getUserMedia) ||
      (kind === "screen" && !navigator.mediaDevices.getDisplayMedia)
    ) {
      throw new CaptureUnavailableError(`${kind} browser capture unavailable`);
    }
    if (signal.aborted) throw new CaptureUnavailableError("Capture stopped");
    const stream =
      kind === "microphone"
        ? await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((track) => track.stop());
      signal.removeEventListener("abort", stop);
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) {
      stop();
      throw new CaptureUnavailableError("Capture stopped");
    }
    const input: CapturedInput = {
      stop,
      async read(readSignal) {
        if (stopped || readSignal.aborted) throw new CaptureUnavailableError("Capture stopped");
        if (kind === "screen") {
          const video = document.createElement("video");
          video.srcObject = stream;
          video.muted = true;
          try {
            await video.play();
            if (!video.videoWidth || !video.videoHeight)
              throw new CaptureUnavailableError("Screen frame unavailable");
            const canvas = document.createElement("canvas");
            canvas.width = Math.min(video.videoWidth, 1920);
            canvas.height = Math.min(video.videoHeight, 1080);
            canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
            const completion = Promise.withResolvers<Blob | null>();
            const abortFrame = () =>
              completion.reject(new CaptureUnavailableError("Screen frame capture stopped"));
            readSignal.addEventListener("abort", abortFrame, { once: true });
            try {
              canvas.toBlob(completion.resolve, "image/png");
              const blob = await completion.promise;
              if (!blob) throw new CaptureUnavailableError("Screen frame unavailable");
              const frame = new Uint8Array(await blob.arrayBuffer());
              if (stopped || readSignal.aborted) {
                frame.fill(0);
                throw new CaptureUnavailableError("Screen frame capture stopped");
              }
              return frame;
            } finally {
              readSignal.removeEventListener("abort", abortFrame);
              canvas.width = canvas.height = 0;
            }
          } finally {
            video.pause();
            video.srcObject = null;
          }
        }
        // Capture one second of mono PCM with the Web Audio API; whisper.cpp accepts 16-bit WAV.
        const audio = new AudioContext({ sampleRate: 16000 });
        if (audio.sampleRate !== 16000) {
          await audio.close();
          throw new CaptureUnavailableError(
            "Device cannot provide 16 kHz microphone audio for Whisper",
          );
        }
        const source = audio.createMediaStreamSource(stream);
        const processor = audio.createScriptProcessor(4096, 1, 1);
        const samples: Float32Array[] = [];
        let overrun = false;
        processor.onaudioprocess = (event) => {
          if (stopped || readSignal.aborted) return;
          if (samples.length >= 24) {
            overrun = true;
            stop();
            return;
          }
          samples.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        // ScriptProcessor requires a destination to run; a zero-gain node prevents mic playback.
        const silent = audio.createGain();
        silent.gain.value = 0;
        processor.connect(silent);
        silent.connect(audio.destination);
        try {
          const completion = Promise.withResolvers<void>();
          const timer = setTimeout(completion.resolve, 1000);
          const abortRead = () => {
            clearTimeout(timer);
            completion.reject(new CaptureUnavailableError("Microphone capture stopped"));
          };
          readSignal.addEventListener("abort", abortRead, { once: true });
          try {
            await completion.promise;
          } finally {
            clearTimeout(timer);
            readSignal.removeEventListener("abort", abortRead);
          }
          if (stopped || readSignal.aborted)
            throw new CaptureUnavailableError("Microphone capture stopped");
          if (overrun)
            throw new CaptureUnavailableError("Microphone capture exceeded buffer limit");
          const count = samples.reduce((sum, chunk) => sum + chunk.length, 0);
          if (count === 0 || count > 16000 * 5)
            throw new CaptureUnavailableError("Microphone audio unavailable");
          const wav = new Uint8Array(44 + count * 2);
          const view = new DataView(wav.buffer);
          wav.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32], 0);
          view.setUint32(4, wav.length - 8, true);
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, audio.sampleRate, true);
          view.setUint32(28, audio.sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          wav.set([100, 97, 116, 97], 36);
          view.setUint32(40, count * 2, true);
          let offset = 44;
          for (const chunk of samples)
            for (const sample of chunk) {
              view.setInt16(
                offset,
                Math.max(-32768, Math.min(32767, Math.round(sample * 32767))),
                true,
              );
              offset += 2;
            }
          return wav;
        } finally {
          processor.onaudioprocess = null;
          processor.disconnect();
          source.disconnect();
          silent.disconnect();
          for (const chunk of samples) chunk.fill(0);
          await audio.close();
        }
      },
    };
    return input;
  }
}
