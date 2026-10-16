// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The page side of a recorded call (Phase 65), outside React so a recording survives the user
// moving between pages and closing the Pet Panel. One recorder per Core client.
//
// The browser captures the MICROPHONE ONLY (getUserMedia through the same seam as Dictation);
// every frame gets the channel prefix 0x01 ("You"). System audio needs the desktop app. Nothing is
// kept here: PCM goes straight to Core's single-use, same-origin socket.
//
// The microphone is requested only after the user confirmed the consent dialog AND Core accepted
// the session (consent + notice_acknowledged are sent in that very request, every time).
import { ApiError, type PhoenixClient } from "./client";
import {
  createBrowserMicrophone,
  withChannelPrefix,
  type DictationMicrophone,
} from "./dictation-mic";
import type { NotetakerStarted } from "./notetaker";

export type RecorderPhase = "idle" | "starting" | "recording" | "stopping";

export interface RecorderState {
  phase: RecorderPhase;
  error: string | null;
  sessionId: string | null;
  /** Wall-clock start (ms) of the recording this page controls. */
  startedAtMs: number | null;
  /** The meeting made by the last recording this page stopped. */
  meetingId: string | null;
}

interface Live {
  id: string;
  socket: WebSocket;
  mic: DictationMicrophone;
  done: boolean;
}

const IDLE: RecorderState = {
  phase: "idle",
  error: null,
  sessionId: null,
  startedAtMs: null,
  meetingId: null,
};

const failure = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed";

const MICROPHONE_CHANNEL = 1;

export class NotetakerRecorder {
  private state: RecorderState = IDLE;
  private live: Live | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: PhoenixClient,
    private readonly createMicrophone: () => DictationMicrophone,
    private readonly now: () => number = Date.now,
  ) {}

  getState = (): RecorderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Starts a recording. The caller has shown the notice and has the user's tick for THIS recording. */
  async start(title?: string): Promise<void> {
    if (this.live || this.state.phase !== "idle") return;
    this.set({ ...IDLE, phase: "starting", meetingId: null });
    let started: NotetakerStarted;
    try {
      started = await this.client.request<NotetakerStarted>("POST", "/api/notetaker/sessions", {
        ...(title ? { title } : {}),
        consent: true,
        notice_acknowledged: true,
      });
    } catch (err) {
      this.set({ phase: "idle", error: failure(err) });
      return;
    }
    let socket: WebSocket;
    try {
      socket = this.client.openNotetakerSocket(started.id);
    } catch (err) {
      void this.client.request("DELETE", `/api/notetaker/sessions/${started.id}`).catch(() => {});
      this.set({ phase: "idle", error: failure(err) });
      return;
    }
    const live: Live = { id: started.id, socket, mic: this.createMicrophone(), done: false };
    this.live = live;
    this.set({ sessionId: started.id, startedAtMs: this.now() });
    socket.onmessage = (event) => this.onMessage(live, event.data);
    socket.onerror = () => {
      if (this.live === live) this.abandon("The audio connection failed.", true);
    };
    socket.onclose = () => {
      if (this.live === live && !live.done) this.abandon("The audio connection closed.", true);
    };
  }

  private onMessage(live: Live, data: unknown): void {
    if (this.live !== live || typeof data !== "string") return;
    let message: { type?: unknown; error?: unknown; reason?: unknown };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      return this.abandon("Invalid reply from Core.", true);
    }
    if (message.type === "ready") {
      live.mic
        .start((pcm) => {
          if (this.live === live && live.socket.readyState === 1)
            live.socket.send(withChannelPrefix(MICROPHONE_CHANNEL, pcm));
        })
        .then(
          () => {
            if (this.live === live) this.set({ phase: "recording" });
          },
          (err: unknown) => this.abandon(`Microphone unavailable: ${failure(err)}`, true),
        );
    } else if (message.type === "ended" || message.type === "error") {
      const why = typeof message.reason === "string" ? message.reason : String(message.error ?? "");
      this.abandon(
        `The recording stopped${why ? `: ${why.replaceAll("_", " ")}` : ""}. What was transcribed so far is saved.`,
        false,
      );
    } else if (message.type === "audio_ended") {
      void this.finish(live);
    }
  }

  /** Every way out: the microphone is released first, then the socket, then Core is told. */
  private abandon(message: string | null, cancelCore: boolean): void {
    const current = this.live;
    this.live = null;
    if (current) {
      current.done = true;
      current.mic.stop();
      current.socket.close();
      if (cancelCore)
        void this.client.request("DELETE", `/api/notetaker/sessions/${current.id}`).catch(() => {});
    }
    this.set({ ...IDLE, error: message });
  }

  /** The user pressed Stop: the microphone goes off now; Core transcribes what is left and finishes. */
  async stop(): Promise<void> {
    const live = this.live;
    if (!live) return;
    // Stop while the browser still asks for the microphone: nothing was recorded, so cancel.
    if (this.state.phase === "starting") return this.abandon(null, true);
    if (this.state.phase !== "recording") return;
    this.set({ phase: "stopping" });
    live.mic.stop();
    if (live.socket.readyState === 1) live.socket.send(JSON.stringify({ type: "end" }));
    else await this.finish(live);
  }

  private async finish(live: Live): Promise<void> {
    try {
      const result = await this.client.request<{ meeting_id: string }>(
        "POST",
        `/api/notetaker/sessions/${live.id}/stop`,
        {},
      );
      if (this.live !== live) return;
      this.live = null;
      live.done = true;
      live.socket.close();
      this.set({ ...IDLE, meetingId: result.meeting_id });
    } catch (err) {
      if (this.live === live) this.abandon(failure(err), false);
    }
  }

  /** Cancels the recording this page controls (the microphone stops; the text so far is kept). */
  cancel(): void {
    if (this.live) this.abandon(null, true);
  }

  /** Stops a recording that another view (for example the desktop app) started. */
  async stopById(id: string): Promise<void> {
    try {
      const result = await this.client.request<{ meeting_id: string }>(
        "POST",
        `/api/notetaker/sessions/${encodeURIComponent(id)}/stop`,
        {},
      );
      this.set({ meetingId: result.meeting_id, error: null });
    } catch (err) {
      this.set({ error: failure(err) });
    }
  }
}

const recorders = new WeakMap<PhoenixClient, NotetakerRecorder>();

/** The one recorder of this client. `createMicrophone` (tests pass a fake) counts only the first time. */
export function recorderFor(
  client: PhoenixClient,
  createMicrophone: () => DictationMicrophone = createBrowserMicrophone,
): NotetakerRecorder {
  let recorder = recorders.get(client);
  if (!recorder) {
    recorder = new NotetakerRecorder(client, createMicrophone);
    recorders.set(client, recorder);
  }
  return recorder;
}
