// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarPrepPage } from "../src/components/CalendarPrep";
import type { CalendarUpcomingView } from "../src/core/calendar";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const upcoming: CalendarUpcomingView = {
  enabled: true,
  status: "ready",
  checkedAt: Date.parse("2026-10-22T12:00:00Z"),
  prepComplete: true,
  events: [
    {
      id: "provider:1",
      title: "Release review",
      start: "2026-10-22T14:00:00Z",
      end: "2026-10-22T15:00:00Z",
      timezone: "UTC",
      url: "https://calendar.example.org/event/1",
      private: false,
    },
    {
      id: "provider:2",
      title: "Sensitive appointment",
      start: "2026-10-22T16:00:00Z",
      end: "2026-10-22T17:00:00Z",
      timezone: "UTC",
      url: "https://calendar.example.org/secret",
      private: true,
    },
    {
      id: "provider:3",
      title: "Release freeze",
      start: "2026-10-22T18:00:00Z",
      end: "2026-10-22T19:00:00Z",
      timezone: "UTC",
      private: false,
      deployFreeze: true,
    },
  ],
  prep: {
    "provider:1": {
      decisions: [
        { text: "Use blue theme", meetingTitle: "Earlier review", href: "#/meetings/review-1" },
      ],
      actionItems: [
        { text: "Ship docs", meetingTitle: "Earlier review", href: "#/meetings/review-1" },
      ],
    },
    "provider:2": {
      decisions: [{ text: "Secret prep", meetingTitle: "Secret", href: "#/meetings/secret" }],
      actionItems: [],
    },
  },
};

function setup(routes: Parameters<typeof fakeApi>[0] = {}) {
  FakeWebSocket.reset();
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "test",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  return { api, client };
}

describe("calendar preparation", () => {
  it("reads upcoming meetings, reviewed prep with source links, freeze and redacts private events", async () => {
    const { api, client } = setup({ "GET /api/calendar/upcoming": () => upcoming });
    render(
      <CoreProvider client={client}>
        <CalendarPrepPage />
      </CoreProvider>,
    );
    const meeting = await screen.findByRole("article", { name: "Release review" });
    expect(within(meeting).getByText("Use blue theme")).toBeTruthy();
    expect(within(meeting).getByText("Ship docs")).toBeTruthy();
    expect(
      within(meeting)
        .getAllByRole("link", { name: "From Earlier review" })[0]
        ?.getAttribute("href"),
    ).toBe("#/meetings/review-1");
    expect(screen.getByText("Deployment freeze")).toBeTruthy();
    expect(screen.getByText("Private event")).toBeTruthy();
    expect(screen.queryByText("Sensitive appointment")).toBeNull();
    expect(screen.queryByText("Secret prep")).toBeNull();
    expect(api.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("suggests the notetaker with one click but never initiates recording", async () => {
    const { api, client } = setup({ "GET /api/calendar/upcoming": () => upcoming });
    render(
      <CoreProvider client={client}>
        <CalendarPrepPage />
      </CoreProvider>,
    );
    const meeting = await screen.findByRole("article", { name: "Release review" });
    fireEvent.click(within(meeting).getByRole("button", { name: "Start notetaker" }));
    expect(window.location.hash).toBe("#/meetings");
    expect(api.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(screen.getAllByText(/Recording starts only after you choose/).length).toBeGreaterThan(0);
  });

  it("uses injected data when the route is unavailable and refreshes on request", async () => {
    const { client } = setup();
    const load = vi.fn(async (): Promise<CalendarUpcomingView> => ({
      ...upcoming,
      events: [],
      prep: {},
    }));
    render(
      <CoreProvider client={client}>
        <CalendarPrepPage load={load} />
      </CoreProvider>,
    );
    expect(await screen.findByText("No upcoming meetings.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh meetings" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("shows disabled and failed-feed states without suggesting a recording", async () => {
    const { client } = setup();
    const load = vi
      .fn<() => Promise<CalendarUpcomingView>>()
      .mockResolvedValueOnce({
        ...upcoming,
        enabled: false,
        status: "unconfigured",
        checkedAt: null,
        events: [],
        prep: {},
      })
      .mockRejectedValueOnce(new Error("offline"));
    render(
      <CoreProvider client={client}>
        <CalendarPrepPage load={load} />
      </CoreProvider>,
    );
    expect(await screen.findByText(/Calendar awareness is off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start notetaker" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh meetings" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The calendar could not be read.");
  });

  it.each([
    ["unconfigured", /No calendar provider is connected/, null],
    ["unavailable", /calendar feed is unavailable/, null],
    ["stale", /calendar feed is out of date/, Date.parse("2026-10-22T11:00:00Z")],
  ] as const)(
    "shows a distinct %s state, never 'No upcoming meetings'",
    async (status, label, checkedAt) => {
      const { client } = setup();
      const load = async (): Promise<CalendarUpcomingView> => ({
        ...upcoming,
        status,
        checkedAt,
        events: [],
        prep: {},
      });
      render(
        <CoreProvider client={client}>
          <CalendarPrepPage load={load} />
        </CoreProvider>,
      );
      expect(await screen.findByText(label)).toBeTruthy();
      expect(screen.queryByText("No upcoming meetings.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Start notetaker" })).toBeNull();
    },
  );

  it("says no upcoming meetings only for a ready feed, and flags incomplete prep", async () => {
    const { client } = setup();
    const load = async (): Promise<CalendarUpcomingView> => ({
      ...upcoming,
      prepComplete: false,
    });
    render(
      <CoreProvider client={client}>
        <CalendarPrepPage load={load} />
      </CoreProvider>,
    );
    expect(await screen.findByText(/Preparation is incomplete/)).toBeTruthy();
    cleanup();
    render(
      <CoreProvider client={client}>
        <CalendarPrepPage load={async () => ({ ...upcoming, events: [], prep: {} })} />
      </CoreProvider>,
    );
    expect(await screen.findByText("No upcoming meetings.")).toBeTruthy();
  });
});
