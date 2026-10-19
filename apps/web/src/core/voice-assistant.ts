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
import { ApiError, type PhoenixClient } from "./client";
import { createBrowserMicrophone, type DictationMicrophone } from "./dictation-mic";
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
}
export interface SpeechDeps {
  synth: () => SpeechSynthesisLike | undefined;
  createUtterance: (text: string) => unknown;
}

/** Spoken text is clipped again here: Core caps it, the page does not rely on that. */
export const MAX_SPOKEN_CHARS = 300;

export const browserSpeech: SpeechDeps = {
  synth: () => (typeof speechSynthesis === "undefined" ? undefined : speechSynthesis),
  createUtterance: (text) => new SpeechSynthesisUtterance(text),
};

const IDLE: AssistantState = { phase: "idle", error: null, reply: null, sessionId: null };

const failure = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed";

const REASONS: Record<string, string> = {
  stopped: "Voice stopped.",
  disabled: "Voice was switched off.",
  kill_switch: "Voice stopped: the emergency stop is engaged.",
  bad_frame: "Voice stopped: the microphone sent invalid audio.",
  too_fast: "Voice stopped: the microphone sent audio too fast.",
  connection_closed: "Voice stopped: the connection closed.",
  stream_not_opened: "Voice stopped: the microphone did not start in time.",
  recogniser_failed: "Voice stopped: speech recognition failed.",
  shutdown: "Voice stopped: Phoenix Core is stopping.",
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
  private readonly listeners = new Set<() => void>();
  /** Navigation for a `switch_pill` action: the Pet Panel's overview tab. */
  onAction: (action: VoiceAction) => void = (action) => {
    if (action.type === "switch_pill" && typeof window !== "undefined")
      window.location.hash = "#/panel/overview";
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
    this.set({ ...IDLE, phase: "starting" });
    let started: VoiceStarted;
    try {
      started = await this.client.request<VoiceStarted>("POST", "/api/voice/sessions", {});
    } catch (err) {
      this.set({ phase: "idle", error: failure(err) });
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
      if (this.live === live) this.abandon(live, "The audio connection failed.", true);
    };
    socket.onclose = () => {
      if (this.live === live && !live.done)
        this.abandon(live, "Voice stopped: the connection closed.", true);
    };
  }

  /** Stops listening: the microphone is released first. Idempotent. */
  async stop(): Promise<void> {
    const live = this.live;
    if (!live) return;
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
          if (this.live === live && live.socket.readyState === 1)
            live.socket.send(pcm.buffer as ArrayBuffer);
        });
      } catch (err) {
        this.abandon(live, `The microphone could not start: ${failure(err)}`, true);
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
      this.abandon(live, REASONS[reason] ?? "Voice stopped.", false);
    } else if (message.type === "error") {
      this.abandon(live, "Voice stopped: Core refused the audio.", false);
    }
  }

  private speak(text: string): void {
    const synth = this.speech.synth();
    if (!synth) return;
    try {
      synth.cancel();
      synth.speak(this.speech.createUtterance(text.slice(0, MAX_SPOKEN_CHARS)));
    } catch {
      // Speech is a courtesy: the reply is on screen either way.
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
    if (cancelCore)
      void this.client.request("DELETE", `/api/voice/sessions/${live.id}`).catch(() => {});
    this.set({ ...IDLE, reply: this.state.reply, error: message });
  }
}

const assistants = new WeakMap<PhoenixClient, VoiceAssistant>();

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
