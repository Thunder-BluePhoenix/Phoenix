// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The dictation session manager: the rules that make "audio stays in memory and the microphone is
// never on without everyone seeing it" true in code.
//
//   * Dictation is OFF by default; `start` refuses until the user turned it on.
//   * ONE active session. A second `start` is refused (never queued, never replaces).
//   * Audio is bounded: a session lasts at most `maxSeconds` of wall-clock time and takes at most
//     `maxBytes` of PCM, in frames of at most `maxFrameBytes`, no faster than `maxRateFactor` times
//     real time. Going over ENDS the session (fail closed); nothing is silently cut off.
//   * PCM lives only in this object's memory. On EVERY way out - finish, cancel, a limit, the kill
//     switch, the feature being switched off, the socket closing, a recogniser failure - each chunk
//     is zeroed and the list dropped.
//   * `onListening(true|false)` brackets the WHOLE audio phase, so every view can show LISTENING
//     while (and only while) audio can still arrive.
//   * Only counts leave a session (words, audio milliseconds): never audio, never text, to the
//     stats sink.
import { isAppId } from "./stats";
import type { CleanupGenerate } from "./cleanup";
import { runPipeline, type PipelineResult } from "./pipeline";
import { BYTES_PER_SECOND, type RecognizerSession, type SpeechRecognizer } from "./recognizer";
import { modeFor, type DictationSettings } from "./settings";
import { compileVocabulary } from "./vocabulary";
import { DictationError } from "./text";

export const SESSION_LIMITS = {
  maxSeconds: 120,
  /** 120 s of 16 kHz mono 16-bit PCM. */
  maxBytes: 120 * BYTES_PER_SECOND,
  maxFrameBytes: 64 * 1024,
  /** Audio may arrive at most this many times faster than real time (plus a small burst). */
  maxRateFactor: 2,
  burstSeconds: 2,
  /** Recognition after the audio ended may take this long. */
  finishTimeoutMs: 60_000,
  /** At most this many starts in `startWindowMs`: a stuck hotkey cannot hammer the recogniser. */
  maxStarts: 30,
  startWindowMs: 60_000,
} as const;

export const SESSION_ID = /^dic_[0-9a-f]{32}$/u;

export type EndReason =
  | "finished"
  | "cancelled"
  | "disabled"
  | "kill_switch"
  | "max_length"
  | "too_much_audio"
  | "too_fast"
  | "bad_frame"
  | "connection_closed"
  | "recogniser_failed"
  | "timed_out"
  | "shutdown";

const REASON_TEXT: Record<EndReason, string> = {
  finished: "The dictation already finished",
  cancelled: "The dictation was cancelled",
  disabled: "Dictation was switched off",
  kill_switch: "The emergency stop is engaged",
  max_length: "The dictation reached the maximum length and was discarded",
  too_much_audio: "The dictation held more audio than allowed and was discarded",
  too_fast: "Audio arrived faster than a microphone can produce it and was discarded",
  bad_frame: "An invalid audio frame was received and the dictation was discarded",
  connection_closed: "The audio connection closed before the dictation ended",
  recogniser_failed: "Speech recognition failed",
  timed_out: "Speech recognition took too long",
  shutdown: "Phoenix Core is stopping",
};

export interface Timers {
  /** Schedules `fn`; the returned function cancels it. */
  after(fn: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
  after(fn, ms) {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return () => clearTimeout(handle);
  },
};

export interface FinishedSession {
  /** User-private; never put into events or audit entries. */
  app: string;
  words: number;
  speech_ms: number;
}

export interface DictationSessionDeps {
  recognizer: SpeechRecognizer;
  settings: () => DictationSettings;
  killSwitchEngaged: () => boolean;
  /** The model path for clean-up, or null when AI is off. Read on every use. */
  generate: () => CleanupGenerate | null;
  /** Brackets the audio phase. Must not throw (the manager contains it anyway). */
  onListening: (listening: boolean, sessionId: string) => void;
  onFinished: (done: FinishedSession) => void;
  /** Audit hook: ids, counts and reasons only. */
  audit: (
    action: "dictation.start" | "dictation.finish" | "dictation.abort",
    details: Record<string, unknown>,
  ) => void;
  timers?: Timers;
  now?: () => number;
  newId?: () => string;
  nonce?: () => string;
}

export interface StartedSession {
  id: string;
  max_seconds: number;
  max_bytes: number;
  max_frame_bytes: number;
}

export interface FinishResult {
  text: string;
  words: number;
  steps: PipelineResult["steps"];
}

interface Live {
  id: string;
  app: string;
  startedAt: number;
  phase: "listening" | "recognising";
  recognizer: RecognizerSession;
  chunks: Int16Array[];
  bytes: number;
  streamTaken: boolean;
  /** Told when the session ends for any reason, so a stream can close itself. */
  onEnded: ((reason: EndReason) => void) | null;
  audioEnded: boolean;
  stopTimer: () => void;
  abort: AbortController;
}

export interface DictationStream {
  /** One binary frame: 16 kHz mono 16-bit little-endian PCM. Throws DictationError and ends the session on misuse. */
  push(frame: Uint8Array): void;
  /** The client ended the audio: no more frames; the session now waits for `finish`. */
  end(): void;
  /** The connection went away. Cancels the session unless the audio had ended properly. */
  closed(): void;
}

export class DictationSessions {
  private live: Live | null = null;
  private readonly tombstones: { id: string; reason: EndReason }[] = [];
  private readonly starts: number[] = [];
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly d: DictationSessionDeps) {
    this.timers = d.timers ?? realTimers;
    this.now = d.now ?? Date.now;
  }

  active(): { id: string; phase: Live["phase"] } | null {
    return this.live ? { id: this.live.id, phase: this.live.phase } : null;
  }

  private allowed(): void {
    if (this.d.killSwitchEngaged())
      throw new DictationError("disabled", "The emergency stop is engaged");
    if (!this.d.settings().enabled)
      throw new DictationError("disabled", "Dictation is off. Turn it on in Settings first");
  }

  async start(app?: string): Promise<StartedSession> {
    this.allowed();
    if (app !== undefined && !isAppId(app))
      throw new DictationError("invalid", "The app id is not valid");
    if (this.live) throw new DictationError("busy", "A dictation is already in progress");
    const now = this.now();
    while (this.starts.length > 0 && now - this.starts[0]! >= SESSION_LIMITS.startWindowMs)
      this.starts.shift();
    if (this.starts.length >= SESSION_LIMITS.maxStarts)
      throw new DictationError("limit", "Too many dictations started; wait a moment");
    this.starts.push(now);
    const availability = await this.d.recognizer.availability();
    // Re-check after the await: another start, the kill switch or a settings change may have won.
    this.allowed();
    if (this.live) throw new DictationError("busy", "A dictation is already in progress");
    if (!availability.available) throw new DictationError("unavailable", availability.detail);
    let recognizer: RecognizerSession;
    try {
      recognizer = this.d.recognizer.start();
    } catch {
      throw new DictationError("unavailable", "The speech recogniser could not start");
    }
    const id = this.d.newId?.() ?? `dic_${crypto.randomUUID().replaceAll("-", "")}`;
    const live: Live = {
      id,
      app: app ?? "",
      startedAt: this.now(),
      phase: "listening",
      recognizer,
      chunks: [],
      bytes: 0,
      streamTaken: false,
      onEnded: null,
      audioEnded: false,
      stopTimer: this.timers.after(
        () => this.end(id, "max_length"),
        SESSION_LIMITS.maxSeconds * 1000,
      ),
      abort: new AbortController(),
    };
    this.live = live;
    this.listening(true, id);
    this.d.audit("dictation.start", { session: id });
    return {
      id,
      max_seconds: SESSION_LIMITS.maxSeconds,
      max_bytes: SESSION_LIMITS.maxBytes,
      max_frame_bytes: SESSION_LIMITS.maxFrameBytes,
    };
  }

  /** True when the session exists, is still taking audio and nobody has opened its stream yet. */
  streamAvailable(id: string): boolean {
    const live = this.live;
    return !!live && live.id === id && live.phase === "listening" && !live.streamTaken;
  }

  /** Single use: the second call for a session throws. */
  openStream(id: string, onEnded: (reason: EndReason) => void): DictationStream {
    const live = this.live;
    if (!live || live.id !== id) throw new DictationError("not_found", "No such dictation");
    if (live.phase !== "listening" || live.streamTaken)
      throw new DictationError("busy", "The audio stream of this dictation was already used");
    live.streamTaken = true;
    live.onEnded = onEnded;
    return {
      push: (frame) => this.push(id, frame),
      end: () => {
        if (this.live?.id === id && this.live.phase === "listening") this.stopAudio(this.live);
      },
      closed: () => {
        const current = this.live;
        if (current?.id === id && !current.audioEnded) this.end(id, "connection_closed");
      },
    };
  }

  private push(id: string, frame: Uint8Array): void {
    const live = this.live;
    if (!live || live.id !== id) throw new DictationError("not_found", "No such dictation");
    const refuse = (reason: EndReason, message: string): never => {
      this.end(id, reason);
      throw new DictationError("limit", message);
    };
    if (this.d.killSwitchEngaged()) return refuse("kill_switch", REASON_TEXT.kill_switch);
    if (!this.d.settings().enabled) return refuse("disabled", REASON_TEXT.disabled);
    // A frame that was already in flight when the client ended the audio is dropped; it does not
    // kill a dictation whose audio is complete.
    if (live.phase !== "listening" || live.audioEnded)
      throw new DictationError("invalid", "Audio arrived after the dictation ended");
    if (
      frame.byteLength === 0 ||
      frame.byteLength % 2 !== 0 ||
      frame.byteLength > SESSION_LIMITS.maxFrameBytes
    )
      return refuse("bad_frame", REASON_TEXT.bad_frame);
    if (live.bytes + frame.byteLength > SESSION_LIMITS.maxBytes)
      return refuse("too_much_audio", REASON_TEXT.too_much_audio);
    const elapsedS = Math.max(0, (this.now() - live.startedAt) / 1000);
    const allowedBytes =
      (elapsedS * SESSION_LIMITS.maxRateFactor + SESSION_LIMITS.burstSeconds) * BYTES_PER_SECOND;
    if (live.bytes + frame.byteLength > allowedBytes)
      return refuse("too_fast", REASON_TEXT.too_fast);
    // A copy the manager owns (the caller's buffer is the caller's to wipe), 16-bit little endian.
    const own = new Int16Array(frame.byteLength / 2);
    new Uint8Array(own.buffer).set(frame);
    live.chunks.push(own);
    live.bytes += frame.byteLength;
    live.recognizer.push(own);
  }

  /** Audio is over (end frame or finish): the microphone indicator can go; recognition may start. */
  private stopAudio(live: Live): void {
    if (live.audioEnded) return;
    live.audioEnded = true;
    live.stopTimer();
    live.stopTimer = () => {};
    this.listening(false, live.id);
  }

  async finish(id: string): Promise<FinishResult> {
    const live = this.live;
    if (!live || live.id !== id) {
      const dead = this.tombstones.find((t) => t.id === id);
      if (dead) throw new DictationError("aborted", REASON_TEXT[dead.reason]);
      throw new DictationError("not_found", "No such dictation");
    }
    if (live.phase !== "listening")
      throw new DictationError("busy", "This dictation is already being recognised");
    try {
      this.allowed();
    } catch (err) {
      this.end(id, this.d.killSwitchEngaged() ? "kill_switch" : "disabled");
      throw err;
    }
    live.phase = "recognising";
    this.stopAudio(live);
    const stopTimeout = this.timers.after(
      () => this.end(id, "timed_out"),
      SESSION_LIMITS.finishTimeoutMs,
    );
    let transcript: string;
    try {
      // Raced with the abort signal: a recogniser that ignores `cancel` cannot keep us waiting.
      const aborted = Promise.withResolvers<never>();
      const onAbort = () => aborted.reject(new Error("aborted"));
      live.abort.signal.addEventListener("abort", onAbort, { once: true });
      try {
        transcript = (await Promise.race([live.recognizer.finish(), aborted.promise])).text;
      } finally {
        live.abort.signal.removeEventListener("abort", onAbort);
      }
    } catch {
      stopTimeout();
      const stillLive = this.live?.id === id;
      const reason = this.reasonOf(id) ?? "recogniser_failed";
      if (stillLive) this.end(id, "recogniser_failed");
      throw new DictationError(
        reason === "recogniser_failed" ? "unavailable" : "aborted",
        REASON_TEXT[reason],
      );
    }
    stopTimeout();
    if (this.live?.id !== id) {
      throw new DictationError("aborted", REASON_TEXT[this.reasonOf(id) ?? "cancelled"]);
    }
    const speechMs = Math.round((live.bytes / BYTES_PER_SECOND) * 1000);
    const settings = this.d.settings();
    // The audio is no longer needed once the recogniser answered: drop it before the text work.
    const app = live.app;
    this.wipe(live);
    let result: PipelineResult;
    try {
      result = await runPipeline(transcript, {
        vocabulary: compileVocabulary(settings.vocabulary),
        mode: modeFor(settings, app || undefined),
        generate: this.d.generate(),
        signal: live.abort.signal,
        ...(this.d.nonce ? { nonce: this.d.nonce } : {}),
      });
    } catch (err) {
      this.end(id, "finished");
      throw err instanceof DictationError
        ? err
        : new DictationError("unavailable", "The text could not be processed");
    }
    if (this.live?.id !== id) {
      throw new DictationError("aborted", REASON_TEXT[this.reasonOf(id) ?? "cancelled"]);
    }
    this.end(id, "finished");
    if (result.words > 0) {
      try {
        this.d.onFinished({ app, words: result.words, speech_ms: speechMs });
      } catch {
        // Statistics are best effort: a failed write must not lose the dictation.
      }
    }
    this.d.audit("dictation.finish", { session: id, words: result.words, speech_ms: speechMs });
    return { text: result.text, words: result.words, steps: result.steps };
  }

  cancel(id: string): void {
    if (this.live?.id !== id) {
      if (this.tombstones.some((t) => t.id === id)) return;
      throw new DictationError("not_found", "No such dictation");
    }
    this.end(id, "cancelled");
  }

  /** Kill switch, feature disabled, shutdown. Does nothing when idle. */
  abortAll(reason: Extract<EndReason, "kill_switch" | "disabled" | "shutdown">): void {
    if (this.live) this.end(this.live.id, reason);
  }

  private reasonOf(id: string): EndReason | undefined {
    return this.tombstones.find((t) => t.id === id)?.reason;
  }

  private listening(on: boolean, id: string): void {
    try {
      this.d.onListening(on, id);
    } catch {
      // The indicator callback must never keep audio alive.
    }
  }

  /** Zeroes every chunk and forgets the list. Idempotent. */
  private wipe(live: Live): void {
    for (const chunk of live.chunks) chunk.fill(0);
    live.chunks.length = 0;
  }

  /** The one exit: stop timers, cancel the recogniser, zero the audio, publish idle, remember why. */
  private end(id: string, reason: EndReason): void {
    const live = this.live;
    if (!live || live.id !== id) return;
    this.live = null;
    live.stopTimer();
    live.abort.abort();
    try {
      live.recognizer.cancel();
    } catch {
      // nothing more to do for a recogniser that cannot cancel
    }
    this.wipe(live);
    const notify = live.onEnded;
    live.onEnded = null;
    if (!live.audioEnded) {
      live.audioEnded = true;
      this.listening(false, id);
    }
    this.tombstones.push({ id, reason });
    if (this.tombstones.length > 16) this.tombstones.shift();
    if (reason !== "finished") this.d.audit("dictation.abort", { session: id, reason });
    try {
      notify?.(reason);
    } catch {
      // a stream that cannot be told is closed by its own connection
    }
  }
}
