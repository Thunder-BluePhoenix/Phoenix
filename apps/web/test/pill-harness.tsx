// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { DictationStatus } from "../src/core/dictation";
import type { DictationMicrophone } from "../src/core/dictation-mic";
import type { PillAnalyser } from "../src/pill/analyser";
import { PillApp, type FrameScheduler } from "../src/pill/PillApp";
import type { PillCommand, PillPasteResult, PillShell } from "../src/pill/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

/** A WebSocket that records binary frames and has a real-looking readyState. */
export class AudioSocket extends FakeWebSocket {
  readyState = 0;
  frames: ArrayBuffer[] = [];
  binaryType = "blob";
  override send(data: string | ArrayBuffer) {
    if (typeof data === "string") super.send(data);
    else this.frames.push(data);
  }
  override open() {
    this.readyState = 1;
    super.open();
  }
  override close() {
    this.readyState = 3;
    super.close();
  }
  fromCore(payload: object) {
    act(() => this.onmessage?.({ data: JSON.stringify(payload) }));
  }
}

export const STATUS: DictationStatus = {
  enabled: true,
  kill_switch_engaged: false,
  recognizer: { available: true, detail: "Fake recogniser", engine: "fake" },
  audio_on_disk: false,
  cleanup: { available: false, detail: "AI is off", locality: "local" },
  active: null,
  limits: { max_seconds: 120, max_bytes: 3_840_000, max_frame_bytes: 65_536 },
  vocabulary_limits: {
    dictionary: 500,
    replacements: 500,
    snippets: 100,
    phrase_words: 5,
    phrase_chars: 60,
    term_chars: 80,
    replacement_chars: 200,
    snippet_chars: 2000,
    app_modes: 100,
  },
};
export const ID = `dic_${"a".repeat(32)}`;
export const FINISH = `/api/dictation/sessions/${ID}/finish`;
export const SESSION = `/api/dictation/sessions/${ID}`;

export interface FakeMic {
  started: number;
  stopped: number;
  onPcm: ((pcm: Int16Array) => void) | null;
  rejectWith: Error | null;
  gate: Promise<void> | null;
  instance: DictationMicrophone;
}

export function fakeMic(): FakeMic {
  const mic: FakeMic = {
    started: 0,
    stopped: 0,
    onPcm: null,
    rejectWith: null,
    gate: null,
    instance: {
      async start(onPcm: (pcm: Int16Array) => void) {
        mic.started++;
        if (mic.gate) await mic.gate;
        if (mic.rejectWith) throw mic.rejectWith;
        mic.onPcm = onPcm;
      },
      stop() {
        mic.stopped++;
        mic.onPcm = null;
      },
    },
  };
  return mic;
}

export interface FakeAnalyser extends PillAnalyser {
  value: number;
  pushed: Int16Array[];
  resets: number;
}

export function fakeAnalyser(): FakeAnalyser {
  const analyser: FakeAnalyser = {
    value: 0,
    pushed: [],
    resets: 0,
    push: (pcm) => void analyser.pushed.push(pcm),
    level: () => analyser.value,
    reset() {
      analyser.resets++;
      analyser.value = 0;
    },
  };
  return analyser;
}

/** A frame scheduler the test drives by hand: no real animation frames or timers. */
export function fakeFrames() {
  let queue: (() => void)[] = [];
  const schedule: FrameScheduler = (callback) => {
    queue.push(callback);
    return () => {
      queue = queue.filter((c) => c !== callback);
    };
  };
  return {
    schedule,
    pending: () => queue.length,
    tick() {
      const run = queue;
      queue = [];
      act(() => run.forEach((callback) => callback()));
    },
  };
}

export interface FakePillShell extends PillShell {
  log: string[];
  pasted: string[];
  ended_: number;
  opened: string[];
  unlistened: number;
  pasteImpl: (text: string) => Promise<PillPasteResult>;
  emit(command: PillCommand): void;
  emitError(message: string): void;
}

export function fakeShell(): FakePillShell {
  let listener: ((command: PillCommand) => void) | undefined;
  let errorListener: ((message: string) => void) | undefined;
  const shell: FakePillShell = {
    log: [],
    pasted: [],
    ended_: 0,
    opened: [],
    unlistened: 0,
    pasteImpl: async () => ({ pasted: "clipboard" }),
    paste: (text) => {
      shell.pasted.push(text);
      return shell.pasteImpl(text);
    },
    ended: () => void shell.ended_++,
    openInPhoenix: (route) => void shell.opened.push(route),
    ready: () => void shell.log.push("ready"),
    onError: async (next) => {
      errorListener = next;
      shell.log.push("listen-error");
      return () => {
        errorListener = undefined;
        shell.unlistened++;
      };
    },
    onDictation: async (next) => {
      listener = next;
      shell.log.push("listen");
      return () => {
        listener = undefined;
        shell.unlistened++;
      };
    },
    emit: (command) => act(() => listener?.(command)),
    emitError: (message) => act(() => errorListener?.(message)),
  };
  return shell;
}

export interface MountOptions {
  status?: Partial<DictationStatus>;
  routes?: Parameters<typeof fakeApi>[0];
  mic?: FakeMic;
  /** `undefined` = a fake shell; `null` = a plain browser. */
  shell?: FakePillShell | null;
  text?: string;
  useDefaultMic?: boolean;
  openInBrowser?: (route: string) => void;
  copyText?: ((text: string) => Promise<void>) | null;
}

export function mountPill(options: MountOptions = {}) {
  const mic = options.mic ?? fakeMic();
  const shell = options.shell === undefined ? fakeShell() : options.shell;
  const analyser = fakeAnalyser();
  const frames = fakeFrames();
  const api = fakeApi({
    "GET /api/dictation/status": () => ({ ...STATUS, ...options.status }),
    "POST /api/dictation/sessions": () => ({
      id: ID,
      max_seconds: 120,
      max_bytes: 3_840_000,
      max_frame_bytes: 65_536,
    }),
    [`POST ${FINISH}`]: () => ({
      text: options.text ?? "hello world",
      words: 2,
      steps: { dictionary: 0, replacements: 0, snippet: false, cleanup: "off" },
    }),
    [`DELETE ${SESSION}`]: () => ({ cancelled: true }),
    ...options.routes,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: window.location.origin,
    WebSocketImpl: AudioSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <PillApp
        shell={shell}
        {...(options.useDefaultMic ? {} : { createMicrophone: () => mic.instance })}
        analyser={analyser}
        scheduleFrame={frames.schedule}
        {...(options.openInBrowser ? { openInBrowser: options.openInBrowser } : {})}
        {...(options.copyText !== undefined ? { copyText: options.copyText } : {})}
      />
    </CoreProvider>,
  );
  const hub = FakeWebSocket.instances[0] as AudioSocket;
  act(() => hub.open());
  return { api, mic, shell, analyser, frames, hub, client, ...view };
}

export const dictateButton = async () => {
  const b = (await screen.findByRole("button", { name: "Dictate" })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  return b;
};
export const statusText = () => screen.getByRole("status").textContent;
export const audioSocket = () => FakeWebSocket.last as AudioSocket;
export const sessionSockets = () =>
  FakeWebSocket.instances.filter((s) => s.url.includes("/api/dictation/stream"));
export const dots = () => screen.getAllByTestId("pill-dot");

/** Click Dictate, accept the session, let Core say `ready`, and wait until the pill is listening. */
export async function beginListening() {
  fireEvent.click(await dictateButton());
  await waitFor(() => expect(sessionSockets()).toHaveLength(1));
  act(() => audioSocket().open());
  audioSocket().fromCore({ type: "ready" });
  await screen.findByText("Listening: your microphone is on");
}
