// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreProvider } from "../src/core/context";
import { PhoenixClient } from "../src/core/client";
import {
  createBrowserMicrophone,
  floatToPcm16,
  type DictationMicrophone,
  type MicAudioContextLike,
  type MicMediaDevicesLike,
  type MicProcessorLike,
} from "../src/core/dictation-mic";
import type { DictationSettings, DictationStats, DictationStatus } from "../src/core/dictation";
import { DictateButton, DictationSettingsSection } from "../src/components/Dictation";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { mount as mountApp, openPanel, openTab } from "./harness";

/** A WebSocket that records binary frames and has a real-looking readyState. */
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

const STATUS: DictationStatus = {
  enabled: true,
  kill_switch_engaged: false,
  recognizer: { available: true, detail: "Fake recogniser", engine: "fake" },
  audio_on_disk: false,
  cleanup: {
    available: false,
    detail: "AI is off in Settings, so clean-up modes other than 'as said' do nothing",
    locality: "local",
  },
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
const SETTINGS: DictationSettings = {
  enabled: false,
  typing_wpm: 40,
  default_mode: "as_said",
  app_modes: {},
  vocabulary: { dictionary: [], replacements: [], snippets: [] },
};
const STATS: DictationStats = {
  words: 0,
  sessions: 0,
  speech_ms: 0,
  typing_ms: 0,
  saved_ms: 0,
  typing_wpm: 40,
  average_wpm: 0,
  streak_days: 0,
  top_apps: [],
};
const ID = `dic_${"a".repeat(32)}`;

interface FakeMic {
  started: number;
  stopped: number;
  onPcm: ((pcm: Int16Array) => void) | null;
  rejectWith: Error | null;
  gate: Promise<void> | null;
  instance: DictationMicrophone;
}

function fakeMic(): FakeMic {
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

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountButton(
  options: {
    status?: Partial<DictationStatus>;
    routes?: Parameters<typeof fakeApi>[0];
    mic?: FakeMic;
  } = {},
) {
  const mic = options.mic ?? fakeMic();
  const texts: string[] = [];
  const api = fakeApi({
    "GET /api/dictation/status": () => ({ ...STATUS, ...options.status }),
    "POST /api/dictation/sessions": () => ({
      id: ID,
      max_seconds: 120,
      max_bytes: 3_840_000,
      max_frame_bytes: 65_536,
    }),
    ...options.routes,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: window.location.origin,
    WebSocketImpl: AudioSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <DictateButton onText={(t) => texts.push(t)} createMicrophone={() => mic.instance} />
    </CoreProvider>,
  );
  const hub = FakeWebSocket.instances[0]!;
  act(() => hub.open());
  return { api, mic, texts, hub };
}
const dictateButton = async () => {
  const b = (await screen.findByRole("button", { name: "Dictate" })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  return b;
};
const audioSocket = () => FakeWebSocket.last as AudioSocket;

describe("Dictate button", () => {
  it("does not touch the microphone or Core until the user clicks", async () => {
    const { api, mic } = mountButton();
    await dictateButton();
    expect(mic.started).toBe(0);
    expect(api.posts("/api/dictation/sessions")).toHaveLength(0);
    expect(
      FakeWebSocket.instances.filter((s) => s.url.includes("/api/dictation/stream")),
    ).toHaveLength(0);
  });

  it("is disabled, with the reason, while dictation is off, the recogniser is unavailable or the emergency stop is engaged", async () => {
    for (const [patch, reason] of [
      [{ enabled: false }, /Dictation is off/],
      [
        { recognizer: { available: false, detail: "No on-device speech recogniser configured" } },
        /No on-device speech recogniser/,
      ],
      [{ kill_switch_engaged: true }, /emergency stop/],
    ] as const) {
      const { mic } = mountButton({ status: patch });
      const button = (await screen.findByRole("button", { name: "Dictate" })) as HTMLButtonElement;
      await screen.findByText(reason);
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(mic.started).toBe(0);
      cleanup();
      FakeWebSocket.reset();
    }
  });

  it("click: session, same-origin stream with the token sub-protocol, mic only after `ready`, a visible indicator, PCM frames, then the text", async () => {
    const { api, mic, texts } = mountButton();
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(api.posts("/api/dictation/sessions")).toHaveLength(1));
    expect(api.posts("/api/dictation/sessions")[0]!.body).toEqual({});
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/dictation/stream"));
    const socket = audioSocket();
    expect(socket.url).toBe(
      `${window.location.origin.replace("http", "ws")}/api/dictation/stream?session=${ID}`,
    );
    expect(socket.protocols).toEqual(["phoenix.v1", "phoenix.token.tok"]);
    expect(socket.binaryType).toBe("arraybuffer");
    act(() => socket.open());
    expect(mic.started).toBe(0); // not until Core says ready
    socket.fromCore({ type: "ready" });
    await screen.findByTestId("dictation-indicator");
    await waitFor(() =>
      expect(screen.getByTestId("dictation-indicator").textContent).toMatch(
        /Listening: your microphone is on/,
      ),
    );
    expect(mic.started).toBe(1);

    act(() => mic.onPcm!(new Int16Array([1, 2, 3, 4])));
    act(() => mic.onPcm!(new Int16Array([5, 6])));
    expect(socket.frames.map((f) => Array.from(new Int16Array(f)))).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Stop dictating" }));
    expect(mic.stopped).toBeGreaterThan(0);
    expect(socket.sent).toContainEqual({ type: "end" });
    expect(screen.getByRole("button", { name: "Recognising…" })).toBeTruthy();
    api.set("POST " + `/api/dictation/sessions/${ID}/finish`, () => ({
      text: "hello world",
      words: 2,
      steps: { dictionary: 0, replacements: 0, snippet: false, cleanup: "off" },
    }));
    socket.fromCore({ type: "audio_ended" });
    await waitFor(() => expect(texts).toEqual(["hello world"]));
    expect(screen.queryByTestId("dictation-indicator")).toBeNull();
    expect(socket.closed).toBe(true);
    await screen.findByRole("button", { name: "Dictate" });
  });

  it("a refused microphone permission cancels the Core session and releases everything", async () => {
    const mic = fakeMic();
    mic.rejectWith = new Error("Permission denied");
    const { api } = mountButton({
      mic,
      routes: { [`DELETE /api/dictation/sessions/${ID}`]: () => ({ cancelled: true }) },
    });
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/dictation/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByText(/Microphone unavailable: Permission denied/);
    expect(screen.queryByTestId("dictation-indicator")).toBeNull();
    expect(mic.stopped).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "DELETE" && c.path === `/api/dictation/sessions/${ID}`),
      ).toBe(true),
    );
    expect(audioSocket().closed).toBe(true);
  });

  it("cancel stops the mic, closes the socket and cancels the session in Core", async () => {
    const { api, mic } = mountButton({
      routes: { [`DELETE /api/dictation/sessions/${ID}`]: () => ({ cancelled: true }) },
    });
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/dictation/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByTestId("dictation-indicator");
    fireEvent.click(screen.getByRole("button", { name: "Cancel dictation" }));
    expect(mic.stopped).toBeGreaterThan(0);
    expect(audioSocket().closed).toBe(true);
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(screen.queryByTestId("dictation-indicator")).toBeNull();
    // Audio produced after the cancel goes nowhere.
    expect(mic.onPcm).toBeNull();
  });

  it("when Core ends the session (kill switch) the indicator and microphone stop and the reason is shown", async () => {
    const { mic } = mountButton();
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/dictation/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByTestId("dictation-indicator");
    audioSocket().fromCore({ type: "ended", reason: "kill_switch" });
    await screen.findByText(/Dictation stopped: kill switch/);
    expect(screen.queryByTestId("dictation-indicator")).toBeNull();
    expect(mic.stopped).toBeGreaterThan(0);
  });

  it("a Core refusal is shown and no socket or microphone is opened", async () => {
    const { mic } = mountButton({
      routes: {
        "POST /api/dictation/sessions": () =>
          new Response(
            JSON.stringify({
              code: "CAPABILITY_DISABLED",
              message: "Dictation is off. Turn it on in Settings first",
            }),
            { status: 409 },
          ),
      },
    });
    fireEvent.click(await dictateButton());
    await screen.findByText(/Dictation is off\. Turn it on/);
    expect(mic.started).toBe(0);
    expect(
      FakeWebSocket.instances.filter((s) => s.url.includes("/api/dictation/stream")),
    ).toHaveLength(0);
  });

  it("unmounting while listening releases the microphone", async () => {
    const { mic } = mountButton({
      routes: { [`DELETE /api/dictation/sessions/${ID}`]: () => ({ cancelled: true }) },
    });
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/dictation/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByTestId("dictation-indicator");
    cleanup();
    expect(mic.stopped).toBeGreaterThan(0);
  });
});

describe("browser microphone seam", () => {
  function fakes() {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const processor: MicProcessorLike & { fire(samples: Float32Array): void } = {
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      fire(samples) {
        processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
      },
    };
    const audio: MicAudioContextLike = {
      sampleRate: 16000,
      destination: {},
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createScriptProcessor: () => processor,
      createGain: () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }),
      close: vi.fn(async () => {}),
    };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => tracks }));
    const devices: MicMediaDevicesLike = { getUserMedia };
    return { tracks, processor, audio, getUserMedia, devices };
  }
  it("asks for the microphone only in start(), converts to PCM16, and releases every track on stop", async () => {
    const f = fakes();
    const mic = createBrowserMicrophone({
      mediaDevices: () => f.devices,
      createAudioContext: () => f.audio,
    });
    expect(f.getUserMedia).not.toHaveBeenCalled();
    const frames: Int16Array[] = [];
    await mic.start((p) => frames.push(p));
    expect(f.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    f.processor.fire(new Float32Array([0, 1, -1, 0.5]));
    expect(Array.from(frames[0]!)).toEqual([0, 32767, -32768, 16384]);
    mic.stop();
    f.processor.fire(new Float32Array([1]));
    expect(frames).toHaveLength(1);
    expect(f.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    mic.stop(); // idempotent
    expect(floatToPcm16(new Float32Array([2, -2]))).toEqual(new Int16Array([32767, -32768]));
  });
  it("stopping while the browser prompt is open releases the stream as soon as it is granted", async () => {
    const f = fakes();
    const grant = Promise.withResolvers<{ getTracks(): { stop(): void }[] }>();
    f.devices.getUserMedia = vi.fn(() => grant.promise);
    const mic = createBrowserMicrophone({
      mediaDevices: () => f.devices,
      createAudioContext: () => f.audio,
    });
    const started = mic.start(() => {});
    mic.stop();
    grant.resolve({ getTracks: () => f.tracks });
    await started;
    expect(f.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
  });
  it("refuses a device that cannot provide 16 kHz and a browser without a microphone API", async () => {
    const f = fakes();
    const slow = { ...f.audio, sampleRate: 48000 };
    const mic = createBrowserMicrophone({
      mediaDevices: () => f.devices,
      createAudioContext: () => slow,
    });
    await expect(mic.start(() => {})).rejects.toThrow(/16 kHz/);
    expect(f.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    const none = createBrowserMicrophone({
      mediaDevices: () => undefined,
      createAudioContext: () => f.audio,
    });
    await expect(none.start(() => {})).rejects.toThrow(/cannot use a microphone/);
  });
});

function mountSettings(
  overrides: {
    status?: Partial<DictationStatus>;
    settings?: Partial<DictationSettings>;
    stats?: Partial<DictationStats>;
  } = {},
) {
  let settings: DictationSettings = { ...SETTINGS, ...overrides.settings };
  const api = fakeApi({
    "GET /api/dictation/status": () => ({
      ...STATUS,
      enabled: settings.enabled,
      ...overrides.status,
    }),
    "GET /api/dictation/settings": () => settings,
    "POST /api/dictation/settings": (body) => (settings = { ...settings, ...(body as object) }),
    "GET /api/dictation/stats": () => ({ ...STATS, ...overrides.stats }),
    "DELETE /api/dictation/stats": () => ({ deleted: 3 }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: window.location.origin,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <DictationSettingsSection />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

describe("Settings: Dictation", () => {
  it("is off by default and says plainly what leaves the device, what stays in memory and what is stored", async () => {
    const api = mountSettings();
    const box = (await screen.findByRole("checkbox", {
      name: "Turn on dictation",
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    const section = screen.getByRole("region", { name: "Dictation" });
    expect(
      within(section).getByText(/What leaves this device:/).parentElement!.textContent,
    ).toMatch(/nothing/);
    expect(within(section).getByText(/What stays in memory:/).parentElement!.textContent).toMatch(
      /never written to disk/,
    );
    expect(within(section).getByText(/What is stored:/).parentElement!.textContent).toMatch(
      /Never the text you dictate and never audio/,
    );
    expect(api.posts("/api/dictation/settings")).toHaveLength(0);
  });

  it("turning it on posts enabled:true and shows the honest recogniser status", async () => {
    const api = mountSettings({
      status: {
        recognizer: {
          available: false,
          detail: "No on-device speech recogniser that keeps audio off the disk is configured.",
        },
      },
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Turn on dictation" }));
    await waitFor(() =>
      expect(api.posts("/api/dictation/settings")[0]?.body).toEqual({ enabled: true }),
    );
    await screen.findByText("Dictation is on.");
    expect(screen.getByText(/Speech recogniser: unavailable/)).toBeTruthy();
  });

  it("edits dictionary, replacements and snippets with limits, then saves one vocabulary", async () => {
    const api = mountSettings({ settings: { enabled: true } });
    await screen.findByRole("heading", { name: "Dictionary, replacements and snippets" });
    // Regex-looking input is refused by the editor before it reaches Core.
    fireEvent.change(screen.getByLabelText("Replace the words"), { target: { value: "(a+)+$" } });
    expect(await screen.findByText(/plain words separated by single spaces/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Add replacement" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Replace the words"), { target: { value: "new line" } });
    fireEvent.change(screen.getByLabelText("With (empty removes them)"), {
      target: { value: "x\u202Ey" },
    });
    expect(
      (screen.getByRole("button", { name: "Add replacement" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("With (empty removes them)"), {
      target: { value: "<br>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add replacement" }));
    fireEvent.change(screen.getByLabelText("Term"), { target: { value: "Phoenix" } });
    fireEvent.click(screen.getByRole("button", { name: "Add dictionary entry" }));
    fireEvent.change(screen.getByLabelText("Term"), { target: { value: "C++" } });
    expect(
      (screen.getByRole("button", { name: "Add dictionary entry" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Sounds like (optional)"), {
      target: { value: "see plus plus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add dictionary entry" }));
    fireEvent.change(screen.getByLabelText("When I say"), { target: { value: "my sig" } });
    fireEvent.change(screen.getByLabelText("Insert this text"), { target: { value: "Best,\nA" } });
    fireEvent.click(screen.getByRole("button", { name: "Add snippet" }));
    fireEvent.click(screen.getByRole("button", { name: "Save word lists" }));
    await waitFor(() => expect(api.posts("/api/dictation/settings")).toHaveLength(1));
    expect(api.posts("/api/dictation/settings")[0]!.body).toEqual({
      vocabulary: {
        dictionary: [{ term: "Phoenix" }, { term: "C++", sounds_like: "see plus plus" }],
        replacements: [{ from: "new line", to: "<br>" }],
        snippets: [{ trigger: "my sig", text: "Best,\nA" }],
      },
    });
    await screen.findByText("Word lists saved.");
  });

  it("removing an entry updates the list before saving", async () => {
    mountSettings({
      settings: {
        enabled: true,
        vocabulary: { dictionary: [{ term: "Fawkes" }], replacements: [], snippets: [] },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Remove dictionary entry Fawkes" }));
    expect(screen.queryByRole("button", { name: "Remove dictionary entry Fawkes" })).toBeNull();
  });

  it("per-app clean-up modes and the default are saved through user-only settings", async () => {
    const api = mountSettings({ settings: { enabled: true } });
    fireEvent.change(await screen.findByLabelText("Default clean-up"), {
      target: { value: "natural" },
    });
    await waitFor(() =>
      expect(api.posts("/api/dictation/settings")[0]?.body).toEqual({ default_mode: "natural" }),
    );
    fireEvent.change(screen.getByLabelText(/App identifier/), { target: { value: "bad id!" } });
    expect(screen.getByText(/Use letters, digits/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Set app clean-up" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/App identifier/), {
      target: { value: "com.example.mail" },
    });
    fireEvent.change(screen.getByLabelText("Clean-up for this app"), {
      target: { value: "polished" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set app clean-up" }));
    await waitFor(() =>
      expect(api.posts("/api/dictation/settings")[1]?.body).toEqual({
        app_modes: { "com.example.mail": "polished" },
      }),
    );
  });

  it("shows statistics and deletes them only after a confirmation", async () => {
    const api = mountSettings({
      settings: { enabled: true },
      stats: {
        words: 640,
        sessions: 8,
        speech_ms: 230_000,
        typing_ms: 960_000,
        saved_ms: 730_000,
        average_wpm: 167,
        streak_days: 2,
        top_apps: [{ app: "com.example.mail", words: 500, sessions: 5 }],
      },
    });
    await screen.findByText("640");
    expect(screen.getByText(/12 min 10 s/)).toBeTruthy();
    expect(screen.getByText(/167 words per minute/)).toBeTruthy();
    expect(screen.getByText("2 days")).toBeTruthy();
    expect(screen.getByText(/com\.example\.mail \(500 words\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete all dictation statistics" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete all dictation statistics" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete all" }));
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "DELETE" && c.path === "/api/dictation/stats"),
      ).toBe(true),
    );
    await screen.findByText("All dictation statistics were deleted.");
  });

  it("reports an unavailable Core instead of an empty form", async () => {
    const api = fakeApi({ "GET /api/dictation/status": () => new Response("{}", { status: 503 }) });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: window.location.origin,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <DictationSettingsSection />
      </CoreProvider>,
    );
    await screen.findByText(/unavailable from Phoenix Core/);
  });
});

describe("Chat box wiring", () => {
  it("the chat shows a Dictate button that does nothing (no microphone, no session) until it is clicked, and says why it is blocked", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const { api } = mountApp({
      "GET /api/dictation/status": () => ({ ...STATUS, enabled: false }),
    });
    openPanel();
    openTab("Chat");
    const button = (await screen.findByRole("button", { name: "Dictate" })) as HTMLButtonElement;
    await screen.findByText(/Dictation is off\. Turn it on in Settings/);
    expect(button.disabled).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(api.posts("/api/dictation/sessions")).toHaveLength(0);
  });
});
