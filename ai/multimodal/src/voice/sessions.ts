// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The voice session manager ("OK Fawkes", Phase 66): the rules that make "off by default, audio
// stays in memory, the recogniser only runs after speech" true in code.
//
//   * OFF by default. `start` refuses until the user turned the assistant on; turning it off or
//     engaging the kill switch ENDS the session at once (not at the next frame).
//   * ONE session. A second `start` is refused.
//   * VAD first: every frame meets the energy gate (utterance.ts). The recogniser is started only
//     for an utterance the gate cut out, so a quiet room costs one energy check per frame.
//   * Wake phrase: the utterance's text is matched against "OK Fawkes" (wake.ts). No match: the
//     text is dropped, nothing is stored or audited beyond a count. A match opens an awake window
//     (Fawkes shows LISTENING) in which the NEXT utterance is the request; "OK Fawkes, <request>" in
//     one breath is also accepted.
//   * Audio is bounded (frame size, no faster than twice real time) and lives only in this object.
//     On EVERY way out - stop, a limit, the kill switch, the feature switched off, the socket
//     closing, a recogniser failure - the ring, the partial utterance and every utterance chunk are
//     zeroed and the lists dropped.
//   * Only ids, intent kinds, tool names and outcomes leave this object to the audit hook: never
//     audio, never a transcript.
import { VoiceError, type VoiceSettings } from "./settings";
import {
  BYTES_PER_SECOND,
  type RecognizerSession,
  type SpeechRecognizer,
} from "../dictation/recognizer";
import { realTimers, type Timers } from "../dictation/sessions";
import {
  dispatchRequest,
  type VoiceActions,
  type VoiceApprovals,
  type VoiceReply,
} from "./dispatch";
import {
  DEFAULT_UTTERANCE_CONFIG,
  UtteranceGate,
  wipeUtterance,
  type Utterance,
  type UtteranceConfig,
} from "./utterance";
import { matchWake } from "./wake";

export interface VoiceLimits {
  maxFrameBytes: number;
  maxRateFactor: number;
  burstSeconds: number;
  openTimeoutMs: number;
  awakeWindowMs: number;
  recogniseTimeoutMs: number;
  maxFailures: number;
  maxStarts: number;
  startWindowMs: number;
  approvalWaitMs: number;
}

export const VOICE_LIMITS: VoiceLimits = {
  maxFrameBytes: 64 * 1024,
  /** Audio may arrive at most this many times faster than real time (plus a small burst). */
  maxRateFactor: 2,
  burstSeconds: 2,
  /** The microphone page must open the stream within this long of `start`. */
  openTimeoutMs: 15_000,
  /** After the wake phrase, the request must begin within this long. */
  awakeWindowMs: 8_000,
  /** Recognition of one utterance may take this long. */
  recogniseTimeoutMs: 30_000,
  /** This many recogniser failures in a row end the session. */
  maxFailures: 3,
  maxStarts: 30,
  startWindowMs: 60_000,
  /** A tool call that waits for a person's approval is given up after this long. */
  approvalWaitMs: 60_000,
};

export const VOICE_SESSION_ID = /^voi_[0-9a-f]{32}$/u;

export type VoiceEndReason =
  | "stopped"
  | "disabled"
  | "kill_switch"
  | "bad_frame"
  | "too_fast"
  | "connection_closed"
  | "stream_not_opened"
  | "recogniser_failed"
  | "shutdown";

export type VoicePhase = "waiting" | "awake" | "thinking";

/** What the session tells the page that is streaming the microphone. */
export type VoiceStreamMessage =
  | { type: "state"; state: VoicePhase }
  | {
      type: "reply";
      text: string;
      outcome: VoiceReply["outcome"];
      intent: VoiceReply["intent"];
      action?: VoiceReply["action"];
    };

export type VoiceAuditAction =
  "voice.start" | "voice.stop" | "voice.wake" | "voice.request" | "voice.action";

export interface VoiceSessionDeps {
  recognizer: SpeechRecognizer;
  settings: () => VoiceSettings;
  killSwitchEngaged: () => boolean;
  actions: VoiceActions;
  approvals: VoiceApprovals;
  /** Brackets the awake window. Must not throw (the manager contains it anyway). */
  onAwake: (awake: boolean, sessionId: string) => void;
  /** Audit hook: ids, intent kinds, tool names, reasons and outcomes only. */
  audit: (action: VoiceAuditAction, details: Record<string, unknown>) => void;
  timers?: Timers;
  now?: () => number;
  newId?: () => string;
  utterance?: UtteranceConfig;
  limits?: Partial<VoiceLimits>;
}

export interface StartedVoiceSession {
  id: string;
}

interface Live {
  id: string;
  startedAt: number;
  bytes: number;
  phase: VoicePhase;
  awake: boolean;
  failures: number;
  gate: UtteranceGate;
  pending: Utterance | null;
  recogniser: RecognizerSession | null;
  send: ((message: VoiceStreamMessage) => void) | null;
  onEnded: ((reason: VoiceEndReason) => void) | null;
  stopAwakeTimer: () => void;
  stopOpenTimer: () => void;
  abort: AbortController;
}

export interface VoiceStream {
  /** One binary frame: 16 kHz mono 16-bit little-endian PCM. Throws VoiceError and ends the session on misuse. */
  push(frame: Uint8Array): void;
  /** The connection went away: ends the session. */
  closed(): void;
}

export class VoiceSessions {
  private live: Live | null = null;
  private readonly starts: number[] = [];
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly limits: VoiceLimits;

  constructor(private readonly d: VoiceSessionDeps) {
    this.timers = d.timers ?? realTimers;
    this.now = d.now ?? Date.now;
    this.limits = { ...VOICE_LIMITS, ...d.limits };
  }

  active(): { id: string; phase: VoicePhase } | null {
    return this.live ? { id: this.live.id, phase: this.live.phase } : null;
  }

  private allowed(): void {
    if (this.d.killSwitchEngaged())
      throw new VoiceError("disabled", "The emergency stop is engaged");
    if (!this.d.settings().enabled)
      throw new VoiceError("disabled", "The voice assistant is off. Turn it on in Settings first");
  }

  async start(): Promise<StartedVoiceSession> {
    this.allowed();
    if (this.live) throw new VoiceError("busy", "The voice assistant is already listening");
    const now = this.now();
    while (this.starts.length > 0 && now - this.starts[0]! >= this.limits.startWindowMs)
      this.starts.shift();
    if (this.starts.length >= this.limits.maxStarts)
      throw new VoiceError("limit", "Too many starts; wait a moment");
    this.starts.push(now);
    const availability = await this.d.recognizer.availability();
    // Re-check after the await: another start, the kill switch or a settings change may have won.
    this.allowed();
    if (this.live) throw new VoiceError("busy", "The voice assistant is already listening");
    if (!availability.available) throw new VoiceError("unavailable", availability.detail);
    const id = this.d.newId?.() ?? `voi_${crypto.randomUUID().replaceAll("-", "")}`;
    const live: Live = {
      id,
      startedAt: this.now(),
      bytes: 0,
      phase: "waiting",
      awake: false,
      failures: 0,
      gate: new UtteranceGate(
        (utterance) => this.onUtterance(id, utterance),
        this.d.utterance ?? DEFAULT_UTTERANCE_CONFIG,
      ),
      pending: null,
      recogniser: null,
      send: null,
      onEnded: null,
      stopAwakeTimer: () => {},
      stopOpenTimer: this.timers.after(
        () => this.end(id, "stream_not_opened"),
        this.limits.openTimeoutMs,
      ),
      abort: new AbortController(),
    };
    this.live = live;
    this.d.audit("voice.start", { session: id });
    return { id };
  }

  /** True when the session exists and nobody has opened its stream yet. */
  streamAvailable(id: string): boolean {
    return this.live?.id === id && this.live.send === null;
  }

  /** Single use. `send` carries replies and state to the page; it must not throw. */
  openStream(
    id: string,
    send: (message: VoiceStreamMessage) => void,
    onEnded: (reason: VoiceEndReason) => void,
  ): VoiceStream {
    const live = this.live;
    if (!live || live.id !== id) throw new VoiceError("not_found", "No such voice session");
    if (live.send)
      throw new VoiceError("busy", "The audio stream of this session was already used");
    live.send = send;
    live.onEnded = onEnded;
    live.stopOpenTimer();
    live.stopOpenTimer = () => {};
    return {
      push: (frame) => this.push(id, frame),
      closed: () => this.end(id, "connection_closed"),
    };
  }

  private push(id: string, frame: Uint8Array): void {
    const live = this.live;
    if (!live || live.id !== id) throw new VoiceError("not_found", "No such voice session");
    const refuse = (reason: VoiceEndReason, message: string): never => {
      this.end(id, reason);
      throw new VoiceError("limit", message);
    };
    if (this.d.killSwitchEngaged()) return refuse("kill_switch", "The emergency stop is engaged");
    if (!this.d.settings().enabled)
      return refuse("disabled", "The voice assistant was switched off");
    if (
      frame.byteLength === 0 ||
      frame.byteLength % 2 !== 0 ||
      frame.byteLength > this.limits.maxFrameBytes
    )
      return refuse("bad_frame", "An invalid audio frame was received");
    const elapsedS = Math.max(0, (this.now() - live.startedAt) / 1000);
    const allowed =
      (elapsedS * this.limits.maxRateFactor + this.limits.burstSeconds) * BYTES_PER_SECOND;
    if (live.bytes + frame.byteLength > allowed)
      return refuse("too_fast", "Audio arrived faster than a microphone can produce it");
    live.bytes += frame.byteLength;
    // While a request is being understood the audio is dropped, not queued.
    if (live.phase === "thinking") return;
    // A copy this manager owns (the caller's buffer is the caller's to wipe), little endian.
    const own = new Int16Array(frame.byteLength / 2);
    new Uint8Array(own.buffer).set(frame);
    try {
      live.gate.push(own);
    } finally {
      own.fill(0);
    }
  }

  /** The gate cut out one utterance: it is ours to recognise and to zero. */
  private onUtterance(id: string, utterance: Utterance): void {
    const live = this.live;
    if (!live || live.id !== id || live.phase === "thinking") {
      wipeUtterance(utterance);
      return;
    }
    live.pending = utterance;
    this.setPhase(live, "thinking");
    void this.handle(live, utterance);
  }

  private async handle(live: Live, utterance: Utterance): Promise<void> {
    let text: string;
    try {
      text = await this.recognise(live, utterance);
      live.failures = 0;
    } catch {
      wipeUtterance(utterance);
      if (this.live?.id !== live.id) return;
      live.pending = null;
      live.failures++;
      if (live.failures >= this.limits.maxFailures) this.end(live.id, "recogniser_failed");
      else this.setPhase(live, live.awake ? "awake" : "waiting");
      return;
    }
    wipeUtterance(utterance);
    if (this.live?.id !== live.id) return;
    live.pending = null;
    const wake = matchWake(text);
    let request: string;
    if (live.awake) {
      live.stopAwakeTimer();
      request = wake.matched ? wake.rest : text;
    } else if (!wake.matched) {
      this.setPhase(live, "waiting");
      return;
    } else {
      this.d.audit("voice.wake", { session: live.id });
      if (wake.rest.length === 0) {
        this.openAwakeWindow(live);
        return;
      }
      request = wake.rest;
    }
    await this.answer(live, request);
  }

  private async answer(live: Live, request: string): Promise<void> {
    let reply: VoiceReply;
    try {
      reply = await dispatchRequest(
        live.id,
        request,
        {
          actions: this.d.actions,
          approvals: this.d.approvals,
          after: (fn, ms) => this.timers.after(fn, ms),
          approvalWaitMs: this.limits.approvalWaitMs,
          audit: (action, details) => this.d.audit(action, details),
        },
        live.abort.signal,
      );
    } catch {
      reply = { text: "Something went wrong.", intent: "refuse", outcome: "failed" };
    }
    if (this.live?.id !== live.id) return;
    this.setAwake(live, false);
    this.setPhase(live, "waiting");
    this.say(live, {
      type: "reply",
      text: reply.text,
      outcome: reply.outcome,
      intent: reply.intent,
      ...(reply.action ? { action: reply.action } : {}),
    });
  }

  private async recognise(live: Live, utterance: Utterance): Promise<string> {
    const session = this.d.recognizer.start();
    live.recogniser = session;
    const timeout = Promise.withResolvers<never>();
    const stopTimeout = this.timers.after(
      () => timeout.reject(new Error("timed out")),
      this.limits.recogniseTimeoutMs,
    );
    const onAbort = () => timeout.reject(new Error("aborted"));
    live.abort.signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (const chunk of utterance.chunks) session.push(chunk);
      return (await Promise.race([session.finish(), timeout.promise])).text;
    } finally {
      stopTimeout();
      live.abort.signal.removeEventListener("abort", onAbort);
      live.recogniser = null;
      try {
        session.cancel();
      } catch {
        // nothing more to do for a recogniser that cannot cancel
      }
      // `timeout` may still reject later (after finishing first); keep that from being unhandled.
      timeout.promise.catch(() => {});
    }
  }

  private openAwakeWindow(live: Live): void {
    this.setAwake(live, true);
    this.setPhase(live, "awake");
    const arm = () => {
      live.stopAwakeTimer = this.timers.after(() => {
        if (this.live?.id !== live.id || !live.awake) return;
        // Someone is mid-sentence: let it finish before the window closes.
        if (live.gate.speaking || live.phase === "thinking") return arm();
        this.setAwake(live, false);
        this.setPhase(live, "waiting");
      }, this.limits.awakeWindowMs);
    };
    arm();
  }

  private setAwake(live: Live, awake: boolean): void {
    if (live.awake === awake) return;
    live.awake = awake;
    if (!awake) {
      live.stopAwakeTimer();
      live.stopAwakeTimer = () => {};
    }
    try {
      this.d.onAwake(awake, live.id);
    } catch {
      // The indicator callback must never keep audio alive.
    }
  }

  private setPhase(live: Live, phase: VoicePhase): void {
    if (live.phase === phase) return;
    live.phase = phase;
    this.say(live, { type: "state", state: phase });
  }

  private say(live: Live, message: VoiceStreamMessage): void {
    try {
      live.send?.(message);
    } catch {
      // A page that cannot be told is dropped by its own connection.
    }
  }

  /** The user stopped it. Idempotent for a session that already ended. */
  stop(id: string): void {
    if (this.live?.id !== id) return;
    this.end(id, "stopped");
  }

  /** Kill switch, feature switched off, shutdown. Does nothing when idle. */
  abortAll(reason: Extract<VoiceEndReason, "kill_switch" | "disabled" | "shutdown">): void {
    if (this.live) this.end(this.live.id, reason);
  }

  /** The one exit: timers stopped, recogniser cancelled, every buffer zeroed, awake closed, audited. */
  private end(id: string, reason: VoiceEndReason): void {
    const live = this.live;
    if (!live || live.id !== id) return;
    this.live = null;
    live.stopOpenTimer();
    live.stopAwakeTimer();
    live.abort.abort();
    try {
      live.recogniser?.cancel();
    } catch {
      // nothing more to do for a recogniser that cannot cancel
    }
    live.recogniser = null;
    live.gate.stop();
    if (live.pending) wipeUtterance(live.pending);
    live.pending = null;
    if (live.awake) {
      live.awake = false;
      try {
        this.d.onAwake(false, id);
      } catch {
        // see setAwake
      }
    }
    this.d.audit("voice.stop", { session: id, reason });
    const notify = live.onEnded;
    live.onEnded = null;
    try {
      notify?.(reason);
    } catch {
      // a stream that cannot be told is closed by its own connection
    }
  }
}
