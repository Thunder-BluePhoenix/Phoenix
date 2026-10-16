// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The botless notetaker session manager (Phase 65): the rules that make "no recording nobody saw,
// and the audio never touches the disk" true in code. Modelled on the dictation session manager.
//
//   * OFF by default; `start` refuses until the user turned it on, and in EVERY start request the
//     caller must pass `consent: true` AND `notice_acknowledged: true` (told everyone on the call).
//   * ONE active session (never queued, never replaced). Wall-clock limit `maxSeconds` (4 h).
//   * Frames: `[channel][int16 LE mono 16 kHz PCM]`, channel 1 = microphone ("You"), 2 = system audio
//     ("Others"). At most `maxFrameBytes` (1 MiB) per frame, no faster than `maxRateFactor` times real
//     time per channel. Going over ENDS the session (fail closed); nothing is silently cut off.
//   * PCM lives only in this object's memory, buffered per channel, and is transcribed in fixed
//     windows through the `SpeechRecognizer` seam. Every window's samples are ZEROED right after its
//     text is produced (or the attempt failed). On EVERY way out - stop, abort, a limit, the kill
//     switch, the feature switched off, the socket closing, a recogniser failure - every buffer that
//     is still held is zeroed. Whatever was already transcribed stays (it was handed to `onSegment`).
//   * `onRecording(true|false)` brackets the WHOLE capture, so every view can show RECORDING while
//     (and only while) audio can still arrive.
//   * Only ids, counts and reasons go to the audit hook; never audio, never text.
import {
  SAMPLE_RATE,
  type RecognizerSession,
  type SpeechRecognizer,
} from "../dictation/recognizer";
import { realTimers, type Timers } from "../dictation/sessions";
import { DictationError, hasHiddenCharacters, normaliseText } from "../dictation/text";

export const NOTETAKER_LIMITS = {
  /** 4 hours of wall-clock time. */
  maxSeconds: 4 * 60 * 60,
  /** One frame including its 1-byte channel prefix. */
  maxFrameBytes: 1024 * 1024,
  /** Audio may arrive at most this many times faster than real time per channel (plus a burst). */
  maxRateFactor: 2,
  burstSeconds: 2,
  /** Seconds of audio transcribed at once. */
  windowSeconds: 30,
  /** Windows waiting for the recogniser, per channel, before the session is ended (the recogniser cannot keep up). */
  maxPendingWindows: 4,
  maxTitleChars: 120,
  /** At most this many starts a minute. */
  maxStarts: 10,
  startWindowMs: 60_000,
} as const;

export const NOTETAKER_SESSION_ID = /^ntk_[0-9a-f]{32}$/u;

export const CHANNELS = { 1: "You", 2: "Others" } as const;
export type ChannelId = keyof typeof CHANNELS;
export type Speaker = (typeof CHANNELS)[ChannelId];

export type NotetakerEndReason =
  | "stopped"
  | "aborted"
  | "disabled"
  | "kill_switch"
  | "max_length"
  | "too_fast"
  | "bad_frame"
  | "falling_behind"
  | "connection_closed"
  | "recogniser_failed"
  | "shutdown";

const REASON_TEXT: Record<NotetakerEndReason, string> = {
  stopped: "The recording already stopped",
  aborted: "The recording was cancelled",
  disabled: "The notetaker was switched off",
  kill_switch: "The emergency stop is engaged",
  max_length: "The recording reached the maximum length of 4 hours",
  too_fast: "Audio arrived faster than a microphone can produce it",
  bad_frame: "An invalid audio frame was received",
  falling_behind: "Speech recognition could not keep up with the audio",
  connection_closed: "The audio connection closed before the recording was stopped",
  recogniser_failed: "Speech recognition failed",
  shutdown: "Phoenix Core is stopping",
};

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  speaker: Speaker;
  text: string;
}

export interface NotetakerStartInput {
  title?: string | undefined;
  consent: boolean;
  notice_acknowledged: boolean;
}

export interface NotetakerSessionDeps {
  recognizer: SpeechRecognizer;
  enabled: () => boolean;
  killSwitchEngaged: () => boolean;
  /** Brackets the whole capture. Must not throw (the manager contains it anyway). */
  onRecording: (recording: boolean, sessionId: string) => void;
  /** A new session exists (the meeting record can be opened). */
  onStarted: (info: { id: string; title: string | null; startedAtMs: number }) => void;
  /** Text of one transcribed window. Called in order of completion; the writer stores it at once. */
  onSegment: (id: string, segment: TranscriptSegment) => void;
  /** The session is over for any reason. `completed` only after a normal stop. */
  onEnded: (info: {
    id: string;
    reason: NotetakerEndReason;
    completed: boolean;
    startedAtMs: number;
    endedAtMs: number;
  }) => void;
  /** Audit hook: ids, counts and reasons only. */
  audit: (
    action: "notetaker.start" | "notetaker.stop" | "notetaker.abort",
    details: Record<string, unknown>,
  ) => void;
  timers?: Timers;
  now?: () => number;
  newId?: () => string;
  /** Samples per window (tests make it small). Default: 30 s. */
  windowSamples?: number;
}

export interface NotetakerStarted {
  id: string;
  max_seconds: number;
  max_frame_bytes: number;
  window_seconds: number;
}

export interface NotetakerStopResult {
  id: string;
  windows: number;
  segments: number;
  duration_seconds: number;
}

interface Window {
  channel: ChannelId;
  chunks: Int16Array[];
  recognizer: RecognizerSession | null;
}

interface ChannelBuffer {
  chunks: Int16Array[];
  samples: number;
  /** Samples of this channel already cut into windows: where the next window starts. */
  cut: number;
  /** Samples ever received on this channel (for the rate limit). */
  received: number;
}

interface Live {
  id: string;
  startedAt: number;
  buffers: Record<ChannelId, ChannelBuffer>;
  windows: Set<Window>;
  queue: Promise<void>;
  windowsDone: number;
  segments: number;
  streamTaken: boolean;
  onStreamEnded: ((reason: NotetakerEndReason) => void) | null;
  audioEnded: boolean;
  stopping: boolean;
  stopTimer: () => void;
  abort: AbortController;
}

export interface NotetakerStream {
  /** One binary frame: channel byte + PCM. Throws DictationError and ends the session on misuse. */
  push(frame: Uint8Array): void;
  /** The client ended the audio: no more frames; the session waits for `stop`. */
  end(): void;
  /** The connection went away. Aborts the session unless the audio had ended properly. */
  closed(): void;
}

const emptyBuffer = (): ChannelBuffer => ({ chunks: [], samples: 0, cut: 0, received: 0 });

export class NotetakerSessions {
  private live: Live | null = null;
  private readonly tombstones: { id: string; reason: NotetakerEndReason }[] = [];
  private readonly starts: number[] = [];
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly windowSamples: number;

  constructor(private readonly d: NotetakerSessionDeps) {
    this.timers = d.timers ?? realTimers;
    this.now = d.now ?? Date.now;
    this.windowSamples = d.windowSamples ?? NOTETAKER_LIMITS.windowSeconds * SAMPLE_RATE;
  }

  active(): { id: string; started_at_ms: number } | null {
    return this.live ? { id: this.live.id, started_at_ms: this.live.startedAt } : null;
  }

  private allowed(): void {
    if (this.d.killSwitchEngaged())
      throw new DictationError("disabled", "The emergency stop is engaged");
    if (!this.d.enabled())
      throw new DictationError("disabled", "The notetaker is off. Turn it on in Settings first");
  }

  async start(input: NotetakerStartInput): Promise<NotetakerStarted> {
    this.allowed();
    if (input.consent !== true || input.notice_acknowledged !== true)
      throw new DictationError(
        "invalid",
        "Recording needs your confirmation that everyone on the call was told it is being recorded",
      );
    if (
      input.title !== undefined &&
      (typeof input.title !== "string" ||
        input.title.trim().length === 0 ||
        input.title.length > NOTETAKER_LIMITS.maxTitleChars ||
        hasHiddenCharacters(input.title))
    )
      throw new DictationError("invalid", "The title is not valid");
    if (this.live) throw new DictationError("busy", "A recording is already in progress");
    const now = this.now();
    while (this.starts.length > 0 && now - this.starts[0]! >= NOTETAKER_LIMITS.startWindowMs)
      this.starts.shift();
    if (this.starts.length >= NOTETAKER_LIMITS.maxStarts)
      throw new DictationError("limit", "Too many recordings started; wait a moment");
    this.starts.push(now);
    const availability = await this.d.recognizer.availability();
    // Re-check after the await: another start, the kill switch or a settings change may have won.
    this.allowed();
    if (this.live) throw new DictationError("busy", "A recording is already in progress");
    if (!availability.available) throw new DictationError("unavailable", availability.detail);
    const id = this.d.newId?.() ?? `ntk_${crypto.randomUUID().replaceAll("-", "")}`;
    const live: Live = {
      id,
      startedAt: this.now(),
      buffers: { 1: emptyBuffer(), 2: emptyBuffer() },
      windows: new Set(),
      queue: Promise.resolve(),
      windowsDone: 0,
      segments: 0,
      streamTaken: false,
      onStreamEnded: null,
      audioEnded: false,
      stopping: false,
      stopTimer: this.timers.after(
        () => this.end(id, "max_length"),
        NOTETAKER_LIMITS.maxSeconds * 1000,
      ),
      abort: new AbortController(),
    };
    this.live = live;
    try {
      this.d.onStarted({ id, title: input.title?.trim() ?? null, startedAtMs: live.startedAt });
    } catch {
      this.end(id, "recogniser_failed");
      throw new DictationError("unavailable", "The meeting record could not be opened");
    }
    this.recording(true, id);
    this.d.audit("notetaker.start", { session: id, consent: true, notice_acknowledged: true });
    return {
      id,
      max_seconds: NOTETAKER_LIMITS.maxSeconds,
      max_frame_bytes: NOTETAKER_LIMITS.maxFrameBytes,
      window_seconds: NOTETAKER_LIMITS.windowSeconds,
    };
  }

  /** True when the session exists, still takes audio and nobody has opened its stream yet. */
  streamAvailable(id: string): boolean {
    const live = this.live;
    return !!live && live.id === id && !live.audioEnded && !live.streamTaken;
  }

  /** Single use: the second call for a session throws. */
  openStream(id: string, onEnded: (reason: NotetakerEndReason) => void): NotetakerStream {
    const live = this.live;
    if (!live || live.id !== id) throw new DictationError("not_found", "No such recording");
    if (live.audioEnded || live.streamTaken)
      throw new DictationError("busy", "The audio stream of this recording was already used");
    live.streamTaken = true;
    live.onStreamEnded = onEnded;
    return {
      push: (frame) => this.push(id, frame),
      end: () => {
        if (this.live?.id === id) this.stopAudio(this.live);
      },
      closed: () => {
        const current = this.live;
        if (current?.id === id && !current.audioEnded) this.end(id, "connection_closed");
      },
    };
  }

  private push(id: string, frame: Uint8Array): void {
    const live = this.live;
    if (!live || live.id !== id) throw new DictationError("not_found", "No such recording");
    const refuse = (reason: NotetakerEndReason): never => {
      this.end(id, reason);
      throw new DictationError("limit", REASON_TEXT[reason]);
    };
    if (this.d.killSwitchEngaged()) return refuse("kill_switch");
    if (!this.d.enabled()) return refuse("disabled");
    // A frame already in flight when the client ended the audio is dropped; it does not kill a
    // recording whose audio is complete.
    if (live.audioEnded)
      throw new DictationError("invalid", "Audio arrived after the recording ended");
    const channel = frame[0];
    if (
      (channel !== 1 && channel !== 2) ||
      frame.byteLength < 3 ||
      (frame.byteLength - 1) % 2 !== 0 ||
      frame.byteLength > NOTETAKER_LIMITS.maxFrameBytes
    )
      return refuse("bad_frame");
    const buffer = live.buffers[channel];
    const samples = (frame.byteLength - 1) / 2;
    const elapsedS = Math.max(0, (this.now() - live.startedAt) / 1000);
    const allowedSamples =
      (elapsedS * NOTETAKER_LIMITS.maxRateFactor + NOTETAKER_LIMITS.burstSeconds) * SAMPLE_RATE;
    if (buffer.received + samples > allowedSamples) return refuse("too_fast");
    if (live.windows.size >= NOTETAKER_LIMITS.maxPendingWindows * 2)
      return refuse("falling_behind");
    // A copy the manager owns (the caller's buffer is the caller's to wipe), 16-bit little endian.
    const own = new Int16Array(samples);
    new Uint8Array(own.buffer).set(frame.subarray(1));
    buffer.chunks.push(own);
    buffer.samples += samples;
    buffer.received += samples;
    while (buffer.samples >= this.windowSamples) this.cutWindow(live, channel, this.windowSamples);
  }

  /** Moves up to `samples` samples of a channel into a window and queues its transcription. */
  private cutWindow(live: Live, channel: ChannelId, samples: number): void {
    const buffer = live.buffers[channel];
    const take: Int16Array[] = [];
    let need = Math.min(samples, buffer.samples);
    while (need > 0) {
      const head = buffer.chunks[0]!;
      if (head.length <= need) {
        take.push(head);
        buffer.chunks.shift();
        need -= head.length;
      } else {
        // Split the chunk: both halves stay manager-owned, so both get zeroed in their turn.
        take.push(head.slice(0, need));
        const rest = head.slice(need);
        head.fill(0);
        buffer.chunks[0] = rest;
        need = 0;
      }
    }
    const count = take.reduce((n, c) => n + c.length, 0);
    buffer.samples -= count;
    const startMs = Math.round((buffer.cut / SAMPLE_RATE) * 1000);
    buffer.cut += count;
    const endMs = Math.round((buffer.cut / SAMPLE_RATE) * 1000);
    const win: Window = { channel, chunks: take, recognizer: null };
    live.windows.add(win);
    live.queue = live.queue.then(() => this.transcribe(live, win, startMs, endMs));
  }

  /** One window: recognise, hand the text over, and zero the samples whatever happened. */
  private async transcribe(live: Live, win: Window, startMs: number, endMs: number): Promise<void> {
    try {
      if (this.live !== live) return;
      const session = this.d.recognizer.start();
      win.recognizer = session;
      for (const chunk of win.chunks) session.push(chunk);
      // Raced with the abort signal: a recogniser that ignores `cancel` cannot keep us waiting.
      const aborted = Promise.withResolvers<never>();
      const onAbort = () => aborted.reject(new Error("aborted"));
      live.abort.signal.addEventListener("abort", onAbort, { once: true });
      let text: string;
      try {
        text = (await Promise.race([session.finish(), aborted.promise])).text;
      } finally {
        live.abort.signal.removeEventListener("abort", onAbort);
      }
      // The audio is no longer needed once the recogniser answered.
      this.wipeWindow(live, win);
      if (this.live !== live) return;
      const clean = normaliseText(text);
      live.windowsDone++;
      if (clean.length > 0) {
        live.segments++;
        this.d.onSegment(live.id, {
          start_ms: startMs,
          end_ms: endMs,
          speaker: CHANNELS[win.channel],
          text: clean,
        });
      }
    } catch {
      this.wipeWindow(live, win);
      if (this.live === live) this.end(live.id, "recogniser_failed");
    } finally {
      this.wipeWindow(live, win);
    }
  }

  private wipeWindow(live: Live, win: Window): void {
    for (const chunk of win.chunks) chunk.fill(0);
    win.chunks.length = 0;
    win.recognizer = null;
    live.windows.delete(win);
  }

  /** Audio is over (end frame or stop): the capture indicator can go once the audio is in. */
  private stopAudio(live: Live): void {
    if (live.audioEnded) return;
    live.audioEnded = true;
    live.stopTimer();
    live.stopTimer = () => {};
    this.recording(false, live.id);
  }

  /**
   * Ends the recording normally: the rest of the audio is transcribed (then zeroed) and the
   * session completes. Refused for a session that already ended.
   */
  async stop(id: string): Promise<NotetakerStopResult> {
    const live = this.live;
    if (!live || live.id !== id) {
      const dead = this.tombstones.find((t) => t.id === id);
      if (dead) throw new DictationError("aborted", REASON_TEXT[dead.reason]);
      throw new DictationError("not_found", "No such recording");
    }
    if (live.stopping) throw new DictationError("busy", "This recording is already stopping");
    live.stopping = true;
    this.stopAudio(live);
    for (const channel of [1, 2] as const) {
      const buffer = live.buffers[channel];
      if (buffer.samples > 0) this.cutWindow(live, channel, buffer.samples);
    }
    await live.queue;
    if (this.live !== live) {
      throw new DictationError("aborted", REASON_TEXT[this.reasonOf(id) ?? "aborted"]);
    }
    const result: NotetakerStopResult = {
      id,
      windows: live.windowsDone,
      segments: live.segments,
      duration_seconds: Math.max(0, Math.round((this.now() - live.startedAt) / 1000)),
    };
    this.d.audit("notetaker.stop", {
      session: id,
      windows: result.windows,
      segments: result.segments,
      duration_seconds: result.duration_seconds,
    });
    this.end(id, "stopped");
    return result;
  }

  /** Cancels a recording (the user's abort). Idempotent for one that already ended. */
  cancel(id: string): void {
    if (this.live?.id !== id) {
      if (this.tombstones.some((t) => t.id === id)) return;
      throw new DictationError("not_found", "No such recording");
    }
    this.end(id, "aborted");
  }

  /** Kill switch, feature disabled, shutdown. Does nothing when idle. */
  abortAll(reason: Extract<NotetakerEndReason, "kill_switch" | "disabled" | "shutdown">): void {
    if (this.live) this.end(this.live.id, reason);
  }

  private reasonOf(id: string): NotetakerEndReason | undefined {
    return this.tombstones.find((t) => t.id === id)?.reason;
  }

  private recording(on: boolean, id: string): void {
    try {
      this.d.onRecording(on, id);
    } catch {
      // The indicator callback must never keep audio alive.
    }
  }

  /** Zeroes every buffer and window still held. Idempotent. */
  private wipe(live: Live): void {
    for (const channel of [1, 2] as const) {
      const buffer = live.buffers[channel];
      for (const chunk of buffer.chunks) chunk.fill(0);
      buffer.chunks.length = 0;
      buffer.samples = 0;
    }
    for (const win of [...live.windows]) {
      try {
        win.recognizer?.cancel();
      } catch {
        // nothing more to do for a recogniser that cannot cancel
      }
      this.wipeWindow(live, win);
    }
  }

  /** The one exit: stop timers, cancel recognisers, zero the audio, clear RECORDING, remember why. */
  private end(id: string, reason: NotetakerEndReason): void {
    const live = this.live;
    if (!live || live.id !== id) return;
    this.live = null;
    live.stopTimer();
    live.abort.abort();
    this.wipe(live);
    const notify = live.onStreamEnded;
    live.onStreamEnded = null;
    if (!live.audioEnded) {
      live.audioEnded = true;
      this.recording(false, id);
    }
    this.tombstones.push({ id, reason });
    if (this.tombstones.length > 16) this.tombstones.shift();
    if (reason !== "stopped") this.d.audit("notetaker.abort", { session: id, reason });
    try {
      this.d.onEnded({
        id,
        reason,
        completed: reason === "stopped",
        startedAtMs: live.startedAt,
        endedAtMs: this.now(),
      });
    } catch {
      // the meeting record is best effort once the audio is gone
    }
    try {
      notify?.(reason);
    } catch {
      // a stream that cannot be told is closed by its own connection
    }
  }
}
