// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function open(initialReserved: boolean, failSave = false) {
  let reserved = initialReserved;
  return openAt("#/settings", {
    "GET /api/events/source-policy": () => ({ reserveTerminal: reserved }),
    "PUT /api/events/source-policy": (body) => {
      if (failSave) throw new Error("boom");
      reserved = (body as { reserveTerminal: boolean }).reserveTerminal;
      return { reserveTerminal: reserved };
    },
  });
}

const section = async () =>
  within(
    (await screen.findByRole("heading", { name: "Terminal events from other programs" })).closest(
      "section",
    )!,
  );

describe("terminal event source setting", () => {
  it("shows the stored choice and saves a change exactly as the API expects", async () => {
    const { api } = open(false);
    const s = await section();
    const box = (await s.findByRole("checkbox", {
      name: "Refuse events that claim to come from the terminal",
    })) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);

    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(true));
    expect(api.calls.filter((c) => c.method === "PUT")).toEqual([
      { method: "PUT", path: "/api/events/source-policy", body: { reserveTerminal: true } },
    ]);

    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
    expect(api.calls.filter((c) => c.method === "PUT")[1]?.body).toEqual({
      reserveTerminal: false,
    });
  });

  it("loads an already-on choice as checked", async () => {
    open(true);
    const s = await section();
    const box = (await s.findByRole("checkbox")) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
  });

  it("keeps the old state and shows the error when saving fails", async () => {
    open(false, true);
    const s = await section();
    const box = (await s.findByRole("checkbox")) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.click(box);
    await s.findByRole("alert");
    expect(box.checked).toBe(false);
  });
});
