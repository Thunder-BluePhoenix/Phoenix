// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { activityOf, IslandApp } from "../src/island/IslandApp";
import {
  FRAME_EVENT,
  tauriIslandShell,
  type IslandFrame,
  type IslandShell,
  type PageEvent,
} from "../src/island/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

const frame = (
  state: IslandFrame["state"],
  extra: Partial<IslandFrame["layout"]> = {},
  pointer: IslandFrame["pointer"] = "poll",
): IslandFrame => ({
  state,
  pointer,
  layout: {
    rect: { x: 0, y: 0, w: 220, h: 34 },
    notch_width: 0,
    has_notch: false,
    ...extra,
  },
});

interface FakeIslandShell extends IslandShell {
  sent: PageEvent[];
  opened: string[];
  menus: number;
  emit(next: IslandFrame): void;
}

function fakeShell(initial: IslandFrame | null): FakeIslandShell {
  let listener: ((f: IslandFrame) => void) | undefined;
  const shell: FakeIslandShell = {
    sent: [],
    opened: [],
    menus: 0,
    connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
    frame: async () => initial,
    onFrame: async (l) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    send: (e) => shell.sent.push(e),
    openInPhoenix: (route) => shell.opened.push(route),
    showMenu: () => void shell.menus++,
    emit: (next) => listener?.(next),
  };
  return shell;
}

const agentSession = (id: string, agent: string) => ({
  id,
  agent,
  project: "/p",
  repository: "p",
  first_seen: "",
  last_seen: "",
  active: true,
  step_count: 1,
  dropped_steps: 0,
  has_terminal: false,
});

async function setup(shell: IslandShell | null, agents: string[] = []) {
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    minReconnectMs: 3_600_000,
    maxReconnectMs: 3_600_000,
    fetchImpl: fakeApi({
      "GET /api/pet/settings": () => ({ reduced_motion: "auto" }),
      ...(agents.length > 0
        ? {
            "GET /api/agent/sessions": () => ({
              sessions: agents.map((agent, i) => agentSession(`s${i}`, agent)),
            }),
          }
        : {}),
    }).fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <IslandApp shell={shell} />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  const state = (s: object) =>
    act(() => ws.message("state.changed", { recording: false, since: "", ...s }));
  // Let the shell's frame promises settle.
  await act(async () => {});
  return { ws, state };
}

const root = () => document.querySelector(".island-root") as HTMLElement;
const fawkes = () => screen.queryByRole("button", { name: /^Fawkes/ });

describe("Fawkes island page", () => {
  it("draws nothing while the shell says hidden", async () => {
    const shell = fakeShell(frame("hidden"));
    await setup(shell);
    expect(root().dataset.state).toBe("hidden");
    expect(fawkes()).toBeNull();
    expect(document.querySelector(".island-bar")).toBeNull();
  });

  it("shows Fawkes and a label once the shell peeks it, and follows later frames", async () => {
    const shell = fakeShell(frame("hidden"));
    const { state } = await setup(shell);
    state({ state: "WORKING", explanation: "Build running (ci)" });
    act(() => shell.emit(frame("small")));
    expect(root().dataset.state).toBe("small");
    expect(fawkes()?.getAttribute("data-state")).toBe("WORKING");
    expect(screen.getByText("Working")).toBeTruthy();
    act(() => shell.emit(frame("hidden")));
    expect(fawkes()).toBeNull();
  });

  it("starts from the frame the shell already has when the page loads late", async () => {
    const shell = fakeShell(frame("small"));
    await setup(shell);
    expect(root().dataset.state).toBe("small");
    expect(fawkes()).not.toBeNull();
  });

  it("leaves room for the notch between the two ears", async () => {
    const shell = fakeShell(frame("small", { has_notch: true, notch_width: 200 }));
    await setup(shell);
    expect(root().dataset.notch).toBe("true");
    expect(root().style.getPropertyValue("--notch-width")).toBe("200px");
    expect(document.querySelector(".island-notch")).not.toBeNull();
  });

  it("has no notch spacer without a notch", async () => {
    await setup(fakeShell(frame("small")));
    expect(root().dataset.notch).toBe("false");
    expect(document.querySelector(".island-notch")).toBeNull();
  });

  it("reports hover to the shell so Wayland, where only the page sees the pointer, works", async () => {
    const shell = fakeShell(frame("small", {}, "page"));
    await setup(shell);
    fireEvent.pointerEnter(root());
    fireEvent.pointerLeave(root());
    expect(shell.sent.filter((e) => e.kind.startsWith("pointer"))).toEqual([
      { kind: "pointer_enter" },
      { kind: "pointer_leave" },
    ]);
  });

  it("a click on Fawkes toggles the island; Escape collapses it", async () => {
    const shell = fakeShell(frame("small"));
    await setup(shell);
    act(() => fawkes()!.click());
    expect(shell.sent.at(-1)).toEqual({ kind: "toggle" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shell.sent.at(-1)).toEqual({ kind: "collapse" });
    fireEvent.keyDown(window, { key: "a" });
    expect(shell.sent.at(-1)).toEqual({ kind: "collapse" });
  });

  it("double-click opens the full context without toggling the summary", async () => {
    const shell = fakeShell(frame("small"));
    const { state } = await setup(shell);
    state({ state: "WAITING", explanation: "Review the build" });
    vi.useFakeTimers();
    try {
      fireEvent.click(fawkes()!, { detail: 1 });
      fireEvent.click(fawkes()!, { detail: 2 });
      fireEvent.doubleClick(fawkes()!);
      act(() => vi.advanceTimersByTime(500));
      expect(shell.opened).toEqual(["/panel/overview"]);
      expect(shell.sent.filter((e) => e.kind === "toggle")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the same animated avatar when the notch expands", async () => {
    const shell = fakeShell(frame("small"));
    const { state } = await setup(shell);
    state({ state: "IDLE", explanation: "All quiet" });
    const avatar = fawkes()!;
    expect(avatar.getAttribute("data-animation")).toBe("breathe");
    expect(avatar.style.getPropertyValue("--fawkes-size")).toBe("32px");
    act(() => shell.emit(frame("expanded")));
    expect(fawkes()).toBe(avatar);
    expect(avatar.style.getPropertyValue("--fawkes-size")).toBe("48px");
    expect(screen.getByRole("region", { name: "Fawkes summary" }).textContent).toContain(
      "All quiet",
    );
  });

  it("expanded shows what Fawkes is saying and opens the right page in Phoenix", async () => {
    const shell = fakeShell(frame("expanded"));
    const { state } = await setup(shell);
    state({ state: "WAITING", explanation: "Approve the git push?" });
    expect(screen.getByText("Approve the git push?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in Phoenix" }));
    expect(shell.opened).toEqual(["/panel/overview"]);
    expect(fawkes()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows one active-agent pill per active session inside the expanded island, and none while collapsed", async () => {
    const shell = fakeShell(frame("expanded"));
    await setup(shell, ["codex", "claude"]);
    await waitFor(() =>
      expect(document.querySelectorAll(".island-body .source-pill").length).toBe(2),
    );
    expect(
      Array.from(document.querySelectorAll<HTMLElement>(".island-body .source-pill")).map(
        (el) => el.dataset.source,
      ),
    ).toEqual(["agent:claude", "agent:codex"]);
    act(() => shell.emit(frame("small")));
    expect(document.querySelector(".source-pill")).toBeNull();
    act(() => shell.emit(frame("expanded")));
    expect(document.querySelectorAll(".island-body .source-pill").length).toBe(2);
  });

  it("draws no pill list in the expanded island when no agent session is active", async () => {
    await setup(fakeShell(frame("expanded")));
    expect(document.querySelector(".island-body")).not.toBeNull();
    expect(document.querySelector(".source-pills")).toBeNull();
  });

  it("shows the recording indicator whenever Kage is recording and the island is expanded", async () => {
    const shell = fakeShell(frame("expanded"));
    const { state } = await setup(shell);
    state({ state: "RECORDING", explanation: "Recording meeting", recording: true });
    expect(screen.getByRole("status").textContent).toContain("Recording");
    state({ state: "WORKING", explanation: "Processing meeting", recording: false });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tells the shell what Fawkes is doing so urgent states keep the island up", async () => {
    const shell = fakeShell(frame("hidden"));
    const { state } = await setup(shell);
    const activity = () => shell.sent.filter((e) => e.kind === "activity").at(-1);
    state({ state: "IDLE", explanation: "All quiet" });
    expect(activity()).toEqual({ kind: "activity", active: true, urgent: false });
    state({ state: "WORKING", explanation: "Build running" });
    expect(activity()).toEqual({ kind: "activity", active: true, urgent: false });
    state({ state: "WAITING", explanation: "Approve?" });
    expect(activity()).toEqual({ kind: "activity", active: true, urgent: true });
    state({ state: "WORKING", explanation: "Recording", recording: true });
    expect(activity()).toEqual({ kind: "activity", active: true, urgent: true });
  });

  it("the right-click menu comes from the shell", async () => {
    const shell = fakeShell(frame("small"));
    await setup(shell);
    fireEvent.contextMenu(root());
    expect(shell.menus).toBe(1);
  });

  it("previews as a small pill in a plain browser and never throws without a shell", async () => {
    await setup(null);
    expect(root().dataset.state).toBe("small");
    act(() => fawkes()!.click());
    fireEvent.pointerEnter(root());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.contextMenu(root());
  });
});

describe("activityOf", () => {
  const base = { explanation: "", since: "", sleeping: false, recording: false };
  it("keeps idle visible and lets sleeping and offline settle", () => {
    expect(activityOf({ ...base, state: "IDLE" })).toEqual({ active: true, urgent: false });
    for (const state of ["SLEEPING", "OFFLINE"]) {
      expect(activityOf({ ...base, state })).toEqual({ active: false, urgent: false });
    }
  });
  it("marks errors, approvals and recording urgent", () => {
    expect(activityOf({ ...base, state: "ERROR" }).urgent).toBe(true);
    expect(activityOf({ ...base, state: "WAITING" }).urgent).toBe(true);
    expect(activityOf({ ...base, state: "IDLE", recording: true })).toEqual({
      active: true,
      urgent: true,
    });
  });
});

describe("tauriIslandShell", () => {
  it("is absent outside the desktop app and without the event API", () => {
    expect(tauriIslandShell({} as Window)).toBeNull();
    const win = { __TAURI__: { core: { invoke: vi.fn() } } } as unknown as Window;
    expect(tauriIslandShell(win)).toBeNull();
  });

  it("maps to the shell commands and the frame event, and swallows command failures", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "island_event") throw new Error("denied");
      if (command === "island_frame") return frame("small");
      return undefined;
    });
    const unlisten = vi.fn();
    const listen = vi.fn(async () => unlisten);
    const win = { __TAURI__: { core: { invoke }, event: { listen } } } as unknown as Window;
    const shell = tauriIslandShell(win)!;

    shell.send({ kind: "toggle" });
    shell.openInPhoenix("/meetings");
    shell.showMenu();
    expect(invoke).toHaveBeenCalledWith("island_event", { event: { kind: "toggle" } });
    expect(invoke).toHaveBeenCalledWith("open_in_phoenix", { route: "/meetings" });
    expect(invoke).toHaveBeenCalledWith("show_menu", undefined);
    expect(await shell.frame()).toEqual(frame("small"));
    await shell.onFrame(() => {});
    expect(listen).toHaveBeenCalledWith(FRAME_EVENT, expect.any(Function));
  });
});
