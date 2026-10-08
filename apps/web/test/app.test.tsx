// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

function setup(token: string | null = "tok") {
  const client = new PhoenixClient({
    token,
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: fakeApi().fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws?.open());
  return { client, ws };
}

const fawkes = () => screen.getByRole("button", { name: /^Fawkes/ });

describe("navbar Fawkes (US-01)", () => {
  it("renders in the navbar and reflects live state with text", () => {
    const { ws } = setup();
    expect(screen.getByRole("banner").contains(fawkes())).toBe(true);
    act(() =>
      ws.message("state.changed", {
        state: "ERROR",
        explanation: "Build failed",
        recording: false,
      }),
    );
    expect(fawkes().getAttribute("aria-label")).toBe(
      "Fawkes — Error. Build failed. Open Pet Panel",
    );
    expect(fawkes().getAttribute("data-state")).toBe("ERROR");
    expect(screen.getByText("Error", { selector: ".state-text" })).toBeTruthy();
  });

  it("shows a recording indicator whenever recording is active", () => {
    const { ws } = setup();
    act(() => ws.message("state.changed", { state: "ERROR", explanation: "x", recording: true }));
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Recording");
  });

  it("shows OFFLINE when the connection drops", () => {
    const { ws } = setup();
    act(() => ws.drop());
    expect(fawkes().getAttribute("data-state")).toBe("OFFLINE");
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("explains how to connect when there is no session token", () => {
    setup(null);
    expect(screen.getByRole("alert").textContent).toMatch(/no session token/);
    expect(fawkes().getAttribute("data-state")).toBe("OFFLINE");
  });
});

describe("skip link", () => {
  it("moves focus to the page content and leaves the route alone", () => {
    window.location.hash = "#/settings";
    setup();
    // The hash is the router: following a plain "#main" link would turn the page into route "/main".
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(window.location.hash).toBe("#/settings");
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings");
    window.location.hash = "";
  });
});

describe("Pet Panel", () => {
  it("opens from Fawkes, shows state and tasks, closes with Escape and returns focus", () => {
    const { ws } = setup();
    act(() => {
      ws.message("state.changed", {
        state: "DEPLOYING",
        explanation: "Deploying to staging",
        recording: false,
      });
      ws.message("task.updated", {
        tasks: [
          {
            key: "k",
            state: "DEPLOYING",
            title: "Deploying to staging",
            source: "ci",
            since: "",
            updatedAt: "",
            progress: 0.5,
          },
        ],
      });
    });
    expect(fawkes().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fawkes());
    const panel = screen.getByRole("dialog", { name: "Fawkes" });
    expect(fawkes().getAttribute("aria-expanded")).toBe("true");
    expect(panel.textContent).toContain("Deploying");
    expect(screen.getByRole("progressbar", { name: "Deploying to staging progress" })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Fawkes");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(fawkes());
  });

  it("the close button closes the panel", () => {
    setup();
    fireEvent.click(fawkes());
    fireEvent.click(screen.getByRole("button", { name: "Close Pet Panel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the first few of many tasks and keeps the emergency stop close", () => {
    const { ws } = setup();
    const tasks = Array.from({ length: 500 }, (_, i) => ({
      key: `corr:run-${i}`,
      state: "WORKING",
      title: `Build running ${i}`,
      source: "terminal",
      since: "",
      updatedAt: "",
    }));
    act(() => ws.message("task.updated", { tasks }));
    fireEvent.click(fawkes());
    const panel = screen.getByRole("dialog", { name: "Fawkes" });
    expect(panel.querySelectorAll(".task-list li")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Emergency stop" })).toBeTruthy();

    const toggle = screen.getByRole("button", { name: "Show all 500 tasks" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(panel.querySelectorAll(".task-list li")).toHaveLength(500);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fewer);
    expect(panel.querySelectorAll(".task-list li")).toHaveLength(10);
  });

  it("shows every task when there are only a few, with no toggle", () => {
    const { ws } = setup();
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`,
      state: "WORKING",
      title: `Task ${i}`,
      source: "ci",
      since: "",
      updatedAt: "",
    }));
    act(() => ws.message("task.updated", { tasks }));
    fireEvent.click(fawkes());
    expect(screen.getByRole("dialog").querySelectorAll(".task-list li")).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /Show (all|fewer)/ })).toBeNull();
  });
});
