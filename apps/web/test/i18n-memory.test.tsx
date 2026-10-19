// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeetingsPage } from "../src/components/Meetings";
import { RecapPage } from "../src/components/Recap";
import { RetrievalSettingsSection } from "../src/components/RetrievalSettings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { Recap } from "../src/core/recap";
import { buildRecapSvg } from "../src/core/recap-image";
import type { Meeting, PetState } from "../src/core/types";
import { getActive, activate, resetActive, translate } from "../src/i18n/store";
import { en } from "../src/i18n/en";
import { I18nProvider, type ActiveLocale, type MessageKey, type Vars } from "../src/i18n";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const ARABIC = /[\u0600-\u06FF]/;
const DAYS = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

const recap: Recap = {
  week: { start: "2026-10-26", end: "2026-11-01", days: DAYS, time_zone: "UTC", current: false },
  coding: {
    seconds: 5400,
    sessions: 3,
    steps: 13,
    files: 2,
    lines_added: 18,
    lines_removed: 3,
    lines_changed: 21,
    commands: 3,
    longest_session_seconds: 1200,
  },
  permissions: { granted: 3, denied: 4 },
  top_agent: { name: "claude-code", steps: 10 },
  top_project: { name: "PROJECTCANARY", steps: 10 },
  busiest_day: { day: "2026-11-01", steps: 6, seconds: 1200 },
  days: DAYS.map((day) => ({ day, steps: 0, seconds: 0, commits: 0 })),
  commits: 4,
  ci: { passed: 2, failed: 1 },
  meetings: { count: 2, decisions: 2 },
  meetings_allowed: true,
  grid: {
    weeks: [{ start: "2026-10-26", days: DAYS.map((day, i) => ({ day, count: i })) }],
    max: 6,
    total: 21,
    source: "local-git-events",
  },
};

const meeting: Meeting = {
  id: "kage:2",
  capability_id: "kage",
  external_id: "2",
  title: "Standup",
  status: "transcribing",
  started_at: "2026-10-04T09:00:00Z",
  ended_at: null,
  duration_seconds: 1800,
  participants: [],
  recording: null,
  has_transcript: false,
  has_summary: false,
  archived_at: null,
  updated_at: "2026-10-04T09:40:00Z",
};

const state: PetState = {
  state: "RECORDING",
  explanation: "",
  since: "2026-10-04T09:00:00Z",
  recording: true,
  sleeping: false,
};

function mount(locale: ActiveLocale, ui: React.ReactNode) {
  const api = fakeApi({
    "GET /api/recap": () => recap,
    "GET /api/meetings": () => ({ meetings: [meeting] }),
    "GET /api/retrieval/settings": () => ({ enabled: false, provider: "ollama", model: "nomic" }),
    "GET /api/retrieval/status": () => ({
      active: false,
      inactive_reason: "retrieval_disabled",
      total: 12,
      embedded: 10,
      unembedded: 2,
      failures: 1,
      payload_bytes: 30_720,
      provider: "ollama",
      model: "nomic",
      other_models: [],
      last_run: null,
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
      <I18nProvider forceLocale={locale}>{ui}</I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

describe("the memory screens in Arabic", () => {
  it("are right-to-left Arabic and show no message id", async () => {
    mount(
      "ar",
      <>
        <MeetingsPage state={state} />
        <RecapPage />
        <RetrievalSettingsSection />
      </>,
    );
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    // Wait for the data screens, then for Arabic headings (the language chunk loads lazily).
    await screen.findByText("Standup");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(ARABIC),
    );
    await waitFor(() => expect(document.querySelector("#recap-h")?.textContent).toMatch(ARABIC));
    await waitFor(() =>
      expect(document.querySelector("#retrieval-h")?.textContent).toMatch(ARABIC),
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bmemory\.[a-z]+\.[a-zA-Z.]+/);
    for (const english of [
      "Weekly recap",
      "Recording is active",
      "Smart search",
      "Search meetings",
    ]) {
      expect(text, english).not.toContain(english);
    }
    // Core's own words (a meeting's title) are data and stay as they are.
    expect(text).toContain("Standup");
  });

  it("draws the share image in Arabic, mirrored, with the project still omitted when off", async () => {
    await activate("ar");
    const svg = buildRecapSvg(recap);
    expect(getActive().locale).toBe("ar");
    expect(svg).toMatch(ARABIC);
    expect(svg).toContain('direction="rtl"');
    expect(svg).not.toContain("WEEKLY RECAP");
    expect(svg).not.toContain("PROJECTCANARY");
    expect(buildRecapSvg(recap, { showProjects: true })).toContain("PROJECTCANARY");
  });
});

describe("the memory screens in the pseudo-locale en-XA", () => {
  it("leave no English in the strings that were converted", async () => {
    mount(
      "en-XA",
      <>
        <MeetingsPage state={state} />
        <RecapPage />
        <RetrievalSettingsSection />
      </>,
    );
    await screen.findByText("Standup");
    await waitFor(() => expect(document.querySelector("#recap-h")?.textContent).toMatch(/^\[/));
    const text = document.body.textContent ?? "";
    for (const english of [
      "Weekly recap",
      "Recording is active",
      "Capture a meeting",
      "Search and ask across meetings",
      "Recent meetings",
      "Time coding",
      "Commit grid",
      "Save image",
      "Smart search",
      "Rebuild entire index",
      "Index size",
      "Show archived",
    ]) {
      expect(text, english).not.toContain(english);
    }
    expect(text).toContain("Standup");
  });

  it("draws the share image in the pseudo-locale", async () => {
    await activate("en-XA");
    const svg = buildRecapSvg(recap);
    expect(svg).not.toContain("PHOENIX · WEEKLY RECAP");
    expect(svg).not.toContain("time coding");
    expect(svg).not.toContain("permissions granted");
    expect(svg).not.toContain("Longest session");
    expect(svg).not.toContain("PROJECTCANARY");
  });

  it("passing a translator fixes the language of the image whatever is on screen", async () => {
    await activate("en-XA");
    const english = {
      t: (key: MessageKey, vars?: Vars) => translate(key, vars, { locale: "en", messages: en }),
      locale: "en" as const,
    };
    const svg = buildRecapSvg(recap, { text: english });
    expect(svg).toContain("PHOENIX · WEEKLY RECAP");
    expect(svg).toContain("permissions granted");
    expect(svg).toContain("Longest session");
    expect(svg).not.toContain('direction="rtl"');
  });
});
