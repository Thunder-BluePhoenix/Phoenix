// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { toMarkdown } from "../src/components/Meetings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { Meeting } from "../src/core/types";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: "kage:1",
  capability_id: "kage",
  external_id: "1",
  title: "Design review",
  status: "ready",
  started_at: "2026-10-04T09:00:00Z",
  ended_at: null,
  duration_seconds: 1800,
  participants: ["Ada", "Linus"],
  recording: {
    location: "http://127.0.0.1:8000/api/meetings/1/media/audio",
    retention: "Stored and deleted by Kage",
  },
  has_transcript: true,
  has_summary: true,
  archived_at: null,
  updated_at: "2026-10-04T09:40:00Z",
  ...over,
});

const SUMMARY = {
  text: "We agreed to ship the adapter.",
  generated_by: "ai",
  topics: ["kage", "adapter"],
  decisions: ["Ship it"],
  action_items: [{ text: "Write docs", owner: "Ada", due: null }],
  follow_up_questions: [],
};

const kageCap = {
  id: "kage",
  name: "Kage",
  version: "0.1.0",
  description: "",
  kind: "builtin",
  status: "enabled",
  health: { status: "healthy" },
  permissions: [],
  commands: [{ name: "meeting.start", description: "", side_effect: "execute" }],
  data_categories: [],
};

function setup(hash: string, routes: Parameters<typeof fakeApi>[0] = {}) {
  window.location.hash = hash;
  const api = fakeApi({
    "GET /api/meetings": () => ({
      meetings: [
        meeting(),
        meeting({
          id: "kage:2",
          external_id: "2",
          title: "Standup",
          status: "transcribing",
          has_transcript: false,
          has_summary: false,
        }),
      ],
    }),
    "GET /api/meetings/kage:1": () => meeting(),
    "GET /api/meetings/kage:1/summary": () => SUMMARY,
    "GET /api/meetings/kage:1/transcript": () => ({ text: "Hello everyone." }),
    ...routes,
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
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  return { api, ws };
}

describe("Meetings page", () => {
  it("lists meetings with processing progress and links to details", async () => {
    setup("#/meetings");
    expect(screen.getByRole("link", { name: "Meetings" }).getAttribute("aria-current")).toBe(
      "page",
    );
    const row = (await screen.findByText("Standup")).closest("li")!;
    expect(within(row).getByText("Transcribing…")).toBeTruthy();
    expect(
      within(row).getByRole("progressbar", { name: "Step 2 of 3: Transcribing" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Design review" }).getAttribute("href")).toBe(
      "#/meetings/kage%3A1",
    );
  });

  it("shows the recording banner while recording (US-05)", async () => {
    const { ws } = setup("#/meetings");
    act(() =>
      ws.message("state.changed", {
        state: "RECORDING",
        explanation: "Recording meeting",
        recording: true,
        sleeping: false,
        since: new Date().toISOString(),
      }),
    );
    expect(screen.getByText("Recording is active")).toBeTruthy();
    expect(screen.getByText(/remove the bot from the call/)).toBeTruthy();
  });

  it("points to Kage setup when capture is not available", async () => {
    setup("#/meetings");
    expect(await screen.findByText(/enable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start capture…" })).toBeNull();
  });

  it("starting a capture asks for approval before anything runs", async () => {
    let pending: unknown[] = [];
    let opStatus = "pending";
    const { api, ws } = setup("#/meetings", {
      "GET /api/capabilities": () => ({ capabilities: [kageCap] }),
      "POST /api/capabilities/kage/commands/meeting.start": () => {
        pending = [
          {
            id: "conf1",
            capabilityId: "kage",
            command: "meeting.start",
            summary: "Kage: Start capturing a Google Meet call with the Kage bot",
            sideEffect: "execute",
            permissions: ["meeting_recording"],
            requestedAt: "",
            expiresAt: "",
          },
        ];
        return { id: "op_1", status: "pending" };
      },
      "GET /api/confirmations": () => ({ confirmations: pending }),
      "GET /api/operations/op_1": () => ({ id: "op_1", status: opStatus }),
      "POST /api/confirmations/conf1": () => ((pending = []), (opStatus = "succeeded"), {}),
    });
    fireEvent.change(await screen.findByLabelText("Google Meet link"), {
      target: { value: "https://meet.google.com/abc-defg-hij" },
    });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Planning" } });
    fireEvent.click(screen.getByRole("button", { name: "Start capture…" }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/kage/commands/meeting.start")[0]?.body).toEqual({
        input: { meet_url: "https://meet.google.com/abc-defg-hij", title: "Planning" },
      }),
    );
    act(() =>
      ws.message("event.created", {
        seq: 9,
        event: {
          event_id: "evt_9aaaaaaa",
          event_type: "security.confirmation.requested",
          source: "core",
          severity: "info",
          timestamp: "",
          payload: {},
        },
      }),
    );
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(screen.getByText(/uses meeting_recording/)).toBeTruthy();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(api.posts("/api/confirmations/conf1")[0]?.body).toEqual({ approve: true }),
    );
    expect(await screen.findByText(/Capture started/)).toBeTruthy();
  });
});

describe("Meeting detail (US-06)", () => {
  it("shows summary, decisions, action items, transcript and storage", async () => {
    setup("#/meetings/kage%3A1");
    expect(await screen.findByRole("heading", { name: "Design review" })).toBeTruthy();
    expect(await screen.findByText("We agreed to ship the adapter.")).toBeTruthy();
    expect(screen.getByText("(AI summary)")).toBeTruthy();
    expect(screen.getByText("adapter")).toBeTruthy();
    expect(screen.getByText("Ship it")).toBeTruthy();
    expect(screen.getByText("Write docs (Ada)")).toBeTruthy();
    expect(screen.getByText(/never acts on these by itself/)).toBeTruthy();
    expect(screen.getByText("Hello everyone.")).toBeTruthy();
    expect(screen.getByText("http://127.0.0.1:8000/api/meetings/1/media/audio")).toBeTruthy();
  });

  it("delete needs a second click and sends the confirmation flag", async () => {
    const { api } = setup("#/meetings/kage%3A1", {
      "DELETE /api/meetings/kage:1": () => ({ deleted: "kage:1" }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm: delete Phoenix's copy" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "DELETE")?.body).toEqual({ confirm: true }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/meetings"));
  });

  it("archive toggles", async () => {
    const { api } = setup("#/meetings/kage%3A1");
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(api.posts("/api/meetings/kage%3A1/archive")[0]?.body).toEqual({ archived: true }),
    );
  });

  it("explains a meeting that is gone", async () => {
    setup("#/meetings/kage%3A9");
    expect(await screen.findByText(/not in Phoenix/)).toBeTruthy();
  });

  it("exports Markdown with summary, action items and transcript", () => {
    const md = toMarkdown(meeting(), { text: "Hello everyone." }, SUMMARY as never);
    expect(md).toContain("# Design review");
    expect(md).toContain("## Decisions\n\n- Ship it");
    expect(md).toContain("- Write docs (Ada)");
    expect(md).toContain("## Transcript\n\nHello everyone.");
  });
});

describe("Pet Panel", () => {
  it("shows recent meetings with a link to all", async () => {
    setup("");
    fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
    const panel = screen.getByRole("tabpanel");
    expect(await within(panel).findByRole("link", { name: "Standup" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "All meetings" }).getAttribute("href")).toBe(
      "#/meetings",
    );
  });
});
