// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FocusMode } from "../src/components/FocusMode";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

const inactive = { manual: false, osDnd: null, active: false, remainingMs: null, held: 0 };

beforeEach(() => FakeWebSocket.reset());
afterEach(cleanup);

describe("FocusMode", () => {
  it("starts manual focus and a selected Pomodoro through Core", async () => {
    const api = fakeApi({
      "GET /api/focus": () => inactive,
      "POST /api/focus": (body) => ({
        manual: true,
        osDnd: null,
        active: true,
        remainingMs: body && typeof body === "object" && "minutes" in body ? 1_500_000 : null,
        held: 0,
      }),
    });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <FocusMode />
      </CoreProvider>,
    );

    await screen.findByText(
      "System Do Not Disturb is unavailable; Focus mode only controls Phoenix notifications.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start focus" }));
    await waitFor(() => expect(api.posts("/api/focus")[0]?.body).toEqual({}));

    cleanup();
    render(
      <CoreProvider client={client}>
        <FocusMode />
      </CoreProvider>,
    );
    await screen.findByRole("button", { name: "Start Pomodoro" });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Pomodoro" }));
    await waitFor(() => expect(api.posts("/api/focus")[1]?.body).toEqual({ minutes: 30 }));
  });

  it("reads the focus status again when the connection returns after a Core restart", async () => {
    let status: unknown = inactive;
    const api = fakeApi({ "GET /api/focus": () => status });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    client.connect();
    act(() => FakeWebSocket.last.open());
    render(
      <CoreProvider client={client}>
        <FocusMode />
      </CoreProvider>,
    );
    expect(await screen.findByText("Focus is off")).toBeTruthy();

    // Core restarted and restored a session from its stored end instant.
    status = { manual: true, osDnd: null, active: true, remainingMs: 600_000, held: 0 };
    act(() => FakeWebSocket.last.drop());
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), {
      timeout: 3000,
    });
    act(() => FakeWebSocket.last.open());
    expect(await screen.findByText("Focus is active")).toBeTruthy();
    expect(screen.getByText("Minutes remaining: 10")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End focus" })).toBeTruthy();
    client.close();
  });
});
