// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider, useDisplayedState, useTasks } from "../src/core/context";
import { DemoFollowProvider, type DemoPollTimers } from "../src/core/demo-follow";
import { parseDemoView } from "../src/core/demo-view";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

const goodView = {
  running: true,
  state: {
    state: "ERROR",
    explanation: "Build failed (demo)",
    since: "t",
    recording: false,
    sleeping: false,
  },
  tasks: [
    {
      key: "k",
      state: "WORKING",
      title: "Deploying",
      source: "mock",
      since: "a",
      updatedAt: "b",
      progress: 0.5,
    },
  ],
};

describe("parseDemoView", () => {
  it("accepts a well-formed view and copies only known fields", () => {
    const parsed = parseDemoView({
      ...goodView,
      url: "http://127.0.0.1:9",
      state: { ...goodView.state, token: "x" },
    });
    expect(parsed?.state.state).toBe("ERROR");
    expect(parsed?.tasks).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toMatch(/127\.0\.0\.1|token|url/);
  });

  it.each([
    ["not running", { running: false }],
    ["not an object", "x"],
    ["array", []],
    ["lowercase state", { ...goodView, state: { ...goodView.state, state: "error" } }],
    ["huge text", { ...goodView, state: { ...goodView.state, explanation: "x".repeat(501) } }],
    ["bad flag", { ...goodView, state: { ...goodView.state, recording: "no" } }],
    ["too many tasks", { ...goodView, tasks: Array.from({ length: 21 }, () => goodView.tasks[0]) }],
    ["bad task", { ...goodView, tasks: [{ key: 1 }] }],
    ["NaN progress", { ...goodView, tasks: [{ ...goodView.tasks[0], progress: "1" }] }],
  ])("returns null for %s", (_name, raw) => {
    expect(parseDemoView(raw)).toBeNull();
  });
});

function manualTimers() {
  const runs: (() => void)[] = [];
  const timers: DemoPollTimers & { cleared: number } = {
    cleared: 0,
    setInterval: (run) => {
      runs.push(run);
      return runs.length;
    },
    clearInterval: () => void timers.cleared++,
  };
  return { timers, tick: () => runs.forEach((r) => r()) };
}

function Probe() {
  const s = useDisplayedState();
  const tasks = useTasks();
  return (
    <p data-testid="p">
      {s.state}|{s.explanation}|{tasks.length}
    </p>
  );
}

async function setup(view: { current: unknown }) {
  const api = fakeApi({ "GET /api/demo/view": () => view.current });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    minReconnectMs: 3_600_000,
    maxReconnectMs: 3_600_000,
    fetchImpl: api.fetchImpl,
  });
  const { timers, tick } = manualTimers();
  const out = render(
    <CoreProvider client={client}>
      <DemoFollowProvider timers={timers}>
        <Probe />
      </DemoFollowProvider>
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  act(() =>
    ws.message("state.changed", {
      state: "IDLE",
      explanation: "real",
      since: "",
      recording: false,
      sleeping: false,
    }),
  );
  await act(async () => {});
  const text = () => out.getByTestId("p").textContent;
  const poll = async () => {
    tick();
    await act(async () => {});
  };
  return { api, ws, text, poll, timers, unmount: out.unmount };
}

describe("DemoFollowProvider", () => {
  it("shows the demo's state and tasks while a demo runs and the real ones after it ends", async () => {
    const view = { current: goodView as unknown };
    const { text, poll, api } = await setup(view);
    expect(text()).toBe("ERROR|Build failed (demo)|1");
    view.current = { running: false };
    await poll();
    expect(text()).toBe("IDLE|real|0");
    // Only the real Core's own route was called, with GET: no demo URL, no demo token.
    expect(api.calls.every((c) => c.path.startsWith("/api/"))).toBe(true);
    expect(api.calls.some((c) => c.path === "/api/demo/view" && c.method === "GET")).toBe(true);
  });

  it("falls back to the real state on a malformed answer or a failed request", async () => {
    const view = { current: goodView as unknown };
    const { text, poll, api } = await setup(view);
    expect(text()).toBe("ERROR|Build failed (demo)|1");
    view.current = { running: true, state: { state: "bad" }, tasks: [] };
    await poll();
    expect(text()).toBe("IDLE|real|0");
    view.current = goodView;
    await poll();
    expect(text()).toBe("ERROR|Build failed (demo)|1");
    api.set("GET /api/demo/view", () => {
      throw new Error("down");
    });
    await poll();
    expect(text()).toBe("IDLE|real|0");
  });

  it("never hides OFFLINE: when the real Core is unreachable the demo is not shown", async () => {
    const view = { current: goodView as unknown };
    const { text, ws } = await setup(view);
    expect(text()).toContain("ERROR");
    act(() => ws.onclose?.());
    await act(async () => {});
    expect(text()).toMatch(/^OFFLINE/);
  });

  it("stops polling on unmount", async () => {
    const { timers, unmount } = await setup({ current: { running: false } });
    unmount();
    expect(timers.cleared).toBeGreaterThan(0);
  });
});
