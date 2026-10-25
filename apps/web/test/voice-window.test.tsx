// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { DictationMicrophone } from "../src/core/dictation-mic";
import type { VoiceStatus } from "../src/core/voice";
import type { SpeechDeps } from "../src/core/voice-assistant";
import {
  VOICE_CLAIM_ACTIVE,
  VOICE_CLAIM_IDLE,
  claimListening,
  insideDesktopShell,
} from "../src/voice/shell";
import { VoiceWindowApp } from "../src/voice/VoiceWindowApp";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

class AudioSocket extends FakeWebSocket {
  readyState = 0;
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

const RUST = import.meta.glob("../../desktop/src-tauri/src/voice_window.rs", {
  query: "?raw",
  import: "default",
  eager: true,
});
const PAGE_SOURCES = import.meta.glob("../src/voice/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ID = `voi_${"c".repeat(32)}`;
const STATUS: VoiceStatus = {
  enabled: true,
  kill_switch_engaged: false,
  recognizer: { available: true, detail: "Fake recogniser", engine: "fake" },
  audio_on_disk: false,
  active: null,
  limits: { max_frame_bytes: 65_536, awake_window_ms: 8000 },
};
const speech: SpeechDeps = {
  synth: () => ({ speak: () => {}, cancel: () => {} }),
  createUtterance: (text) => text,
};

/**
 * The fake desktop shell: it records every title the page writes (the only channel the page has),
 * in order with the microphone's own events, so the order of "active" and the microphone request
 * can be asserted.
 */
function fakeShell() {
  const log: string[] = [];
  const target = {
    set title(value: string) {
      log.push(`title:${value}`);
    },
    get title() {
      return "";
    },
  };
  const mic: DictationMicrophone = {
    async start() {
      log.push("mic.start");
    },
    stop() {
      log.push("mic.stop");
    },
  };
  return { log, target, mic };
}

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

function mount(options: { status?: Partial<VoiceStatus>; inShell?: boolean } = {}) {
  const shell = fakeShell();
  const api = fakeApi({
    "GET /api/voice/status": () => ({ ...STATUS, ...options.status }),
    "POST /api/voice/sessions": () => ({ id: ID }),
    "DELETE /api/voice/sessions/*": () => ({ stopped: true }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: window.location.origin,
    WebSocketImpl: AudioSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <VoiceWindowApp
        createMicrophone={() => shell.mic}
        speech={speech}
        titleTarget={shell.target}
        inShell={options.inShell ?? true}
      />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.instances[0]!.open());
  return { shell, api, client };
}
const voiceSocket = () =>
  FakeWebSocket.instances.find((s) => s.url.includes("/api/voice/stream")) as AudioSocket;

describe("the voice window page for the desktop shell", () => {
  it("claims idle at first, starts nothing by itself and shows the shell wording", async () => {
    const { shell, api } = mount();
    await screen.findByRole("button", { name: "Start listening" });
    expect(shell.log).toEqual([`title:${VOICE_CLAIM_IDLE}`]);
    expect(api.posts("/api/voice/sessions")).toHaveLength(0);
    expect(voiceSocket()).toBeUndefined();
    expect(screen.getByText(/shows LISTENING in this window/)).toBeTruthy();
    expect(screen.getByText("The microphone is off.")).toBeTruthy();
  });

  it("claims active BEFORE the microphone is requested and idle AFTER it is released", async () => {
    const { shell } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start listening" }));
    await waitFor(() => expect(voiceSocket()).toBeDefined());
    voiceSocket().open();
    voiceSocket().fromCore({ type: "ready" });
    await waitFor(() => expect(shell.log).toContain("mic.start"));
    expect(shell.log.indexOf(`title:${VOICE_CLAIM_ACTIVE}`)).toBeGreaterThan(-1);
    expect(shell.log.indexOf(`title:${VOICE_CLAIM_ACTIVE}`)).toBeLessThan(
      shell.log.indexOf("mic.start"),
    );
    expect(screen.getByText("LISTENING: the microphone is on.")).toBeTruthy();

    // Stop (the banner's own button): the microphone is released, then idle is claimed.
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    await waitFor(() => expect(shell.log.at(-1)).toBe(`title:${VOICE_CLAIM_IDLE}`));
    expect(shell.log.indexOf("mic.stop")).toBeLessThan(
      shell.log.lastIndexOf(`title:${VOICE_CLAIM_IDLE}`),
    );
  });

  it("an ended session from Core releases the microphone and claims idle", async () => {
    const { shell } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start listening" }));
    await waitFor(() => expect(voiceSocket()).toBeDefined());
    voiceSocket().open();
    voiceSocket().fromCore({ type: "ready" });
    await waitFor(() => expect(shell.log).toContain("mic.start"));
    voiceSocket().fromCore({ type: "ended", reason: "kill_switch" });
    await waitFor(() => expect(shell.log.at(-1)).toBe(`title:${VOICE_CLAIM_IDLE}`));
    expect(shell.log).toContain("mic.stop");
  });

  it("does not offer to start while voice is off in Core or the emergency stop is engaged", async () => {
    const off = mount({ status: { enabled: false } });
    await screen.findByText(/The voice assistant is off/);
    expect(screen.queryByRole("button", { name: "Start listening" })).toBeNull();
    expect(off.shell.log).toEqual([`title:${VOICE_CLAIM_IDLE}`]);
    cleanup();
    FakeWebSocket.reset();
    mount({ status: { kill_switch_engaged: true } });
    await screen.findByText(/emergency stop/i);
    expect(screen.queryByRole("button", { name: "Start listening" })).toBeNull();
  });
});

describe("the shell contract strings", () => {
  it("are exactly the ones the desktop shell reads (voice_window.rs)", () => {
    const rust = Object.values(RUST)[0]!;
    expect(rust).toContain(`pub const CLAIM_ACTIVE: &str = "${VOICE_CLAIM_ACTIVE}";`);
    expect(rust).toContain(`pub const CLAIM_IDLE: &str = "${VOICE_CLAIM_IDLE}";`);
  });

  it("claimListening writes only the claim", () => {
    const target = { title: "" };
    claimListening(true, target);
    expect(target.title).toBe(VOICE_CLAIM_ACTIVE);
    claimListening(false, target);
    expect(target.title).toBe(VOICE_CLAIM_IDLE);
  });

  it("insideDesktopShell is true only with a Tauri global", () => {
    expect(insideDesktopShell({} as Window)).toBe(false);
    expect(insideDesktopShell({ __TAURI__: {} } as unknown as Window)).toBe(true);
    expect(insideDesktopShell({ __TAURI_INTERNALS__: {} } as unknown as Window)).toBe(true);
  });

  it("the voice page imports no Tauri API and names no shell command", () => {
    expect(Object.keys(PAGE_SOURCES)).toHaveLength(3);
    for (const source of Object.values(PAGE_SOURCES)) {
      expect(source).not.toMatch(/@tauri-apps|invoke\(|\.listen\(|core\.invoke/);
    }
  });
});
