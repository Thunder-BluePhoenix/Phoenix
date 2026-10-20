// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecapPage } from "../src/components/Recap";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider } from "../src/i18n";
import { en } from "../src/i18n/en";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.dir = "ltr";
});

const DAYS = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

const week = {
  week: { start: DAYS[0], end: DAYS[6], days: DAYS, time_zone: "UTC", current: false },
  coding: {
    seconds: 60,
    sessions: 1,
    steps: 1,
    files: 1,
    lines_added: 1,
    lines_removed: 0,
    lines_changed: 1,
    commands: 1,
    longest_session_seconds: 60,
  },
  permissions: { granted: 3, denied: 4 },
  top_agent: null,
  top_project: null,
  busiest_day: null,
  days: DAYS.map((day) => ({ day, steps: 0, seconds: 0, commits: 0 })),
  commits: 0,
  ci: { passed: 0, failed: 0 },
  meetings: { count: 2, decisions: 2 },
  meetings_allowed: true,
  grid: { weeks: [], max: 0, total: 0, source: "local-git-events" },
};

function mount(forceLocale?: "ar") {
  const api = fakeApi({ "GET /api/recap": () => week });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider {...(forceLocale ? { forceLocale } : {})}>
        <RecapPage />
      </I18nProvider>
    </CoreProvider>,
  );
}

describe("recap delete note", () => {
  it("tells the person that permission and meeting counts are not removed by the delete", async () => {
    mount();
    const button = await screen.findByRole("button", { name: "Delete all recap statistics…" });
    const note = screen.getByText(en["memory.recap.deleteNote"]);
    expect(note.textContent).toMatch(/audit log/);
    expect(note.textContent).toMatch(/does not remove them/);
    // The note sits right under the delete button.
    expect(button.nextElementSibling).toBe(note);
  });

  it("is translated", async () => {
    mount("ar");
    await screen.findByText("حذف كل إحصاءات الملخص…");
    expect(screen.queryByText(en["memory.recap.deleteNote"])).toBeNull();
    expect(document.body.textContent).not.toContain("memory.recap.deleteNote");
  });
});
