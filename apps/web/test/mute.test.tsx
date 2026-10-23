// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import type { SoundPlayer } from "@phoenix/pet-runtime";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShortcutReport, ShortcutsShell } from "../src/commands/shortcuts-shell";
import { MuteState, silenced } from "../src/core/mute";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { FloatingApp } from "../src/floating/FloatingApp";
import { IslandApp } from "../src/island/IslandApp";
import type { IslandFrame, IslandShell } from "../src/island/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

const report = (muted: boolean): ShortcutReport => ({ enabled: false, muted, shortcuts: [] });

/** A desktop shell that answers `list` when the test says so and emits `shortcuts://mute` on demand. */
function fakeShortcuts(initialMuted: boolean) {
  const listeners = new Set<(muted: boolean) => void>();
  const answer = Promise.withResolvers<ShortcutReport>();
  const shell: ShortcutsShell = {
    list: () => answer.promise,
    set: async () => report(initialMuted),
    reset: async () => report(initialMuted),
    setEnabled: async () => report(initialMuted),
    setMuted: async (muted) => {
      listeners.forEach((l) => l(muted));
      return report(muted);
    },
    onMute: async (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onSwitchPills: async () => () => {},
    onStatus: async () => () => {},
  };
  return {
    shell,
    answerList: () => answer.resolve(report(initialMuted)),
    failList: () => answer.reject(new Error("no shell")),
    emit: (muted: boolean) => act(() => listeners.forEach((l) => l(muted))),
    listeners,
  };
}

function fakePlayer() {
  const events: string[] = [];
  const player: SoundPlayer = {
    trigger: async (event) => {
      events.push(event);
      return "played";
    },
  };
  return { player, events };
}

const settle = () => act(async () => {});

function client() {
  const api = fakeApi();
  return new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
}

function mountFloating(shortcuts: ShortcutsShell | null, sounds: SoundPlayer) {
  render(
    <CoreProvider client={client()}>
      <FloatingApp shell={null} shortcuts={shortcuts} sounds={sounds} />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  return {
    state: (s: object) =>
      act(() => ws.message("state.changed", { recording: false, since: "", ...s })),
  };
}

describe("MuteState", () => {
  it("is muted until the shell has answered, so a launch sound cannot leak out", async () => {
    const state = new MuteState(true);
    expect(state.isMuted()).toBe(true);
    const { player, events } = fakePlayer();
    const pending = silenced(player, state).trigger("launch");
    await settle();
    expect(events).toEqual([]);
    state.set(false);
    expect(await pending).toBe("played");
    expect(events).toEqual(["launch"]);
  });

  it("is never muted without a shell (a plain browser)", async () => {
    const state = new MuteState(false);
    const { player, events } = fakePlayer();
    expect(state.isMuted()).toBe(false);
    expect(await silenced(player, state).trigger("poke")).toBe("played");
    expect(events).toEqual(["poke"]);
  });

  it("stays muted when the shell cannot say, and stays quiet", async () => {
    const { shell, failList } = fakeShortcuts(false);
    const state = new MuteState(true);
    state.attach(shell);
    failList();
    await state.ready;
    const { player, events } = fakePlayer();
    expect(await silenced(player, state).trigger("completion")).toBe("muted");
    expect(events).toEqual([]);
  });

  it("a change announced while the first answer is on its way wins over that older answer", async () => {
    const shell = fakeShortcuts(true); // the list will say muted ...
    const state = new MuteState(true);
    state.attach(shell.shell);
    await settle();
    shell.emit(false); // ... but the user already unmuted
    shell.answerList();
    await settle();
    expect(state.isMuted()).toBe(false);
  });

  it("stops listening when detached", async () => {
    const shell = fakeShortcuts(false);
    const state = new MuteState(true);
    const detach = state.attach(shell.shell);
    await settle();
    expect(shell.listeners.size).toBe(1);
    detach();
    expect(shell.listeners.size).toBe(0);
  });
});

describe("muted Fawkes windows", () => {
  it("silences sounds when the desktop is muted, and plays them again when it is not", async () => {
    const fake = fakeShortcuts(true);
    const { player, events } = fakePlayer();
    mountFloating(fake.shell, player);
    fake.answerList();
    await settle();
    // Fawkes greets on launch; muted from the start, the greeting is not played.
    expect(events).toEqual([]);

    fake.emit(false);
    await settle();
    // Unmuted: the next real event is heard. A click pokes the pet.
    const avatar = screen.getByRole("button", { name: /^Fawkes/ });
    act(() => {
      avatar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }),
      );
      avatar.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }),
      );
      avatar.click();
    });
    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    const heard = events.length;

    fake.emit(true);
    await settle();
    act(() => avatar.click());
    await settle();
    expect(events.length).toBe(heard);
  });

  it("plays the launch greeting when the shell says it is not muted", async () => {
    const fake = fakeShortcuts(false);
    const { player, events } = fakePlayer();
    mountFloating(fake.shell, player);
    fake.answerList();
    await waitFor(() => expect(events).toEqual(["launch"]));
  });

  it("hides the speech bubble while muted but keeps showing Fawkes' state and the recording indicator", async () => {
    const fake = fakeShortcuts(true);
    const { player } = fakePlayer();
    const { state } = mountFloating(fake.shell, player);
    fake.answerList();
    await settle();
    state({ state: "ERROR", explanation: "Build failed", recording: true });
    const avatar = screen.getByRole("button", { name: /^Fawkes/ });
    // The avatar still shows the state (and says it in its accessible name) ...
    expect(avatar.getAttribute("data-state")).toBe("ERROR");
    expect(avatar.getAttribute("aria-label")).toContain("Build failed");
    // ... and a recording is never hidden by mute.
    expect(screen.getByRole("status").textContent).toContain("Recording");
    // The notification bubble is silenced.
    expect(document.querySelector(".bubble")).toBeNull();

    fake.emit(false);
    expect(document.querySelector(".bubble")?.textContent).toBe("Build failed");
  });

  it("is not muted at all in a plain browser", async () => {
    const { player, events } = fakePlayer();
    const { state } = mountFloating(null, player);
    await waitFor(() => expect(events).toEqual(["launch"]));
    state({ state: "ERROR", explanation: "Build failed" });
    expect(document.querySelector(".bubble")?.textContent).toBe("Build failed");
  });

  it("the island window follows the same mute event", async () => {
    const frame: IslandFrame = {
      state: "expanded",
      pointer: "poll",
      layout: { rect: { x: 0, y: 0, w: 300, h: 120 }, notch_width: 0, has_notch: false },
    };
    const islandShell: IslandShell = {
      connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "t" }),
      frame: async () => frame,
      onFrame: async () => () => {},
      send: () => {},
      openInPhoenix: () => {},
      showMenu: () => {},
    };
    const fake = fakeShortcuts(true);
    const { player, events } = fakePlayer();
    render(
      <CoreProvider client={client()}>
        <IslandApp shell={islandShell} shortcuts={fake.shell} sounds={player} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    fake.answerList();
    await settle();
    expect(events).toEqual([]);
    fake.emit(false);
    await settle();
    act(() => screen.getByRole("button", { name: /^Fawkes/ }).click());
    await waitFor(() => expect(events.length).toBeGreaterThan(0));
  });
});
