// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Call } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import {
  FINISH,
  ID,
  SESSION,
  audioSocket,
  beginListening,
  dictateButton,
  dots,
  fakeMic,
  fakeShell,
  mountPill,
  sessionSockets,
  statusText,
} from "./pill-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const deletes = (api: { calls: Call[] }) =>
  api.calls.filter((c) => c.method === "DELETE" && c.path === SESSION);
const dotLevels = () => dots().map((d) => Number(d.getAttribute("data-level")));

describe("pill dots", () => {
  it("are small and still when idle: no frame is scheduled and every dot is at rest", async () => {
    const { frames, analyser } = mountPill();
    await dictateButton();
    expect(frames.pending()).toBe(0);
    expect(dots()).toHaveLength(5);
    expect(dotLevels()).toEqual([0, 0, 0, 0, 0]);
    expect(analyser.pushed).toHaveLength(0);
    expect(screen.getByTestId("pill-dots").parentElement?.parentElement?.dataset.state).toBe(
      "idle",
    );
  });

  it("follow the voice level while listening, the middle dot most, and rest again afterwards", async () => {
    const { frames, analyser, mic } = mountPill();
    await beginListening();
    // The frame is scheduled by an effect that runs after the "Listening" text is on screen.
    await waitFor(() => expect(frames.pending()).toBe(1));

    analyser.value = 0.2;
    frames.tick();
    const quiet = dotLevels();
    analyser.value = 0.9;
    frames.tick();
    const loud = dotLevels();

    expect(loud[2]).toBeCloseTo(0.9, 2);
    expect(loud[0]).toBeCloseTo(0.54, 2);
    expect(loud[1]).toBeCloseTo(0.77, 2);
    expect(loud[0]).toBe(loud[4]);
    expect(loud[2]!).toBeGreaterThan(loud[1]!);
    expect(loud[1]!).toBeGreaterThan(loud[0]!);
    quiet.forEach((q, i) => expect(loud[i]!).toBeGreaterThan(q));

    // The size and opacity are driven by the same level.
    const style = dots()[2]!.getAttribute("style") ?? "";
    expect(style).toContain("--dot-scale: 2.44");
    expect(style).toContain("--dot-opacity: 1.00");

    // Stopping: the dots go back to rest at once and no more frames are scheduled.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(dotLevels()).toEqual([0, 0, 0, 0, 0]));
    expect(frames.pending()).toBe(0);
    expect(analyser.resets).toBeGreaterThan(0);
    expect(mic.stopped).toBeGreaterThan(0);
  });

  it("pushes the PCM the microphone delivers into the analyser and the socket, and nothing after stop", async () => {
    const { analyser, mic } = mountPill();
    await beginListening();
    const frame = new Int16Array([100, -200, 300]);
    act(() => mic.onPcm!(frame));
    expect(analyser.pushed).toEqual([frame]);
    expect(audioSocket().frames).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(mic.onPcm).toBeNull(); // the fake mic drops its callback on stop
  });
});

describe("pill buttons", () => {
  it("do not touch the microphone or Core until the user starts", async () => {
    const { api, mic } = mountPill();
    await dictateButton();
    expect(mic.started).toBe(0);
    expect(api.posts("/api/dictation/sessions")).toHaveLength(0);
    expect(sessionSockets()).toHaveLength(0);
    expect(statusText()).toBe("Ready");
  });

  it.each([
    [{ enabled: false }, /Dictation is off/],
    [
      { recognizer: { available: false, detail: "No on-device speech recogniser configured" } },
      /No on-device speech recogniser/,
    ],
    [{ kill_switch_engaged: true }, /emergency stop/],
  ] as const)("disable Dictate and say why when %j", async (patch, reason) => {
    const { mic } = mountPill({ status: patch });
    const button = (await screen.findByRole("button", { name: "Dictate" })) as HTMLButtonElement;
    await waitFor(() => expect(statusText()).toMatch(reason));
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mic.started).toBe(0);
    // The other two buttons stay usable.
    expect(
      (screen.getByRole("button", { name: "Open Phoenix" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("Record a call only opens /notetaker: no session, no socket, no microphone", async () => {
    const { shell, api, mic } = mountPill();
    await dictateButton();
    const before = api.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Record a call" }));
    expect(shell!.opened).toEqual(["/notetaker"]);
    expect(mic.started).toBe(0);
    expect(api.posts("/api/dictation/sessions")).toHaveLength(0);
    expect(sessionSockets()).toHaveLength(0);
    expect(shell!.pasted).toEqual([]);
    expect(api.calls.slice(before).filter((c) => c.method !== "GET")).toEqual([]);
    expect(statusText()).toBe("Ready");
  });

  it("Record a call never calls getUserMedia", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
    try {
      mountPill({ useDefaultMic: true });
      await dictateButton();
      fireEvent.click(screen.getByRole("button", { name: "Record a call" }));
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Open Phoenix opens the home route", async () => {
    const { shell } = mountPill();
    await dictateButton();
    fireEvent.click(screen.getByRole("button", { name: "Open Phoenix" }));
    expect(shell!.opened).toEqual(["/"]);
  });

  it("in a plain browser the two route buttons go through the injected opener", async () => {
    const opened: string[] = [];
    mountPill({ shell: null, openInBrowser: (route) => void opened.push(route) });
    await dictateButton();
    fireEvent.click(screen.getByRole("button", { name: "Record a call" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Phoenix" }));
    expect(opened).toEqual(["/notetaker", "/"]);
  });

  it("the buttons are real buttons that can take focus", async () => {
    mountPill();
    await dictateButton();
    for (const name of ["Dictate", "Record a call", "Open Phoenix"]) {
      const button = screen.getByRole("button", { name });
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });
});

describe("pill dictation", () => {
  it("Dictate -> session -> ready -> mic -> Listening for the whole capture -> Stop -> end -> finish -> paste once -> Pasted", async () => {
    const { api, mic, shell } = mountPill({ text: "hello world" });
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(api.posts("/api/dictation/sessions")).toHaveLength(1));
    expect(api.posts("/api/dictation/sessions")[0]!.body).toEqual({});
    await waitFor(() => expect(sessionSockets()).toHaveLength(1));
    const socket = audioSocket();
    expect(socket.url).toBe(
      `${window.location.origin.replace("http", "ws")}/api/dictation/stream?session=${ID}`,
    );
    expect(socket.protocols).toEqual(["phoenix.v1", "phoenix.token.tok"]);
    act(() => socket.open());
    expect(mic.started).toBe(0); // not until Core says ready
    socket.fromCore({ type: "ready" });
    await screen.findByText("Listening: your microphone is on");
    expect(mic.started).toBe(1);
    expect(screen.getByRole("status").closest("[data-state]")?.getAttribute("data-state")).toBe(
      "listening",
    );

    act(() => mic.onPcm!(new Int16Array([1, 2, 3, 4])));
    // Still listening after audio flows.
    expect(statusText()).toBe("Listening: your microphone is on");
    expect(socket.frames.map((f) => Array.from(new Int16Array(f)))).toEqual([[1, 2, 3, 4]]);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(mic.stopped).toBeGreaterThan(0);
    expect(socket.sent).toContainEqual({ type: "end" });
    expect(statusText()).toBe("Recognising…");
    expect(shell!.pasted).toEqual([]);

    socket.fromCore({ type: "audio_ended" });
    await screen.findByText("Pasted");
    expect(shell!.pasted).toEqual(["hello world"]);
    expect(api.posts(FINISH)).toHaveLength(1);
    expect(socket.closed).toBe(true);
    expect(shell!.ended_).toBe(0); // the paste already told the shell
    await dictateButton();
    // A second audio_ended (or a late close) cannot paste again.
    socket.fromCore({ type: "audio_ended" });
    await act(async () => {});
    expect(shell!.pasted).toEqual(["hello world"]);
    expect(api.posts(FINISH)).toHaveLength(1);
  });

  it("does not put the dictated text on the page when a shell pastes it", async () => {
    const { mic, shell } = mountPill({ text: "my private sentence" });
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByText("Pasted");
    expect(document.body.textContent).not.toContain("my private sentence");
    expect(shell!.pasted).toEqual(["my private sentence"]);
    expect(mic.stopped).toBeGreaterThan(0);
  });

  it("shows 'Typed' when the shell typed the text instead of pasting it", async () => {
    const shell = fakeShell();
    shell.pasteImpl = async () => ({ pasted: "typed" });
    mountPill({ shell });
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByText("Typed");
  });

  it.each([
    ["secure_input", "A password field is focused, so nothing was pasted."],
    ["permission_needed", "Phoenix needs permission to paste. Open System Settings to allow it."],
    ["typing_unavailable", "The text could not be typed here."],
    ["wrong_window", "The window changed, so nothing was pasted."],
    ["paste_failed", "Pasting failed."],
  ])(
    "a %s paste error shows the human message and the microphone is already stopped",
    async (code, message) => {
      const { shell, mic } = mountPill({ text: "never shown in errors" });
      shell!.pasteImpl = () => Promise.reject({ code, message });
      await beginListening();
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      audioSocket().fromCore({ type: "audio_ended" });
      await screen.findByText(message);
      expect(document.body.textContent).not.toContain("never shown in errors");
      expect(mic.stopped).toBeGreaterThan(0);
      expect(shell!.pasted).toEqual(["never shown in errors"]);
      expect(shell!.ended_).toBe(0);
      await dictateButton(); // back to idle: the user can try again
    },
  );

  it("a paste error that carries no message still shows a safe sentence", async () => {
    const { shell } = mountPill();
    shell!.pasteImpl = () => Promise.reject(new Error(""));
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByText("The text could not be pasted.");
  });

  it("nothing recognised: tells the user and the shell, and pastes nothing", async () => {
    const { shell } = mountPill({ text: "" });
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByText("Nothing was recognised.");
    expect(shell!.pasted).toEqual([]);
    expect(shell!.ended_).toBe(1);
  });

  it("a failing finish call tells the shell the attempt is over and pastes nothing", async () => {
    const { shell } = mountPill({
      routes: {
        [`POST ${FINISH}`]: () =>
          new Response(JSON.stringify({ code: "INTERNAL", message: "Recogniser crashed" }), {
            status: 500,
          }),
      },
    });
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByText(/Recogniser crashed/);
    expect(shell!.pasted).toEqual([]);
    expect(shell!.ended_).toBe(1);
  });

  it("a Core refusal is shown; no socket or microphone is opened and the shell is told", async () => {
    const { mic, shell } = mountPill({
      routes: {
        "POST /api/dictation/sessions": () =>
          new Response(
            JSON.stringify({
              code: "CAPABILITY_DISABLED",
              message: "Dictation is off. Turn it on",
            }),
            { status: 409 },
          ),
      },
    });
    fireEvent.click(await dictateButton());
    await screen.findByText(/Dictation is off\. Turn it on/);
    expect(mic.started).toBe(0);
    expect(sessionSockets()).toHaveLength(0);
    expect(shell!.ended_).toBe(1);
  });

  it("a refused microphone permission cancels the Core session, releases everything and tells the shell", async () => {
    const mic = fakeMic();
    mic.rejectWith = new Error("Permission denied");
    const { api, shell } = mountPill({ mic });
    await beginListeningUntilReady();
    await screen.findByText(/Microphone unavailable: Permission denied/);
    expect(mic.stopped).toBeGreaterThan(0);
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
    expect(audioSocket().closed).toBe(true);
    expect(shell!.ended_).toBe(1);
    expect(shell!.pasted).toEqual([]);
  });

  it("when Core ends the session (kill switch) the indicator and microphone stop and the reason is shown", async () => {
    const { mic, shell } = mountPill();
    await beginListening();
    audioSocket().fromCore({ type: "ended", reason: "kill_switch" });
    await screen.findByText(/Dictation stopped: kill switch/);
    expect(statusText()).not.toMatch(/Listening/);
    expect(mic.stopped).toBeGreaterThan(0);
    expect(shell!.ended_).toBe(1);
  });

  it("asks the microphone only once even if Core repeats `ready`", async () => {
    const { mic } = mountPill();
    await beginListening();
    audioSocket().fromCore({ type: "ready" });
    expect(mic.started).toBe(1);
  });

  it("losing the Core connection during the capture abandons it and releases the microphone", async () => {
    const { mic, hub, shell } = mountPill();
    await beginListening();
    act(() => hub.drop());
    await screen.findByText("Phoenix Core is not connected.");
    expect(mic.stopped).toBeGreaterThan(0);
    expect(audioSocket().closed).toBe(true);
    expect(shell!.pasted).toEqual([]);
    expect(shell!.ended_).toBe(1);
  });

  it("closing the audio socket mid-capture abandons it", async () => {
    const { mic } = mountPill();
    await beginListening();
    act(() => audioSocket().drop());
    await screen.findByText("The audio connection closed.");
    expect(mic.stopped).toBeGreaterThan(0);
  });

  it("unmounting while listening releases the microphone and deletes the session", async () => {
    const { mic, api, unmount } = mountPill();
    await beginListening();
    unmount();
    expect(mic.stopped).toBeGreaterThan(0);
    expect(audioSocket().closed).toBe(true);
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
  });

  it("in a plain browser the text is shown (not pasted) and can be copied", async () => {
    const copied: string[] = [];
    const { api } = mountPill({
      shell: null,
      text: "shown in the browser",
      copyText: async (text) => void copied.push(text),
    });
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    expect((await screen.findByTestId("pill-text")).textContent).toBe("shown in the browser");
    expect(api.posts(FINISH)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(copied).toEqual(["shown in the browser"]);
    // A new attempt clears the old text.
    fireEvent.click(await dictateButton());
    await waitFor(() => expect(screen.queryByTestId("pill-text")).toBeNull());
  });

  it("in a plain browser without a clipboard there is no Copy button", async () => {
    mountPill({ shell: null, copyText: null });
    await beginListening();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByTestId("pill-text");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});

/** Like beginListening, but only drives the socket to `ready` (the microphone may refuse). */
async function beginListeningUntilReady() {
  fireEvent.click(await dictateButton());
  await waitFor(() => expect(sessionSockets()).toHaveLength(1));
  act(() => audioSocket().open());
  audioSocket().fromCore({ type: "ready" });
}

describe("pill shell commands", () => {
  it("registers the listener first and only then tells the shell the page is ready", async () => {
    const { shell } = mountPill();
    await waitFor(() => expect(shell!.log).toEqual(["listen-error", "listen", "ready"]));
  });

  it("shows a shell hotkey refusal and clears it on the next start and normal outcome", async () => {
    const { shell, api } = mountPill();
    await waitFor(() => expect(shell!.log).toContain("ready"));
    shell!.emitError("Microphone permission is needed.");
    expect(statusText()).toBe("Microphone permission is needed.");
    expect(screen.getByRole("status").closest("[data-tone]")?.getAttribute("data-tone")).toBe(
      "error",
    );
    expect(api.posts("/api/dictation/sessions")).toHaveLength(0);
    shell!.emit({ action: "start" });
    await waitFor(() => expect(sessionSockets()).toHaveLength(1));
    expect(statusText()).not.toContain("Microphone permission");
    shell!.emit({ action: "cancel" });
    expect(statusText()).toBe("Ready");
  });

  it("start begins a session, stop finishes and pastes it", async () => {
    const { shell, api, mic } = mountPill({ text: "dictated by hotkey" });
    await dictateButton();
    shell!.emit({ action: "start", mode: "hold" });
    await waitFor(() => expect(sessionSockets()).toHaveLength(1));
    expect(api.posts("/api/dictation/sessions")).toHaveLength(1);
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByText("Listening: your microphone is on");
    shell!.emit({ action: "stop" });
    expect(audioSocket().sent).toContainEqual({ type: "end" });
    audioSocket().fromCore({ type: "audio_ended" });
    await screen.findByText("Pasted");
    expect(shell!.pasted).toEqual(["dictated by hotkey"]);
    expect(mic.stopped).toBeGreaterThan(0);
  });

  it("start while a session is active is ignored", async () => {
    const { shell, api, mic } = mountPill();
    await dictateButton();
    shell!.emit({ action: "start" });
    shell!.emit({ action: "start" });
    await waitFor(() => expect(sessionSockets()).toHaveLength(1));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await screen.findByText("Listening: your microphone is on");
    shell!.emit({ action: "start" });
    expect(api.posts("/api/dictation/sessions")).toHaveLength(1);
    expect(sessionSockets()).toHaveLength(1);
    expect(mic.started).toBe(1);
  });

  it("cancel releases the mic, deletes the session, tells the shell and never pastes", async () => {
    const { shell, api, mic } = mountPill();
    await beginListening();
    shell!.emit({ action: "cancel" });
    expect(mic.stopped).toBeGreaterThan(0);
    expect(audioSocket().closed).toBe(true);
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
    expect(shell!.ended_).toBe(1);
    expect(shell!.pasted).toEqual([]);
    expect(api.posts(FINISH)).toHaveLength(0);
    expect(statusText()).toBe("Ready");
    await dictateButton();
  });

  it("Escape in the page while listening cancels like a cancel command", async () => {
    const { shell, api, mic } = mountPill();
    await beginListening();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mic.stopped).toBeGreaterThan(0);
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
    expect(shell!.ended_).toBe(1);
    expect(shell!.pasted).toEqual([]);
  });

  it("Escape with nothing in progress does nothing (the shell is not told)", async () => {
    const { shell, api } = mountPill();
    await dictateButton();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shell!.ended_).toBe(0);
    expect(deletes(api)).toHaveLength(0);
  });

  it("stop before `ready` cancels: no microphone, session deleted, shell told, nothing pasted", async () => {
    const { shell, api, mic } = mountPill();
    await dictateButton();
    shell!.emit({ action: "start" });
    await waitFor(() => expect(sessionSockets()).toHaveLength(1));
    // Core has not said `ready` yet.
    shell!.emit({ action: "stop" });
    expect(audioSocket().closed).toBe(true);
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
    expect(mic.started).toBe(0);
    expect(shell!.ended_).toBe(1);
    expect(shell!.pasted).toEqual([]);
    expect(api.posts(FINISH)).toHaveLength(0);
    // A late `ready` for the dead session cannot turn the microphone on.
    audioSocket().fromCore({ type: "ready" });
    expect(mic.started).toBe(0);
  });

  it("stop while the microphone permission prompt is open cancels and the late grant is dropped", async () => {
    const mic = fakeMic();
    const gate = Promise.withResolvers<void>();
    mic.gate = gate.promise;
    const { shell, api } = mountPill({ mic });
    await dictateButton();
    shell!.emit({ action: "start" });
    await waitFor(() => expect(sessionSockets()).toHaveLength(1));
    act(() => audioSocket().open());
    audioSocket().fromCore({ type: "ready" });
    await waitFor(() => expect(mic.started).toBe(1));
    expect(statusText()).toBe("Waiting for the microphone…");
    shell!.emit({ action: "stop" });
    expect(mic.stopped).toBeGreaterThan(0);
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
    await act(async () => gate.resolve());
    expect(statusText()).toBe("Ready");
    expect(shell!.pasted).toEqual([]);
    expect(shell!.ended_).toBe(1);
  });

  it("cancel while Core is still creating the session deletes it once it exists", async () => {
    const created = Promise.withResolvers<void>();
    const { shell, api, mic } = mountPill({
      routes: {
        "POST /api/dictation/sessions": async () => {
          await created.promise;
          return { id: ID, max_seconds: 120, max_bytes: 1, max_frame_bytes: 1 };
        },
      },
    });
    await dictateButton();
    shell!.emit({ action: "start" });
    shell!.emit({ action: "cancel" });
    await act(async () => created.resolve());
    await waitFor(() => expect(deletes(api)).toHaveLength(1));
    expect(sessionSockets()).toHaveLength(0);
    expect(mic.started).toBe(0);
    expect(shell!.pasted).toEqual([]);
  });

  it("a command that is not start/stop/cancel never reaches the session", async () => {
    const { shell, api } = mountPill();
    await dictateButton();
    shell!.emit({ action: "explode" } as never);
    expect(api.posts("/api/dictation/sessions")).toHaveLength(0);
  });

  it("unsubscribes from the shell when the page unmounts", async () => {
    const { shell, unmount } = mountPill();
    await waitFor(() => expect(shell!.log).toContain("ready"));
    unmount();
    expect(shell!.unlistened).toBe(2);
  });

  it("a plain browser registers no shell listener and Dictate still works", async () => {
    const { mic } = mountPill({ shell: null });
    await beginListening();
    expect(mic.started).toBe(1);
  });
});
