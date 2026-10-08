// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { BUBBLE_MS, FloatingApp, routeFor } from "../src/floating/FloatingApp";
import { tauriShell, type DesktopShell } from "../src/floating/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A desktop shell that records what the page asked it to do. */
interface FakeShell extends DesktopShell {
  calls: [string, ...unknown[]][];
}

function fakeShell(): FakeShell {
  const calls: FakeShell["calls"] = [];
  return {
    calls,
    connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
    moveBy: (dx, dy) => calls.push(["moveBy", dx, dy]),
    dragEnded: () => calls.push(["dragEnded"]),
    openInPhoenix: (route) => calls.push(["openInPhoenix", route]),
    showMenu: () => calls.push(["showMenu"]),
  };
}

function setup(withShell = true) {
  const shell = withShell ? fakeShell() : null;
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    // Keep the reconnect timer out of the way: these tests advance time for the bubble.
    minReconnectMs: 3_600_000,
    maxReconnectMs: 3_600_000,
    fetchImpl: fakeApi({ "GET /api/pet/settings": () => ({ reduced_motion: "auto" }) }).fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <FloatingApp shell={shell} />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  const state = (s: object) =>
    act(() => ws.message("state.changed", { recording: false, since: "", ...s }));
  return { ws, calls: shell?.calls ?? [], state };
}

const fawkes = () => screen.getByRole("button", { name: /^Fawkes/ });
const pointer = (type: string, x: number, y: number) =>
  act(() => {
    fawkes().dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        pointerId: 1,
        bubbles: true,
      }),
    );
  });

describe("floating Fawkes", () => {
  it("mirrors Core state and says what is happening in a short bubble", () => {
    const { state } = setup();
    state({ state: "WORKING", explanation: "Build running (ci)" });
    expect(fawkes().getAttribute("data-state")).toBe("WORKING");
    expect(screen.getByText("Build running (ci)")).toBeTruthy();
  });

  it("stays quiet while idle", () => {
    const { state } = setup();
    state({ state: "IDLE", explanation: "All quiet" });
    expect(screen.queryByText("All quiet")).toBeNull();
  });

  it("lets routine messages fade but keeps urgent ones until the state changes", () => {
    const { state } = setup();
    state({ state: "WORKING", explanation: "Build running (ci)" });
    act(() => void vi.advanceTimersByTime(BUBBLE_MS + 1));
    expect(screen.queryByText("Build running (ci)")).toBeNull();

    state({ state: "ERROR", explanation: "Build failed" });
    act(() => void vi.advanceTimersByTime(BUBBLE_MS * 5));
    expect(screen.getByText("Build failed")).toBeTruthy();
  });

  it("shows the recording indicator only while Kage is recording", () => {
    const { state } = setup();
    state({ state: "RECORDING", explanation: "Recording meeting", recording: true });
    expect(screen.getByRole("status").textContent).toContain("Recording");

    state({ state: "WORKING", explanation: "Processing meeting", recording: false });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the recording indicator under a higher-priority state", () => {
    const { state } = setup();
    state({ state: "ERROR", explanation: "Build failed", recording: true });
    expect(screen.getByRole("status").textContent).toContain("Recording");
  });

  it("shows OFFLINE, and keeps saying so, when Core goes away", () => {
    const { ws } = setup();
    act(() => ws.drop());
    expect(fawkes().getAttribute("data-state")).toBe("OFFLINE");
    act(() => void vi.advanceTimersByTime(BUBBLE_MS * 5));
    expect(screen.getByText("Phoenix Core is unreachable")).toBeTruthy();
  });

  it("drags the window by screen movement and saves the spot on release", () => {
    const { calls } = setup();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 110, 104);
    pointer("pointermove", 115, 104);
    pointer("pointerup", 115, 104);
    expect(calls).toEqual([["moveBy", 10, 4], ["moveBy", 5, 0], ["dragEnded"]]);
  });

  it("a drag does not open Phoenix, a plain click does", () => {
    const { calls } = setup();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 130, 100);
    pointer("pointerup", 130, 100);
    act(() => fawkes().click());
    expect(calls.some(([name]) => name === "openInPhoenix")).toBe(false);

    act(() => fawkes().click());
    expect(calls.filter(([name]) => name === "openInPhoenix")).toEqual([["openInPhoenix", "/"]]);
  });

  it("opens the meetings page when Kage is recording", () => {
    const { state, calls } = setup();
    state({ state: "RECORDING", explanation: "Recording meeting", recording: true });
    act(() => fawkes().click());
    expect(calls.at(-1)).toEqual(["openInPhoenix", "/meetings"]);
  });

  it("works without a desktop shell (plain browser)", () => {
    const { state } = setup(false);
    state({ state: "WORKING", explanation: "Build running (ci)" });
    pointer("pointerdown", 0, 0);
    pointer("pointermove", 20, 0);
    pointer("pointerup", 20, 0);
    act(() => fawkes().click());
    expect(fawkes().getAttribute("data-state")).toBe("WORKING");
  });
});

describe("routeFor", () => {
  it("sends Kage activity to meetings and everything else to the home page", () => {
    const base = { explanation: "", since: "", sleeping: false };
    expect(routeFor({ ...base, state: "WORKING", recording: false, source: "kage" })).toBe(
      "/meetings",
    );
    expect(routeFor({ ...base, state: "ERROR", recording: true })).toBe("/meetings");
    expect(routeFor({ ...base, state: "ERROR", recording: false, source: "git" })).toBe("/");
  });
});

describe("tauriShell", () => {
  it("is absent outside the desktop app", () => {
    expect(tauriShell({} as Window)).toBeNull();
  });

  it("maps shell calls to commands, and a failing command never throws into the pet", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "move_window_by") throw new Error("window gone");
      return { base_url: "http://127.0.0.1:4870", token: "t" };
    });
    const shell = tauriShell({ __TAURI__: { core: { invoke } } } as unknown as Window)!;

    expect(await shell.connection()).toEqual({ base_url: "http://127.0.0.1:4870", token: "t" });
    expect(() => shell.moveBy(3, 4)).not.toThrow();
    shell.openInPhoenix("/meetings");
    expect(invoke).toHaveBeenCalledWith("move_window_by", { dx: 3, dy: 4 });
    expect(invoke).toHaveBeenCalledWith("open_in_phoenix", { route: "/meetings" });
    await vi.runAllTimersAsync();
  });
});
