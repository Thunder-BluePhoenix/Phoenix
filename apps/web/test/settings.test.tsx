// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { fromForm } from "../src/components/Settings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const kage = {
  id: "kage",
  name: "Kage",
  version: "0.1.0",
  description: "Meetings",
  kind: "builtin",
  status: "installed",
  health: { status: "unknown" },
  permissions: [
    { permission: "meeting_recording", description: "Record meetings", granted: true },
    { permission: "network", description: "Make network connections", granted: false },
  ],
  commands: [],
  data_categories: ["transcripts"],
  config: { poll_ms: 5000 },
  config_schema: {
    type: "object",
    properties: {
      base_url: { type: "string" },
      poll_ms: { type: "integer", minimum: 250 },
      repositories: { type: "array", items: { type: "string" } },
    },
  },
  secrets: [{ name: "api_key", description: "Your Kage API key", set: false }],
};

const inventory = {
  location: "/home/me/.phoenix/dev",
  data: [
    { id: "events", description: "What capabilities reported.", count: 12, retention_days: null },
    { id: "notifications", description: "Alerts.", count: 0, retention_days: 7 },
    { id: "meetings", description: "Meetings.", count: 2, retention_days: null },
  ],
  audit_log: { description: "Security record.", count: 5 },
  credentials: [],
  telemetry: "none",
  external_ai: "Phoenix has no AI features yet; nothing is sent to AI providers.",
};

function setup() {
  window.location.hash = "#/settings";
  const api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: [kage] }),
    "GET /api/privacy": () => inventory,
    "GET /api/pet/settings": () => ({ reduced_motion: "auto" }),
    "GET /api/notifications/preferences": () => ({
      enabled: true,
      min_severity: "warning",
      muted_sources: [],
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
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

describe("Settings (FR-014)", () => {
  it("reduced motion is saved in core and applied to Fawkes", async () => {
    const api = setup();
    const fawkes = () => document.querySelector(".navbar .fawkes")!;
    await waitFor(() => expect(fawkes().getAttribute("data-reduced-motion")).toBe("false"));
    api.set("GET /api/pet/settings", () => ({ reduced_motion: "on" }));
    fireEvent.click(await screen.findByLabelText(/Always reduce motion/));
    await waitFor(() =>
      expect(api.posts("/api/pet/settings")[0]?.body).toEqual({ reduced_motion: "on" }),
    );
    await waitFor(() => expect(fawkes().getAttribute("data-reduced-motion")).toBe("true"));
  });

  it("quiet mode and muting a capability update notification preferences", async () => {
    const api = setup();
    fireEvent.click(await screen.findByLabelText(/Quiet mode/));
    await waitFor(() =>
      expect(api.posts("/api/notifications/preferences")[0]?.body).toEqual({ enabled: false }),
    );
    const mute = within(screen.getByRole("group", { name: "Mute a capability" })).getByLabelText(
      "Kage",
    );
    fireEvent.click(mute);
    await waitFor(() =>
      expect(api.posts("/api/notifications/preferences")[1]?.body).toEqual({
        muted_sources: ["kage"],
      }),
    );
  });

  it("configures a capability from its schema and stores its API key separately", async () => {
    const api = setup();
    fireEvent.change(await screen.findByLabelText("Server address"), {
      target: { value: " http://127.0.0.1:8000 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/kage/config")[0]?.body).toEqual({
        config: { base_url: "http://127.0.0.1:8000", poll_ms: 5000 },
      }),
    );
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "k-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save API key" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/kage/secrets/api_key")[0]?.body).toEqual({
        value: "k-123",
      }),
    );
    expect(JSON.stringify(api.posts("/api/capabilities/kage/config"))).not.toContain("k-123");
  });

  it("revokes a single permission", async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Record meetings" }));
    await waitFor(() =>
      expect(api.posts("/api/permissions/kage/revoke")[0]?.body).toEqual({
        permissions: ["meeting_recording"],
      }),
    );
    expect(screen.queryByRole("button", { name: /Revoke Make network/ })).toBeNull();
  });

  it("shows where data lives, sets retention, and deletes only after confirming", async () => {
    const api = setup();
    expect(await screen.findByText("/home/me/.phoenix/dev")).toBeTruthy();
    expect(screen.getByText(/sends no telemetry/)).toBeTruthy();
    const events = screen.getByText("Activity history").closest("li")!;
    fireEvent.change(within(events).getByLabelText("Keep"), { target: { value: "30" } });
    await waitFor(() =>
      expect(api.posts("/api/privacy/retention")[0]?.body).toEqual({ events: 30 }),
    );

    fireEvent.click(within(events).getByRole("button", { name: "Delete all…" }));
    expect(api.posts("/api/privacy/delete")).toHaveLength(0);
    fireEvent.click(
      within(events).getByRole("button", { name: "Confirm: delete all activity history" }),
    );
    await waitFor(() =>
      expect(api.posts("/api/privacy/delete")[0]?.body).toEqual({ data: "events", confirm: true }),
    );
    // Nothing to delete → nothing to click.
    const notes = screen.getByText("Notifications", { selector: "strong" }).closest("li")!;
    expect(
      (within(notes).getByRole("button", { name: "Delete all…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("fromForm", () => {
  it("drops empty fields so defaults apply, and converts types", () => {
    const schema = kage.config_schema;
    expect(
      fromForm(schema, { base_url: "", poll_ms: "1000", repositories: " /a \n\n/b " }),
    ).toEqual({
      poll_ms: 1000,
      repositories: ["/a", "/b"],
    });
  });
});
