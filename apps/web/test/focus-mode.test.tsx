// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FocusMode } from "../src/components/FocusMode";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

const inactive = { manual: false, osDnd: null, active: false, remainingMs: null, held: 0 };

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
});
