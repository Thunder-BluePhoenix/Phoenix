// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

function setup(routes: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  return { api, ws };
}

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
const tab = (name: string) => screen.getByRole("tab", { name });

const event = (
  seq: number,
  event_type: string,
  severity = "info",
  source = "terminal",
  description?: string,
) => ({
  seq,
  event: {
    event_id: `evt_${seq}aaaaaa`,
    event_type,
    source,
    severity,
    timestamp: "2026-10-03T12:00:00Z",
    payload: {},
  },
  ...(description ? { description } : {}),
});

describe("Overview (US-02)", () => {
  it("shows state, explanation and tasks; US-03 error offers 'Dismiss errors'", async () => {
    const { ws, api } = setup();
    act(() => {
      ws.message("state.changed", {
        state: "ERROR",
        explanation: "Build failed (terminal)",
        recording: false,
        sleeping: false,
        since: new Date().toISOString(),
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
          },
        ],
      });
    });
    openPanel();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Build failed (terminal)")).toBeTruthy();
    expect(within(panel).getByText("Deploying to staging")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Dismiss errors" }));
    await waitFor(() => expect(api.posts("/api/pet/acknowledge")).toHaveLength(1));
  });

  it("pause toggles sleep", async () => {
    const { api } = setup();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Pause Fawkes" }));
    await waitFor(() => expect(api.posts("/api/pet/sleep")[0]?.body).toEqual({ sleeping: true }));
  });

  it("emergency stop needs a second confirmation click", async () => {
    let engaged = false;
    const { api } = setup({
      "GET /api/security/kill-switch": () => ({ engaged }),
      "POST /api/security/kill-switch": (b) => (
        (engaged = (b as { engaged: boolean }).engaged),
        { engaged }
      ),
    });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Emergency stop" }));
    expect(api.posts("/api/security/kill-switch")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm: stop all capabilities" }));
    await screen.findByRole("button", { name: "Release emergency stop" });
    expect(api.posts("/api/security/kill-switch")[0]?.body).toEqual({ engaged: true });
    expect(screen.getByText(/Emergency stop is on/)).toBeTruthy();
  });
});

describe("Approvals (US-07)", () => {
  it("lists pending approvals and sends the user's decision", async () => {
    const pending = [
      {
        id: "conf_1",
        capabilityId: "github",
        command: "issue.create",
        summary: "GitHub: Create an issue",
        sideEffect: "external",
        permissions: ["external_api"],
        requestedAt: "",
        expiresAt: "",
      },
    ];
    const { api } = setup({ "GET /api/confirmations": () => ({ confirmations: pending }) });
    openPanel();
    expect(await screen.findByText("GitHub: Create an issue")).toBeTruthy();
    expect(screen.getByText(/Acts on an external service/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(api.posts("/api/confirmations/conf_1")[0]?.body).toEqual({ approve: true }),
    );
  });

  it("reloads approvals when a confirmation event arrives", async () => {
    let pending: unknown[] = [];
    const { ws } = setup({ "GET /api/confirmations": () => ({ confirmations: pending }) });
    openPanel();
    await waitFor(() => expect(screen.queryByText("Needs your approval")).toBeNull());
    pending = [
      {
        id: "conf_2",
        capabilityId: "x",
        command: "c",
        summary: "X: do it",
        sideEffect: "write",
        permissions: [],
        requestedAt: "",
        expiresAt: "",
      },
    ];
    act(() =>
      ws.message("event.created", event(5, "security.confirmation.requested", "warning", "core")),
    );
    expect(await screen.findByText("X: do it")).toBeTruthy();
  });
});

describe("Activity", () => {
  it("shows history plus live events, newest first, with filters", async () => {
    const { ws } = setup({
      "GET /api/events": () => ({
        events: [
          event(2, "build.failed", "error", "terminal", "Build failed (terminal)"),
          event(1, "git.commit.created", "info", "git", "Git commit created"),
        ],
      }),
    });
    openPanel();
    fireEvent.click(tab("Activity"));
    const feed = await screen.findByRole("list", { name: "Recent activity" });
    await waitFor(() => expect(within(feed).getAllByRole("listitem")).toHaveLength(2));
    act(() =>
      ws.message("event.created", event(3, "deploy.started", "info", "ci", "Deploying to prod")),
    );
    const rows = () =>
      within(feed)
        .getAllByRole("listitem")
        .map((li) => li.textContent);
    expect(rows()[0]).toContain("Deploying to prod");

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "git" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(rows()).toEqual([expect.stringContaining("Build failed")]);
  });
});

describe("Capabilities", () => {
  it("lists capabilities with permissions and toggles them", async () => {
    let status = "installed";
    const { api } = setup({
      "GET /api/capabilities": () => ({
        capabilities: [
          {
            id: "git",
            name: "Git",
            version: "0.1.0",
            description: "Local repository activity",
            kind: "builtin",
            status,
            health: { status: status === "enabled" ? "healthy" : "unknown" },
            permissions: [
              {
                permission: "repository_access",
                description: "Access source code repositories",
                granted: status === "enabled",
              },
            ],
            commands: [],
            data_categories: ["source code metadata"],
          },
        ],
      }),
      "POST /api/capabilities/git/enable": () => ((status = "enabled"), {}),
    });
    openPanel();
    fireEvent.click(tab("Capabilities"));
    expect(await screen.findByText("Local repository activity")).toBeTruthy();
    expect(screen.getByText("Not enabled")).toBeTruthy();
    expect(screen.getByText(/Access source code repositories/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enable Git" }));
    expect(await screen.findByRole("button", { name: "Disable Git" })).toBeTruthy();
    expect(api.posts("/api/capabilities/git/enable")).toHaveLength(1);
  });
});

describe("tabs", () => {
  it("support arrow-key navigation", () => {
    setup();
    openPanel();
    tab("Overview").focus();
    fireEvent.keyDown(tab("Overview"), { key: "ArrowRight" });
    expect(tab("Activity").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Activity"));
    fireEvent.keyDown(tab("Activity"), { key: "End" });
    expect(tab("Memory").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Memory"), { key: "ArrowLeft" });
    expect(tab("Capabilities").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Capabilities"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("Memory"), { key: "ArrowRight" });
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
  });
});

describe("Notification center", () => {
  const n = (id: string, read = false) => ({
    id,
    eventId: null,
    eventType: "build.failed",
    source: "terminal",
    severity: "error",
    title: `Problem ${id}`,
    body: null,
    read,
    createdAt: "2026-10-03T12:00:00Z",
  });

  it("shows the unread count, live notifications and mark-all-read", async () => {
    const { ws, api } = setup({
      "GET /api/notifications": () => ({ notifications: [n("a")], unread: 1 }),
    });
    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    act(() => ws.message("notification.created", { payload: { notification: n("b") } }));
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBe(bell);
    fireEvent.click(bell);
    const popover = screen.getByRole("dialog", { name: "Notifications" });
    expect(within(popover).getByText("Problem b")).toBeTruthy();
    fireEvent.click(within(popover).getByRole("button", { name: "Mark all read" }));
    await screen.findByRole("button", { name: "Notifications" });
    expect(api.posts("/api/notifications/read-all")).toHaveLength(1);
  });

  it("marks one notification read and closes on Escape", async () => {
    const { api } = setup({
      "GET /api/notifications": () => ({ notifications: [n("a")], unread: 1 }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: 'Mark "Problem a" as read' }));
    await waitFor(() => expect(api.posts("/api/notifications/a/read")).toHaveLength(1));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });
});
