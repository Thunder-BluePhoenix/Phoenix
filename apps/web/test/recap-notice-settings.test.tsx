// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecapNoticeStatus } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("weekly recap notice setting", () => {
  it("is off by default, has its own switch and posts only {enabled}", async () => {
    let current: RecapNoticeStatus = { enabled: false, last_week: null, time_zone: "UTC" };
    const { api } = openAt("#/settings", {
      "GET /api/recap/notice": () => current,
      "POST /api/recap/notice": (body) => {
        current = { ...current, ...(body as object), last_week: "2026-W46" };
        return current;
      },
    });
    const heading = await screen.findByRole("heading", { name: "Weekly recap notice" });
    const s = within(heading.closest("section")!);
    const box = (await s.findByRole("checkbox", {
      name: "Show a weekly recap notice on Monday",
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(s.getByText("No weekly recap notice has been shown yet.")).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(api.posts("/api/recap/notice")).toHaveLength(1));
    expect(api.posts("/api/recap/notice")[0]?.body).toEqual({ enabled: true });
    expect(api.posts("/api/proactive/preferences")).toHaveLength(0);
    expect(await s.findByText("Last notice for week 2026-W46.")).toBeTruthy();
    expect(
      (
        s.getByRole("checkbox", {
          name: "Show a weekly recap notice on Monday",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });
});
