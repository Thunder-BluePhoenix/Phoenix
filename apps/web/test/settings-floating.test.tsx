// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { FloatingApp, routeFor } from "../src/floating/FloatingApp";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { mount, petState } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const settings = (enabled: boolean, active_runs = 0) => ({
  enabled,
  kinds: ["ci_failure"],
  limits: { max_steps: 8, max_tool_calls: 12, max_wall_ms: 600000, max_active_runs: 4 },
  active_runs,
});

describe("Automation setting", () => {
  it("is off by default, explains that, and turns on only when you tick it", async () => {
    let enabled = false;
    const m = mount({
      "GET /api/agent/settings": () => settings(enabled),
      "POST /api/agent/settings": (body) => {
        enabled = (body as { enabled: boolean }).enabled;
        return settings(enabled);
      },
    });
    window.location.hash = "#/settings";
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    const box = (await screen.findByLabelText(
      "Allow Fawkes to run tasks I start",
    )) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/Automation is off until you turn it on/)).toBeTruthy();
    expect(screen.getByText(/Automation is off\. 0 tasks are running/)).toBeTruthy();
    expect(m.api.posts("/api/agent/settings")).toHaveLength(0);

    fireEvent.click(box);
    await waitFor(() =>
      expect(m.api.posts("/api/agent/settings")[0]?.body).toEqual({ enabled: true }),
    );
    await screen.findByText(/Automation is on\. 0 tasks are running/);
    expect(box.checked).toBe(true);
  });

  it("says so when Core has no agent settings, rather than showing a dead switch", async () => {
    mount();
    window.location.hash = "#/settings";
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(
      await screen.findByText(/Automation settings are not available from Phoenix Core/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Allow Fawkes to run tasks I start")).toBeNull();
  });
});

describe("Floating shell", () => {
  it("still renders Fawkes and its bubble from the shared state", () => {
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: fakeApi({ "GET /api/pet/settings": () => ({ reduced_motion: "auto" }) }).fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <FloatingApp shell={null} />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    act(() =>
      FakeWebSocket.last.message(
        "state.changed",
        petState("WAITING", "Approval needed: Mock: write"),
      ),
    );
    const fawkes = screen.getByRole("button", { name: /^Fawkes/ });
    expect(fawkes.getAttribute("data-state")).toBe("WAITING");
    expect(screen.getByText("Approval needed: Mock: write")).toBeTruthy();
  });

  it("sends a click while WAITING to the approvals, not the empty home page", () => {
    const base = { explanation: "", since: "", recording: false, sleeping: false };
    expect(routeFor({ ...base, state: "WAITING" })).toBe("/panel/overview");
    expect(routeFor({ ...base, state: "IDLE" })).toBe("/");
  });

  it("opens the Pet Panel on the requested tab for #/panel/<tab>", async () => {
    window.location.hash = "#/panel/overview";
    mount();
    window.location.hash = "#/panel/overview";
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("ignores an unknown panel tab", () => {
    mount();
    window.location.hash = "#/panel/nonsense";
    act(() => void window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
