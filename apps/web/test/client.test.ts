// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, PhoenixClient, readInjectedToken } from "../src/core/client";
import type { ConnectionStatus } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const make = (fetchImpl?: typeof fetch) =>
  new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    ...(fetchImpl ? { fetchImpl } : {}),
    minReconnectMs: 100,
    maxReconnectMs: 400,
  });

describe("WebSocket connection", () => {
  it("authenticates via subprotocol and subscribes on open", () => {
    const c = make();
    c.connect();
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe("ws://127.0.0.1:4870/api/ws");
    expect(ws.protocols).toEqual(["phoenix.v1", "phoenix.token.tok"]);
    ws.open();
    expect(ws.sent[0]).toMatchObject({
      type: "subscribe",
      channels: expect.arrayContaining(["state.changed"]),
    });
    expect(c.status).toBe("online");
  });

  it("dispatches channel messages", () => {
    const c = make();
    const states: string[] = [];
    const tasks: number[] = [];
    c.stateChanged.on((s) => states.push(s.state));
    c.tasksChanged.on((t) => tasks.push(t.length));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.message("state.changed", { state: "ERROR" });
    FakeWebSocket.last.message("task.updated", { tasks: [{}, {}] });
    expect(states).toEqual(["ERROR"]);
    expect(tasks).toEqual([2]);
  });

  it("reconnects with capped exponential backoff and resumes from the last seq", () => {
    const c = make();
    const statuses: ConnectionStatus[] = [];
    c.statusChanged.on((s) => statuses.push(s));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.message("event.created", { seq: 7, event: {} });
    FakeWebSocket.last.message("event.created", { seq: 9, event: {} });

    FakeWebSocket.last.drop();
    expect(c.status).toBe("offline");
    vi.advanceTimersByTime(99);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.last.drop(); // fails again → 200ms
    vi.advanceTimersByTime(200);
    FakeWebSocket.last.drop(); // → 400ms (cap)
    vi.advanceTimersByTime(399);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);

    FakeWebSocket.last.open();
    expect(FakeWebSocket.last.sent[0]).toMatchObject({ since_seq: 9 });
    expect(statuses.at(-1)).toBe("online");
  });

  it("close() stops reconnecting", () => {
    const c = make();
    c.connect();
    FakeWebSocket.last.open();
    c.close();
    FakeWebSocket.last.drop();
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("without a token it reports unauthenticated and never connects", () => {
    const c = new PhoenixClient({
      token: null,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    c.connect();
    expect(c.status).toBe("unauthenticated");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("HTTP requests", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ state: "IDLE" }), { status: 200 }),
    );
    const c = make(fetchImpl as unknown as typeof fetch);
    expect(await c.request("GET", "/api/pet/state")).toEqual({ state: "IDLE" });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:4870/api/pet/state", {
      method: "GET",
      headers: { authorization: "Bearer tok" },
    });
  });

  it("turns error bodies into ApiError", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ code: "PERMISSION_DENIED", message: "nope", details: ["network"] }),
        { status: 403 },
      );
    const err = await make(fetchImpl as typeof fetch)
      .request("POST", "/api/x", {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "PERMISSION_DENIED", details: ["network"] });
  });
});

describe("readInjectedToken", () => {
  it("reads the meta tag", () => {
    document.head.innerHTML = '<meta name="phoenix-token" content="abc">';
    expect(readInjectedToken()).toBe("abc");
    document.head.innerHTML = "";
    expect(readInjectedToken()).toBeNull();
  });
});
