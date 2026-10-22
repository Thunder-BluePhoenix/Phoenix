// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineeringSignals } from "../src/components/EngineeringSignals";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { readSignalsSnapshot } from "../src/core/signals";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});

describe("engineering signals dashboard", () => {
  it("shows current findings and only watches a folder after explicit submission", async () => {
    let watchedRoots: string[] = [];
    const signal = {
      id: "engineering.config_drift.abc",
      kind: "config_drift",
      repo: "project",
      subject: "API_KEY",
      detail: "API_KEY",
      observedAt: 100,
    };
    const snapshot = () => ({ watchedRoots, signals: watchedRoots.length ? [signal] : [] });
    const api = fakeApi({
      "GET /api/engineering-signals": () => snapshot(),
      "PUT /api/engineering-signals/watched-roots": (body) => {
        if (
          !body ||
          typeof body !== "object" ||
          !("watchedRoots" in body) ||
          !Array.isArray(body.watchedRoots)
        )
          throw new Error("invalid roots");
        watchedRoots = body.watchedRoots;
        return snapshot();
      },
    });
    const client = new PhoenixClient({
      token: "tok",
      baseUrl: "http://127.0.0.1:4870",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <I18nProvider forceLocale="en">
          <EngineeringSignals />
        </I18nProvider>
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    expect(await screen.findByText("Choose a repository folder to start watching.")).toBeTruthy();
    expect(
      api.calls.filter(
        (call) => call.method === "PUT" && call.path === "/api/engineering-signals/watched-roots",
      ),
    ).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Repository folder"), {
      target: { value: "/tmp/project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Watch folder" }));
    await waitFor(() => expect(screen.getByText(/project — API_KEY/)).toBeTruthy());
    expect(watchedRoots).toEqual(["/tmp/project"]);
    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    await waitFor(() => expect(watchedRoots).toEqual([]));
  });

  it("rejects malformed findings", () => {
    expect(
      readSignalsSnapshot({
        watchedRoots: [],
        signals: [
          {
            id: "engineering.foo",
            kind: "unknown",
            repo: "r",
            subject: "s",
            detail: "d",
            observedAt: 1,
          },
        ],
      }),
    ).toBeNull();
    expect(
      readSignalsSnapshot({
        watchedRoots: [],
        signals: [
          {
            id: "engineering.config_drift.abc",
            kind: "config_drift",
            repo: "r",
            subject: "s",
            detail: "d",
            observedAt: NaN,
          },
        ],
      }),
    ).toBeNull();
  });

  it("truncates an oversized signal list instead of rejecting it", () => {
    const row = (index: number) => ({
      id: `engineering.config_drift.${index}`,
      kind: "config_drift",
      repo: "r",
      subject: `S${index}`,
      detail: "d",
      observedAt: 1,
    });
    const snapshot = readSignalsSnapshot({
      watchedRoots: ["/tmp/project"],
      signals: Array.from({ length: 900 }, (_, index) => row(index)),
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.watchedRoots).toEqual(["/tmp/project"]);
    expect(snapshot!.signals).toHaveLength(500);
  });

  it("parses availability, clips reasons and treats a missing report as unavailable", () => {
    const parsed = readSignalsSnapshot({
      watchedRoots: [],
      signals: [],
      availability: {
        advisories: { available: false, reason: "r".repeat(1000) },
        history: { available: true },
      },
    });
    expect(parsed!.availability.advisories.available).toBe(false);
    expect(parsed!.availability.advisories.reason!.length).toBeLessThanOrEqual(200);
    expect(parsed!.availability.history).toEqual({ available: true });
    const missing = readSignalsSnapshot({ watchedRoots: [], signals: [] });
    expect(missing!.availability.advisories.available).toBe(false);
    expect(missing!.availability.history.available).toBe(false);
  });

  it("does not claim there are no signals when a provider is unavailable", async () => {
    let availability: unknown = {
      advisories: { available: false, reason: "<b>No local advisory database</b>" },
      history: { available: true },
    };
    const api = fakeApi({
      "GET /api/engineering-signals": () => ({
        watchedRoots: ["/tmp/project"],
        signals: [],
        availability,
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
        <I18nProvider forceLocale="en">
          <EngineeringSignals />
        </I18nProvider>
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    expect(await screen.findByText(/Dependency advisories not evaluated/)).toBeTruthy();
    expect(screen.getByText(/<b>No local advisory database<\/b>/)).toBeTruthy();
    expect(screen.queryByText("No current signals for watched repositories.")).toBeNull();
    availability = {
      advisories: { available: true },
      history: { available: true },
    };
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("No current signals for watched repositories.")).toBeTruthy();
    expect(screen.queryByText(/not evaluated/)).toBeNull();
  });
});
