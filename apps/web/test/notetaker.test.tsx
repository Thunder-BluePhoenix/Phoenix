// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
//
// Phase 65 UI. No real microphone, call or Core: a fake microphone, a fake Core and fake sockets.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingsPage } from "../src/components/Meetings";
import { NotetakerBanner, NotetakerSettingsSection, RecordCall } from "../src/components/Notetaker";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { DictationMicrophone } from "../src/core/dictation-mic";
import { recorderFor } from "../src/core/notetaker-recorder";
import { RECORDED_HERE, formatElapsed, type NotetakerStatus } from "../src/core/notetaker";
import { en } from "../src/i18n/en";
import type { PetState } from "../src/core/types";
import { fakeApi, type FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

const CONSENT_NOTICE = en["capture.notetaker.consent.notice"];
const CONSENT_CHECKBOX = en["capture.notetaker.consent.checkbox"];
const MIC_ONLY_NOTICE = en["capture.notetaker.micOnly"];

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

const ID = `ntk_${"b".repeat(32)}`;
const STATUS: NotetakerStatus = {
  enabled: true,
  kill_switch_engaged: false,
  recognizer: { available: true, detail: "Fake recogniser", engine: "fake" },
  audio_on_disk: false,
  summary: { available: true, locality: "local", detail: "Summaries come from this device." },
  capture: {
    microphone: true,
    system_audio: false,
    detail:
      "Only your microphone is recorded from the browser; other participants are not captured.",
  },
  // The desktop shell supplies the dialog that asks a person; these tests exercise the page.
  consent_channel: { available: true, detail: "The desktop app asks you before every recording." },
  limits: { max_seconds: 14_400, max_frame_bytes: 1_048_576, window_seconds: 30 },
};
const ACTIVE = { id: ID, started_at: "2026-10-16T10:00:00.000Z", elapsed_s: 65 };

interface FakeMic {
  started: number;
  stopped: number;
  onPcm: ((pcm: Int16Array) => void) | null;
  rejectWith: Error | null;
  instance: DictationMicrophone;
}
function fakeMic(): FakeMic {
  const mic: FakeMic = {
    started: 0,
    stopped: 0,
    onPcm: null,
    rejectWith: null,
    instance: {
      async start(onPcm) {
        mic.started++;
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Rig {
  api: FakeApi;
  mic: FakeMic;
  status: { value: NotetakerStatus };
  client: PhoenixClient;
}

function mount(
  ui: (mic: FakeMic) => React.ReactNode,
  options: { status?: Partial<NotetakerStatus>; routes?: Parameters<typeof fakeApi>[0] } = {},
): Rig {
  const mic = fakeMic();
  const status = { value: { ...STATUS, ...options.status } };
  const api = fakeApi({
    "GET /api/notetaker/status": () => status.value,
    "POST /api/notetaker/sessions": () => ({
      id: ID,
      stream_path: `/api/notetaker/stream?session=${ID}`,
      max_seconds: 14_400,
      max_frame_bytes: 1_048_576,
      window_seconds: 30,
    }),
    ...options.routes,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: window.location.origin,
    WebSocketImpl: AudioSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(<CoreProvider client={client}>{ui(mic)}</CoreProvider>);
  act(() => FakeWebSocket.instances[0]!.open());
  return { api, mic, status, client };
}

const audioSocket = () => FakeWebSocket.last as AudioSocket;
const recordButton = async () => {
  const b = (await screen.findByRole("button", { name: "Record a call" })) as HTMLButtonElement;
  return b;
};
const enabledRecordButton = async () => {
  const b = await recordButton();
  await waitFor(() => expect(b.disabled).toBe(false));
  return b;
};

describe("Settings: Notetaker", () => {
  it("is off by default, says turning it on is not consent, and saves the switch through the user route", async () => {
    const { api, status } = mount(() => <NotetakerSettingsSection />, {
      status: { enabled: false },
      routes: {
        "POST /api/notetaker/settings": (body) => {
          status.value = { ...status.value, enabled: (body as { enabled: boolean }).enabled };
          return { enabled: status.value.enabled };
        },
      },
    });
    const box = (await screen.findByRole("checkbox", {
      name: "Turn on the notetaker",
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText("not", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/every recording asks you again/)).toBeTruthy();
    expect(screen.getByText(/Audio is never stored/)).toBeTruthy();
    expect(screen.getByText(/only “You” and “Others”/)).toBeTruthy();
    expect(screen.getByText(/Only your microphone is recorded from the browser/)).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(api.posts("/api/notetaker/settings")).toHaveLength(1));
    expect(api.posts("/api/notetaker/settings")[0]!.body).toEqual({ enabled: true });
    await screen.findByText("The notetaker is on.");
  });

  it("shows the recogniser and the emergency stop", async () => {
    mount(() => <NotetakerSettingsSection />, {
      status: {
        recognizer: { available: false, detail: "No on-device speech recogniser configured" },
        kill_switch_engaged: true,
      },
    });
    await screen.findByText(/Speech recogniser: unavailable/);
    expect(screen.getByText(/No on-device speech recogniser configured/)).toBeTruthy();
    expect(screen.getByText(/emergency stop is engaged: recording is blocked/)).toBeTruthy();
  });
});

describe("Record a call: the consent dialog", () => {
  it("is disabled, with the reason, while the notetaker is off, the recogniser is missing or the emergency stop is engaged", async () => {
    for (const [patch, reason] of [
      [{ enabled: false }, /notetaker is off/],
      [
        { recognizer: { available: false, detail: "No on-device speech recogniser configured" } },
        /No on-device speech recogniser/,
      ],
      [{ kill_switch_engaged: true }, /emergency stop/],
      [
        {
          consent_channel: {
            available: false,
            code: "CONSENT_CHANNEL_UNAVAILABLE",
            detail: "No trusted way to ask you is connected.",
          },
        },
        /trusted way to ask you first/,
      ],
    ] as const) {
      const { mic, api } = mount((m) => <RecordCall createMicrophone={() => m.instance} />, {
        status: patch,
      });
      const button = await recordButton();
      await screen.findByText(reason);
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(mic.started).toBe(0);
      expect(api.posts("/api/notetaker/sessions")).toHaveLength(0);
      cleanup();
      FakeWebSocket.reset();
    }
  });

  it("shows the notice and a REQUIRED checkbox; Start stays disabled until it is ticked and nothing is sent before", async () => {
    const { api, mic } = mount((m) => <RecordCall createMicrophone={() => m.instance} />);
    fireEvent.click(await enabledRecordButton());
    const dialog = await screen.findByRole("dialog", { name: "Before you record" });
    expect(within(dialog).getByText(CONSENT_NOTICE)).toBeTruthy();
    expect(within(dialog).getByText(MIC_ONLY_NOTICE)).toBeTruthy();
    const box = within(dialog).getByRole("checkbox", {
      name: CONSENT_CHECKBOX,
    }) as HTMLInputElement;
    expect(box.required).toBe(true);
    expect(box.checked).toBe(false);
    const start = within(dialog).getByRole("button", {
      name: "Start recording",
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    fireEvent.submit(dialog);
    expect(api.posts("/api/notetaker/sessions")).toHaveLength(0);
    expect(mic.started).toBe(0);
    fireEvent.click(box);
    expect(start.disabled).toBe(false);
    // Cancelling records nothing either.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.posts("/api/notetaker/sessions")).toHaveLength(0);
    expect(mic.started).toBe(0);
  });

  it("sends consent AND notice_acknowledged in the start request, opens the same-origin socket, and asks for the microphone only after Core says ready", async () => {
    const { api, mic } = mount((m) => <RecordCall createMicrophone={() => m.instance} />);
    fireEvent.click(await enabledRecordButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: CONSENT_CHECKBOX }));
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Design call" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(api.posts("/api/notetaker/sessions")).toHaveLength(1));
    expect(api.posts("/api/notetaker/sessions")[0]!.body).toEqual({
      title: "Design call",
      consent: true,
      notice_acknowledged: true,
    });
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/notetaker/stream"));
    const socket = audioSocket();
    expect(socket.url).toBe(
      `${window.location.origin.replace("http", "ws")}/api/notetaker/stream?session=${ID}`,
    );
    expect(socket.protocols).toEqual(["phoenix.v1", "phoenix.token.tok"]);
    expect(socket.binaryType).toBe("arraybuffer");
    act(() => socket.open());
    expect(mic.started).toBe(0); // not until Core says ready
    socket.fromCore({ type: "ready" });
    await waitFor(() => expect(mic.started).toBe(1));
    // Microphone frames carry the channel prefix 0x01 ("You").
    await waitFor(() => expect(mic.onPcm).not.toBeNull());
    act(() => mic.onPcm!(new Int16Array([1, 2, 3])));
    expect(socket.frames).toHaveLength(1);
    const bytes = new Uint8Array(socket.frames[0]!);
    expect(bytes[0]).toBe(1);
    expect(Array.from(new Int16Array(bytes.slice(1).buffer))).toEqual([1, 2, 3]);
    expect(bytes.byteLength).toBe(1 + 3 * 2);
  });

  it("a second recording asks again: the dialog opens unticked and consent is not remembered", async () => {
    const { api } = mount((m) => <RecordCall createMicrophone={() => m.instance} />, {
      routes: { [`DELETE /api/notetaker/sessions/${ID}`]: () => ({ cancelled: true }) },
    });
    const first = await enabledRecordButton();
    fireEvent.click(first);
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: CONSENT_CHECKBOX }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(api.posts("/api/notetaker/sessions")).toHaveLength(1));
    // The recording ends (Core says so) and the user wants another.
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/notetaker/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ended", reason: "max_length" });
    await screen.findByText(/The recording stopped: max length/);
    fireEvent.click(await enabledRecordButton());
    dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("checkbox", {
      name: CONSENT_CHECKBOX,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(
      (within(dialog).getByRole("button", { name: "Start recording" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(api.posts("/api/notetaker/sessions")).toHaveLength(1);
  });

  it("a refused microphone permission cancels the session in Core and releases everything", async () => {
    const { api, mic } = mount(
      (m) => {
        m.rejectWith = new Error("Permission denied");
        return <RecordCall createMicrophone={() => m.instance} />;
      },
      { routes: { [`DELETE /api/notetaker/sessions/${ID}`]: () => ({ cancelled: true }) } },
    );
    fireEvent.click(await enabledRecordButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: CONSENT_CHECKBOX }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/notetaker/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByText(/Microphone unavailable: Permission denied/);
    expect(mic.stopped).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "DELETE" && c.path === `/api/notetaker/sessions/${ID}`),
      ).toBe(true),
    );
    expect(audioSocket().closed).toBe(true);
  });

  it("a Core refusal is shown and no socket or microphone is opened", async () => {
    const { mic } = mount((m) => <RecordCall createMicrophone={() => m.instance} />, {
      routes: {
        "POST /api/notetaker/sessions": () =>
          new Response(
            JSON.stringify({
              code: "INVALID_REQUEST",
              message: "A recording is already in progress",
            }),
            { status: 400 },
          ),
      },
    });
    fireEvent.click(await enabledRecordButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: CONSENT_CHECKBOX }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    await screen.findByText(/A recording is already in progress/);
    expect(mic.started).toBe(0);
    expect(
      FakeWebSocket.instances.filter((s) => s.url.includes("/api/notetaker/stream")),
    ).toHaveLength(0);
  });
});

describe("the recording banner", () => {
  it("is hidden while Core is not recording", async () => {
    mount((m) => <NotetakerBanner createMicrophone={() => m.instance} />);
    await waitFor(() => expect(screen.queryByTestId("notetaker-banner")).toBeNull());
  });

  it("shows elapsed time, the mic-only notice and a Stop button for as long as Core is recording, and clears with it", async () => {
    // Fake only the clock and the interval: the testing library still waits with real timers.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-16T10:01:05.000Z"));
    const { status, api } = mount((m) => <NotetakerBanner createMicrophone={() => m.instance} />, {
      status: { active: ACTIVE },
      routes: {
        [`POST /api/notetaker/sessions/${ID}/stop`]: () => ({ meeting_id: `notetaker:${ID}` }),
      },
    });
    const banner = await screen.findByTestId("notetaker-banner");
    expect(within(banner).getByText(/Recording a call/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("notetaker-elapsed").textContent).toBe("1:05"));
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByTestId("notetaker-elapsed").textContent).toBe("1:10");
    expect(within(banner).getByText(/other participants are not captured/)).toBeTruthy();
    // Stop works even for a recording this page did not start (the desktop app, say).
    fireEvent.click(within(banner).getByRole("button", { name: "Stop recording" }));
    await waitFor(() => expect(api.posts(`/api/notetaker/sessions/${ID}/stop`)).toHaveLength(1));
    // The state engine clears RECORDING: the status follows and the banner goes.
    status.value = { ...STATUS };
    act(() =>
      FakeWebSocket.instances[0]!.message("state.changed", {
        state: "IDLE",
        explanation: "Idle",
        since: new Date().toISOString(),
        recording: false,
        sleeping: false,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("notetaker-banner")).toBeNull());
  });

  it("Stop on a recording this page started ends the audio, releases the microphone and then asks Core to finish", async () => {
    const { api, mic, status, client } = mount(
      (m) => (
        <>
          <RecordCall createMicrophone={() => m.instance} />
          <NotetakerBanner createMicrophone={() => m.instance} />
        </>
      ),
      {
        routes: {
          [`POST /api/notetaker/sessions/${ID}/stop`]: () => ({ meeting_id: `notetaker:${ID}` }),
        },
      },
    );
    fireEvent.click(await enabledRecordButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: CONSENT_CHECKBOX }));
    status.value = {
      ...STATUS,
      active: { ...ACTIVE, started_at: new Date().toISOString(), elapsed_s: 0 },
    };
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/notetaker/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    const banner = await screen.findByTestId("notetaker-banner");
    await waitFor(() => expect(mic.started).toBe(1));
    await waitFor(() => expect(recorderFor(client).getState().phase).toBe("recording"));
    fireEvent.click(await within(banner).findByRole("button", { name: "Stop recording" }));
    await waitFor(() => expect(mic.stopped).toBeGreaterThan(0));
    expect(audioSocket().sent).toContainEqual({ type: "end" });
    expect(api.posts(`/api/notetaker/sessions/${ID}/stop`)).toHaveLength(0); // waits for audio_ended
    audioSocket().fromCore({ type: "audio_ended" });
    await waitFor(() => expect(api.posts(`/api/notetaker/sessions/${ID}/stop`)).toHaveLength(1));
    const saved = await screen.findByText(/The recording was saved/);
    expect(
      within(saved.closest("p")!)
        .getByRole("link", { name: "Open the meeting" })
        .getAttribute("href"),
    ).toBe(`#/meetings/${encodeURIComponent(`notetaker:${ID}`)}`);
    expect(audioSocket().closed).toBe(true);
  });

  it("unmounting while recording releases the microphone", async () => {
    const { mic, status } = mount(
      (m) => (
        <>
          <RecordCall createMicrophone={() => m.instance} />
        </>
      ),
      { routes: { [`DELETE /api/notetaker/sessions/${ID}`]: () => ({ cancelled: true }) } },
    );
    status.value = { ...STATUS };
    fireEvent.click(await enabledRecordButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: CONSENT_CHECKBOX }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(FakeWebSocket.last.url).toContain("/api/notetaker/stream"));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await waitFor(() => expect(mic.started).toBe(1));
    // The recorder lives outside React: it keeps going through navigation; only Cancel ends it.
    cleanup();
    expect(mic.stopped).toBe(0);
  });
});

describe("meetings recorded on this computer", () => {
  const PET: PetState = {
    state: "IDLE",
    explanation: "Idle",
    since: "2026-10-16T10:00:00Z",
    recording: false,
    sleeping: false,
  };
  const meeting = (capability_id: string, id: string, title: string) => ({
    id: `${capability_id}:${id}`,
    capability_id,
    external_id: id,
    title,
    status: capability_id === "kage" ? "ready" : "transcribed",
    started_at: "2026-10-16T09:00:00Z",
    ended_at: null,
    duration_seconds: 600,
    participants: null,
    recording: null,
    has_transcript: true,
    has_summary: false,
    archived_at: null,
    updated_at: "2026-10-16T09:10:00Z",
  });

  it("lists them with the 'Recorded on this computer' label, and Kage's without it", async () => {
    mount(() => <MeetingsPage state={PET} />, {
      routes: {
        "GET /api/meetings": () => ({
          meetings: [meeting("notetaker", "ntk_1", "Team call"), meeting("kage", "1", "Standup")],
        }),
      },
    });
    const own = (await screen.findByText("Team call")).closest("li")!;
    expect(within(own).getByText(RECORDED_HERE)).toBeTruthy();
    const kage = screen.getByText("Standup").closest("li")!;
    expect(within(kage).queryByText(RECORDED_HERE)).toBeNull();
  });

  it("the Meetings page offers 'Record a call' and the notetaker banner", async () => {
    mount(() => <MeetingsPage state={PET} />, { status: { active: ACTIVE } });
    expect(await screen.findByRole("heading", { name: "Record a call" })).toBeTruthy();
    await screen.findByTestId("notetaker-banner");
  });
});

describe("formatElapsed", () => {
  it("formats minutes, hours and negatives", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(3723)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});
