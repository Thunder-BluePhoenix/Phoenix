// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The page side of « OK Fawkes » (Phase 66), outside React so listening survives the user moving
// between pages. One assistant per Core client.
//
// The microphone is requested ONLY after the user switched the assistant on (or pressed "Start
// listening" after a reload) AND Core accepted a session AND its stream said `ready`; it is
// released first on every way out. Frames go straight to Core's single-use, same-origin socket and
// are kept nowhere in this page. Core's reply text is spoken with the browser's own speech
// synthesis when it exists; Core produces no audio.
import type { MessageKey } from "../i18n";
import { translate } from "../i18n/store";
import { ApiError, type PhoenixClient } from "./client";
import { createBrowserMicrophone, type DictationMicrophone } from "./dictation-mic";
import { switchPillsCommand } from "./pill-switch";
import type { VoiceAction, VoicePhase, VoiceReply, VoiceStarted } from "./voice";

export type AssistantPhase = "idle" | "starting" | VoicePhase;

export interface AssistantState {
  phase: AssistantPhase;
  error: string | null;
  reply: VoiceReply | null;
  sessionId: string | null;
}

/** The part of `speechSynthesis` this page uses (a seam for tests; absent in some webviews). */
export interface SpeechSynthesisLike {
  speak(utterance: unknown): void;
  cancel(): void;
  /** True while an utterance is being spoken (the browser's own flag). */
  readonly speaking?: boolean;
}
export interface SpeechDeps {
  synth: () => SpeechSynthesisLike | undefined;
  createUtterance: (text: string) => unknown;
  /** Clock (ms) behind the post-speech tail; tests inject one. */
  now?: () => number;
}

/** Spoken text is clipped again here: Core caps it, the page does not rely on that. */
export const MAX_SPOKEN_CHARS = 300;

/**
 * While Fawkes speaks, and for this long after, the microphone's frames are dropped instead of
 * sent: its own voice (which may repeat third-party text) must never reach the wake-phrase matcher.
 */
export const SPEECH_TAIL_MS = 1000;
/** If the browser never reports the end of an utterance, frames resume after this long. */
export const MAX_SPEECH_MS = 60_000;

export const browserSpeech: SpeechDeps = {
  synth: () => (typeof speechSynthesis === "undefined" ? undefined : speechSynthesis),
  createUtterance: (text) => new SpeechSynthesisUtterance(text),
  now: Date.now,
};

const IDLE: AssistantState = { phase: "idle", error: null, reply: null, sessionId: null };

const failure = (err: unknown) =>
  err instanceof ApiError
    ? err.message
    : err instanceof Error
      ? err.message
      : translate("common.error.requestFailed");

/** Why Core ended a session (its `reason` code) as a message; an unknown code is plain "stopped". */
const REASONS: Record<string, MessageKey> = {
  stopped: "capture.voice.reason.stopped",
  disabled: "capture.voice.reason.disabled",
  kill_switch: "capture.voice.reason.killSwitch",
  bad_frame: "capture.voice.reason.badFrame",
  too_fast: "capture.voice.reason.tooFast",
  connection_closed: "capture.voice.reason.connectionClosed",
  stream_not_opened: "capture.voice.reason.streamNotOpened",
  recogniser_failed: "capture.voice.reason.recogniserFailed",
  shutdown: "capture.voice.reason.shutdown",
};

interface Live {
  id: string;
  socket: WebSocket;
  mic: DictationMicrophone;
  micRequested: boolean;
  done: boolean;
}

function isReply(value: Record<string, unknown>): value is Record<string, unknown> & VoiceReply {
  return typeof value.text === "string" && typeof value.outcome === "string";
}

export class VoiceAssistant {
  private state: AssistantState = IDLE;
  private live: Live | null = null;
  /** `stop()` arrived while Core had not yet answered the start request: that session is cancelled. */
  private stopRequested = false;
  /** Fawkes's own speech: an utterance is playing (until `activeUntil` at most); frames drop until `mutedUntil`. */
  private utteranceActive = false;
  private utteranceToken = 0;
  private activeUntil = 0;
  private mutedUntil = 0;
  private readonly listeners = new Set<() => void>();
  /**
   * A `switch_pill` action runs the same command as the shortcut and the palette: select the next
   * (or previous) source pill and open the page that shows it.
   */
  onAction: (action: VoiceAction) => void = (action) => {
    if (action.type === "switch_pill")
      switchPillsCommand(this.client, action.direction === "previous" ? "previous" : "next");
  };

  constructor(
    private readonly client: PhoenixClient,
    private readonly createMicrophone: () => DictationMicrophone,
    private readonly speech: SpeechDeps = browserSpeech,
  ) {}

  getState = (): AssistantState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Starts listening. Call it only from the user switching voice on or pressing "Start listening". */
  async start(): Promise<void> {
    if (this.live || this.state.phase !== "idle") return;
    this.stopRequested = false;
    this.set({ ...IDLE, phase: "starting" });
    let started: VoiceStarted;
    try {
      started = await this.client.request<VoiceStarted>("POST", "/api/voice/sessions", {});
    } catch (err) {
      this.set({ phase: "idle", error: failure(err) });
      return;
    }
    if (this.stopRequested) {
      this.stopRequested = false;
      void this.client.request("DELETE", `/api/voice/sessions/${started.id}`).catch(() => {});
      this.set({ phase: "idle" });
      return;
    }
    let socket: WebSocket;
    try {
      socket = this.client.openVoiceSocket(started.id);
    } catch (err) {
      void this.client.request("DELETE", `/api/voice/sessions/${started.id}`).catch(() => {});
      this.set({ phase: "idle", error: failure(err) });
      return;
    }
    const live: Live = {
      id: started.id,
      socket,
      mic: this.createMicrophone(),
      micRequested: false,
      done: false,
    };
    this.live = live;
    this.set({ sessionId: started.id });
    socket.onmessage = (event) => void this.onMessage(live, event.data);
    socket.onerror = () => {
      if (this.live === live) this.abandon(live, translate("capture.audio.connectionFailed"), true);
    };
    socket.onclose = () => {
      if (this.live === live && !live.done)
        this.abandon(live, translate("capture.voice.reason.connectionClosed"), true);
    };
  }

  /** Stops listening: the microphone is released first. Idempotent. */
  async stop(): Promise<void> {
    const live = this.live;
    if (!live) {
      if (this.state.phase === "starting") this.stopRequested = true;
      return;
    }
    this.abandon(live, null, true);
  }

  private async onMessage(live: Live, data: unknown): Promise<void> {
    if (this.live !== live || typeof data !== "string") return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "ready") {
      if (live.micRequested) return;
      live.micRequested = true;
      try {
        await live.mic.start((pcm) => {
          // Fawkes's own voice (it may repeat third-party text) never reaches the wake matcher.
          if (this.live === live && live.socket.readyState === 1 && !this.speechMuted())
            live.socket.send(pcm.buffer as ArrayBuffer);
        });
      } catch (err) {
        this.abandon(
          live,
          translate("capture.voice.micCouldNotStart", { reason: failure(err) }),
          true,
        );
        return;
      }
      if (this.live === live) this.set({ phase: "waiting" });
    } else if (message.type === "state") {
      const next = message.state;
      if (next === "waiting" || next === "awake" || next === "thinking") this.set({ phase: next });
    } else if (message.type === "reply" && isReply(message)) {
      const reply: VoiceReply = {
        text: message.text,
        outcome: message.outcome,
        intent: String(message.intent ?? ""),
        ...(message.action ? { action: message.action } : {}),
      };
      this.set({ reply });
      this.speak(reply.text);
      if (reply.action?.type === "switch_pill") this.onAction(reply.action);
    } else if (message.type === "ended") {
      const reason = typeof message.reason === "string" ? message.reason : "";
      this.abandon(live, translate(REASONS[reason] ?? "capture.voice.reason.stopped"), false);
    } else if (message.type === "error") {
      this.abandon(live, translate("capture.voice.reason.refused"), false);
    }
  }

  /** True while Fawkes's own voice is playing or in the short tail after it. */
  private speechMuted(): boolean {
    const now = (this.speech.now ?? Date.now)();
    return (
      this.speech.synth()?.speaking === true ||
      (this.utteranceActive && now < this.activeUntil) ||
      now < this.mutedUntil
    );
  }

  private speechEnded(token: number): void {
    // The end of an utterance this one replaced (speak() cancels the previous) says nothing.
    if (token !== this.utteranceToken) return;
    this.utteranceActive = false;
    this.mutedUntil = (this.speech.now ?? Date.now)() + SPEECH_TAIL_MS;
  }

  private speak(text: string): void {
    const synth = this.speech.synth();
    if (!synth) return;
    try {
      synth.cancel();
      const now = (this.speech.now ?? Date.now)();
      const token = ++this.utteranceToken;
      const utterance = this.speech.createUtterance(text.slice(0, MAX_SPOKEN_CHARS));
      // Muted from now: until the browser reports the end (or the cap, if it never does) + the tail.
      this.utteranceActive = true;
      this.activeUntil = now + MAX_SPEECH_MS;
      this.mutedUntil = now + SPEECH_TAIL_MS;
      if (typeof utterance === "object" && utterance !== null) {
        const hooks = utterance as { onend: unknown; onerror: unknown };
        hooks.onend = () => this.speechEnded(token);
        hooks.onerror = () => this.speechEnded(token);
      } else {
        // Nothing to listen to for an end: only `speaking` and the tail apply.
        this.utteranceActive = false;
      }
      synth.speak(utterance);
    } catch {
      // Speech is a courtesy: the reply is on screen either way.
      this.utteranceActive = false;
    }
  }

  /** The one exit: microphone released FIRST, then the socket, speech and (optionally) Core's session. */
  private abandon(live: Live, message: string | null, cancelCore: boolean): void {
    if (this.live !== live || live.done) return;
    live.done = true;
    live.mic.stop();
    this.live = null;
    live.socket.onmessage = null;
    try {
      live.socket.close();
    } catch {
      // already closed
    }
    try {
      this.speech.synth()?.cancel();
    } catch {
      // nothing speaking
    }
    this.utteranceActive = false;
    this.mutedUntil = 0;
    if (cancelCore)
      void this.client.request("DELETE", `/api/voice/sessions/${live.id}`).catch(() => {});
    this.set({ ...IDLE, reply: this.state.reply, error: message });
  }
}

const assistants = new WeakMap<PhoenixClient, VoiceAssistant>();

/** The assistant of this client if one was ever made (never creates one, so never a microphone). */
export function existingAssistant(client: PhoenixClient): VoiceAssistant | undefined {
  return assistants.get(client);
}

/** The one assistant of this client. `createMicrophone` (tests pass a fake) counts only the first time. */
export function assistantFor(
  client: PhoenixClient,
  createMicrophone: () => DictationMicrophone = createBrowserMicrophone,
  speech: SpeechDeps = browserSpeech,
): VoiceAssistant {
  let assistant = assistants.get(client);
  if (!assistant) {
    assistant = new VoiceAssistant(client, createMicrophone, speech);
    assistants.set(client, assistant);
  }
  return assistant;
}
