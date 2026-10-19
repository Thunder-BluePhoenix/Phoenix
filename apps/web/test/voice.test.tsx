// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceBanner, VoiceSettingsSection } from "../src/components/Voice";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { DictationMicrophone } from "../src/core/dictation-mic";
import { isMailtoDraft, voiceBlocked, type VoiceStatus } from "../src/core/voice";
import { MAX_SPOKEN_CHARS, assistantFor, type SpeechDeps } from "../src/core/voice-assistant";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

class AudioSocket extends FakeWebSocket {
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

const ID = `voi_${"b".repeat(32)}`;
const STATUS: VoiceStatus = {
  enabled: false,
  kill_switch_engaged: false,
  recognizer: { available: true, detail: "Fake recogniser", engine: "fake" },
  audio_on_disk: false,
  active: null,
  limits: { max_frame_bytes: 65_536, awake_window_ms: 8000 },
};

interface FakeMic {
  started: number;
  stopped: number;
  log: string[];
  onPcm: ((pcm: Int16Array) => void) | null;
  rejectWith: Error | null;
  instance: DictationMicrophone;
}
function fakeMic(log: string[] = []): FakeMic {
  const mic: FakeMic = {
    started: 0,
    stopped: 0,
    log,
    onPcm: null,
    rejectWith: null,
    instance: {
      async start(onPcm) {
        mic.started++;
        mic.log.push("mic.start");
        if (mic.rejectWith) throw mic.rejectWith;
        mic.onPcm = onPcm;
      },
      stop() {
        mic.stopped++;
        mic.log.push("mic.stop");
        mic.onPcm = null;
      },
    },
  };
  return mic;
}

interface Speech {
  spoken: string[];
  cancelled: number;
  deps: SpeechDeps;
}
function fakeSpeech(): Speech {
  const s: Speech = {
    spoken: [],
    cancelled: 0,
    deps: {
      synth: () => ({
        speak: (u) => void s.spoken.push(String(u)),
        cancel: () => void s.cancelled++,
      }),
      createUtterance: (text) => text,
    },
  };
  return s;
}

beforeEach(() => {
  FakeWebSocket.reset();
  window.location.hash = "";
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(
  options: {
    status?: Partial<VoiceStatus>;
    mic?: FakeMic;
    speech?: SpeechDeps;
    routes?: Parameters<typeof fakeApi>[0];
    ui?: "settings" | "banner";
  } = {},
) {
  const mic = options.mic ?? fakeMic();
  const speech = options.speech ?? fakeSpeech().deps;
  let enabled = options.status?.enabled ?? false;
  const api: FakeApi = fakeApi({
    "GET /api/voice/status": () => ({ ...STATUS, ...options.status, enabled }),
    "GET /api/voice/settings": () => ({ enabled }),
    "POST /api/voice/settings": (body) => {
      enabled = (body as { enabled: boolean }).enabled;
      mic.log.push(`settings:${String(enabled)}`);
      return { enabled };
    },
    "POST /api/voice/sessions": () => {
      mic.log.push("session");
      return { id: ID };
    },
    "DELETE /api/voice/sessions/*": () => {
      mic.log.push("delete");
      return { stopped: true };
    },
    ...options.routes,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: window.location.origin,
    WebSocketImpl: AudioSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const seams = { createMicrophone: () => mic.instance, speech };
  render(
    <CoreProvider client={client}>
      <VoiceBanner {...seams} />
      <VoiceSettingsSection {...seams} />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.instances[0]!.open());
  return { api, mic, client };
}
const audioSocket = () => FakeWebSocket.last as AudioSocket;
const voiceSockets = () =>
  FakeWebSocket.instances.filter((s) => s.url.includes("/api/voice/stream"));
const toggle = async () =>
  (await screen.findByRole("checkbox", { name: /Turn on/ })) as HTMLInputElement;

describe("voice settings", () => {
  it("is off by default and touches neither the microphone nor a session until the user turns it on", async () => {
    const { api, mic } = mount();
    const box = await toggle();
    expect(box.checked).toBe(false);
    expect(mic.started).toBe(0);
    expect(api.posts("/api/voice/sessions")).toHaveLength(0);
    expect(voiceSockets()).toHaveLength(0);
    expect(screen.queryByText(/Microphone on\./)).toBeNull();
    // the plain-language description says what is kept and that it can never approve
    expect(screen.getByText(/never approve an action/i)).toBeTruthy();
    expect(screen.getByText(/never written to\s+disk/i)).toBeTruthy();
  });

  it("turning it on: settings, then a session, a same-origin stream, the microphone only after `ready`, and a visible indicator", async () => {
    const { mic } = mount();
    fireEvent.click(await toggle());
    await waitFor(() => expect(voiceSockets()).toHaveLength(1));
    const socket = audioSocket();
    expect(socket.url).toContain(`/api/voice/stream?session=${ID}`);
    expect(socket.protocols).toEqual(["phoenix.v1", "phoenix.token.tok"]);
    expect(mic.log).toEqual(["settings:true", "session"]);
    expect(mic.started).toBe(0);
    act(() => socket.open());
    socket.fromCore({ type: "ready" });
    await waitFor(() => expect(mic.started).toBe(1));
    expect((await screen.findAllByText(/Microphone on\./)).length).toBeGreaterThan(0);
    expect(
      await screen.findByText(/Listening for “OK Fawkes”/, { exact: false }, { timeout: 2000 }),
    ).toBeTruthy();
    // PCM frames go to the socket and nowhere else
    act(() => mic.onPcm?.(new Int16Array(160).fill(5)));
    expect(socket.frames).toHaveLength(1);
    expect(socket.frames[0]!.byteLength).toBe(320);
  });

  it("turning it off releases the microphone BEFORE telling Core, and closes the stream", async () => {
    const { mic } = mount({ status: { enabled: true } });
    fireEvent.click(await screen.findByRole("button", { name: "Start listening" }));
    await waitFor(() => expect(voiceSockets()).toHaveLength(1));
    const socket = audioSocket();
    act(() => socket.open());
    socket.fromCore({ type: "ready" });
    await waitFor(() => expect(mic.started).toBe(1));
    mic.log.length = 0;
    fireEvent.click(await toggle());
    await waitFor(() => expect(mic.log).toContain("settings:false"));
    expect(mic.log.indexOf("mic.stop")).toBeGreaterThanOrEqual(0);
    expect(mic.log.indexOf("mic.stop")).toBeLessThan(mic.log.indexOf("settings:false"));
    expect(mic.stopped).toBe(1);
    expect(socket.closed).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Microphone on\./)).toBeNull());
  });

  it("is blocked, with the reason, while the recogniser is unavailable or the emergency stop is engaged", async () => {
    for (const [patch, reason] of [
      [
        {
          enabled: true,
          recognizer: { available: false, detail: "No on-device speech recogniser configured" },
        },
        /No on-device speech recogniser/,
      ],
      [{ enabled: true, kill_switch_engaged: true }, /emergency stop/i],
    ] as const) {
      const { mic } = mount({ status: patch });
      await screen.findAllByText(reason);
      expect(screen.queryByRole("button", { name: "Start listening" })).toBeNull();
      expect(mic.started).toBe(0);
      cleanup();
      FakeWebSocket.reset();
    }
  });

  it("a refused microphone ends the attempt, releases it and tells Core to stop", async () => {
    const mic = fakeMic();
    mic.rejectWith = new Error("Permission denied");
    const { api } = mount({ mic });
    fireEvent.click(await toggle());
    await waitFor(() => expect(voiceSockets()).toHaveLength(1));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    expect(await screen.findByText(/microphone could not start: Permission denied/)).toBeTruthy();
    expect(mic.stopped).toBe(1);
    expect(
      api.calls.some((c) => c.method === "DELETE" && c.path === `/api/voice/sessions/${ID}`),
    ).toBe(true);
    expect(screen.queryByText(/Microphone on\./)).toBeNull();
  });
});

describe("running", () => {
  async function listening(options: Parameters<typeof mount>[0] = {}) {
    const m = mount({ status: { enabled: true }, ...options });
    fireEvent.click(await screen.findByRole("button", { name: "Start listening" }));
    await waitFor(() => expect(voiceSockets()).toHaveLength(1));
    const socket = audioSocket();
    act(() => socket.open());
    socket.fromCore({ type: "ready" });
    await waitFor(() => expect(m.mic.started).toBe(1));
    return { ...m, socket };
  }

  it("shows the awake window, speaks Core's reply text (clipped) and shows it on screen", async () => {
    const speech = fakeSpeech();
    const { socket } = await listening({ speech: speech.deps });
    socket.fromCore({ type: "state", state: "awake" });
    expect(await screen.findAllByText(/Fawkes is listening to your request/)).not.toHaveLength(0);
    const long = "word ".repeat(200);
    socket.fromCore({ type: "reply", text: long, outcome: "ok", intent: "tool" });
    expect(await screen.findByText(/Fawkes:/)).toBeTruthy();
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0]!.length).toBe(MAX_SPOKEN_CHARS);
    expect(speech.cancelled).toBeGreaterThanOrEqual(1); // earlier speech is cut off, not queued
  });

  it("works when speech synthesis is absent (the answer is still on screen)", async () => {
    const { socket } = await listening({
      speech: { synth: () => undefined, createUtterance: String },
    });
    socket.fromCore({ type: "reply", text: "Phoenix is on main.", outcome: "ok", intent: "tool" });
    expect(await screen.findByText(/Phoenix is on main\./)).toBeTruthy();
  });

  it("a switch_pill action opens the Pet Panel overview; a mailto draft is a link the user clicks, not an action", async () => {
    const { socket } = await listening();
    socket.fromCore({
      type: "reply",
      text: "Opening.",
      outcome: "ok",
      intent: "switch_pill",
      action: { type: "switch_pill" },
    });
    await waitFor(() => expect(window.location.hash).toBe("#/panel/overview"));
    const url = "mailto:?subject=Draft%20from%20Fawkes&body=the%20release";
    socket.fromCore({
      type: "reply",
      text: "Draft.",
      outcome: "ok",
      intent: "mailto_draft",
      action: { type: "mailto", url },
    });
    const link = await screen.findByRole("link", { name: "Open the email draft" });
    expect(link.getAttribute("href")).toBe(url);
    socket.fromCore({
      type: "reply",
      text: "Draft.",
      outcome: "ok",
      intent: "mailto_draft",
      action: { type: "mailto", url: "javascript:alert(1)" },
    });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Open the email draft" })).toBeNull(),
    );
  });

  it("Core ending the session (kill switch) releases the microphone and says why", async () => {
    const { mic, socket, api } = await listening();
    socket.fromCore({ type: "ended", reason: "kill_switch" });
    expect(await screen.findByText(/emergency stop is engaged/)).toBeTruthy();
    expect(mic.stopped).toBe(1);
    expect(socket.closed).toBe(true);
    expect(screen.queryByText(/Microphone on\./)).toBeNull();
    // Core already ended it: no redundant DELETE
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("the Stop button releases the microphone and tells Core", async () => {
    const { mic, api } = await listening();
    fireEvent.click((await screen.findAllByRole("button", { name: "Stop listening" }))[0]!);
    expect(mic.stopped).toBe(1);
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "DELETE" && c.path === `/api/voice/sessions/${ID}`),
      ).toBe(true),
    );
  });

  it("a dropped audio connection releases the microphone", async () => {
    const { mic, socket } = await listening();
    act(() => socket.drop());
    expect(await screen.findByText(/connection closed/)).toBeTruthy();
    expect(mic.stopped).toBe(1);
  });

  it("one assistant per client, and a second start while listening does nothing", async () => {
    const { client, api, mic } = await listening();
    const assistant = assistantFor(client);
    await assistant.start();
    expect(api.posts("/api/voice/sessions")).toHaveLength(1);
    expect(mic.started).toBe(1);
  });
});

describe("helpers", () => {
  it("only Core-shaped mailto drafts are links", () => {
    expect(isMailtoDraft("mailto:?subject=Draft%20from%20Fawkes")).toBe(true);
    expect(isMailtoDraft("mailto:?subject=Draft%20from%20Fawkes&body=hi%20there")).toBe(true);
    for (const bad of [
      "mailto:evil@example.com?subject=x",
      "mailto:?subject=x&cc=a@b.c",
      "javascript:alert(1)",
      "https://evil.example",
      "mailto:?body=<script>",
    ])
      expect(isMailtoDraft(bad), bad).toBe(false);
  });

  it("explains why voice cannot start", () => {
    expect(voiceBlocked(null, true)).toMatch(/not available/);
    expect(voiceBlocked({ ...STATUS }, true)).toMatch(/off/);
    expect(voiceBlocked({ ...STATUS, enabled: true }, false)).toMatch(/not connected/);
    expect(voiceBlocked({ ...STATUS, enabled: true }, true)).toBeNull();
  });
});
