// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { celebrationFrom } from "../src/core/rebirth";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function celebrate(
  ws: FakeWebSocket,
  payload: unknown,
  source = "core",
  type = "fawkes.celebration",
) {
  act(() =>
    ws.message("event.created", {
      seq: null,
      event: {
        event_id: `evt_${Math.random().toString(36).slice(2, 12)}`,
        event_type: type,
        source,
        severity: "info",
        timestamp: "2026-10-09T12:00:00Z",
        payload,
      },
    }),
  );
}

function open(saved = { milestones: false, highContrast: false }) {
  let current = { ...saved };
  return openAt("#/", {
    "GET /api/fawkes/rebirth": () => current,
    "PUT /api/fawkes/rebirth": (body) => {
      current = { ...current, ...(body as object) };
      return current;
    },
  });
}

/** Lets pending promises and effects settle without a timer. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await act(async () => Promise.resolve());
}

const announcement = (container: HTMLElement) =>
  container.querySelector(".fawkes-rebirth [role=status]")?.textContent;

describe("the avatar wrapped in the rebirth celebration", () => {
  it("announces a rebirth Core pushed, and draws nothing before one", async () => {
    const { ws, container } = open();
    await waitFor(() => expect(container.querySelector(".fawkes-rebirth")).not.toBeNull());
    expect(announcement(container)).toBe("");
    celebrate(ws, { kind: "rebirth", id: 1 });
    await waitFor(() =>
      expect(announcement(container)).toBe("Fawkes has risen again: the failing build is fixed."),
    );
  });

  it("shows a milestone only when the saved switch is on", async () => {
    const off = open();
    await waitFor(() => expect(off.container.querySelector(".fawkes-rebirth")).not.toBeNull());
    celebrate(off.ws, { kind: "pr-streak", id: 2 });
    await flush();
    expect(announcement(off.container)).toBe("");
    cleanup();

    FakeWebSocket.reset();
    const on = open({ milestones: true, highContrast: false });
    await waitFor(() =>
      expect(on.api.calls.some((c) => c.path === "/api/fawkes/rebirth")).toBe(true),
    );
    await waitFor(() => expect(on.container.querySelector(".fawkes-rebirth")).not.toBeNull());
    await flush();
    celebrate(on.ws, { kind: "pr-streak", id: 3 });
    await waitFor(() =>
      expect(announcement(on.container)).toBe("Three pull requests merged in a row."),
    );
  });

  it("applies the high-contrast switch to the avatar", async () => {
    const { container } = open({ milestones: false, highContrast: true });
    await waitFor(() =>
      expect(container.querySelector(".fawkes-rebirth--contrast")).not.toBeNull(),
    );
  });

  it("ignores a celebration that is not from Core or is malformed", async () => {
    const { ws, container } = open();
    await waitFor(() => expect(container.querySelector(".fawkes-rebirth")).not.toBeNull());
    celebrate(ws, { kind: "rebirth", id: 4 }, "terminal");
    celebrate(ws, { kind: "<img src=x onerror=alert(1)>", id: 5 });
    celebrate(ws, { kind: "rebirth", id: "6" });
    celebrate(ws, { kind: "rebirth", id: 1.5 });
    celebrate(ws, null);
    celebrate(ws, { kind: "rebirth", id: 7 }, "core", "fawkes.celebration.extra");
    await flush();
    expect(announcement(container)).toBe("");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("celebrationFrom", () => {
  it("accepts only a known kind with a safe integer id", () => {
    expect(celebrationFrom({ kind: "rebirth", id: 3 })).toEqual({ kind: "rebirth", id: 3 });
    expect(celebrationFrom({ kind: "first-green-week", id: 0 })).toEqual({
      kind: "first-green-week",
      id: 0,
    });
    for (const bad of [
      undefined,
      null,
      "rebirth",
      {},
      { kind: "other", id: 1 },
      { kind: "rebirth", id: Number.MAX_SAFE_INTEGER + 1 },
      { kind: "rebirth", id: NaN },
      { kind: "rebirth" },
    ])
      expect(celebrationFrom(bad)).toBeNull();
  });
});

describe("the celebration switches in Settings", () => {
  it("shows the saved choices and saves a change exactly as the API expects", async () => {
    const { api } = openAt("#/settings", {
      "GET /api/fawkes/rebirth": () => ({ milestones: false, highContrast: false }),
      "PUT /api/fawkes/rebirth": (body) => ({
        milestones: false,
        highContrast: false,
        ...(body as object),
      }),
    });
    const section = within(
      (await screen.findByRole("heading", { name: "Fawkes celebrations" })).closest("section")!,
    );
    const milestones = (await section.findByRole("checkbox", {
      name: /Also celebrate milestones/,
    })) as HTMLInputElement;
    expect(milestones.checked).toBe(false);
    fireEvent.click(milestones);
    await waitFor(() =>
      expect(api.calls.filter((c) => c.method === "PUT")).toEqual([
        { method: "PUT", path: "/api/fawkes/rebirth", body: { milestones: true } },
      ]),
    );
    const contrast = await section.findByRole("checkbox", { name: /black and white/ });
    fireEvent.click(contrast);
    await waitFor(() =>
      expect(api.calls.filter((c) => c.method === "PUT")[1]?.body).toEqual({ highContrast: true }),
    );
  });

  it("says so when the settings cannot be loaded, instead of showing switches that do nothing", async () => {
    openAt("#/settings", {
      "GET /api/fawkes/rebirth": () => {
        throw new Error("boom");
      },
    });
    const section = within(
      (await screen.findByRole("heading", { name: "Fawkes celebrations" })).closest("section")!,
    );
    expect((await section.findByRole("alert")).textContent).toBe("Could not load these settings.");
    expect(section.queryByRole("checkbox")).toBeNull();
  });
});
