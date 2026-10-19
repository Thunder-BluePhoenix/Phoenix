// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PetPanel } from "../src/components/PetPanel";
import { SourcePills } from "../src/components/SourcePills";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { Pill } from "../src/core/appearance";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const appearance = {
  outfit: "ember-scarf",
  hemisphere: "north",
  packs: [],
  sources: {},
  builtin: [],
  known: [{ id: "agent:codex", label: "Codex", kind: "agent" }],
  glyphs: [],
  limits: { packs: 8, pack_bytes: 200_000, sources: 64 },
};

const pills: Pill[] = Array.from({ length: 6 }, (_, i) => ({
  id: `agent:a${i}`,
  label: `A${i}`,
  colour: "#1971c2",
  glyph: "spark",
}));

function screenIn(locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/pet/settings": () => ({ reduced_motion: "on" }),
    "GET /api/fawkes/appearance": () => appearance,
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale={locale}>
        <PetPanel
          id="pet-panel"
          state={{
            state: "WORKING",
            explanation: "Building",
            since: "",
            recording: false,
            sleeping: false,
          }}
          tasks={[]}
          onClose={() => {}}
          initialTab="wardrobe"
        />
        <SourcePills pills={pills} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

describe("the pet screens in Arabic", () => {
  it("are right-to-left, Arabic, and show no message id", async () => {
    screenIn("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    const panel = screen.getByRole("dialog");
    expect(await within(panel).findByRole("tab", { name: "خزانة الملابس" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "أغلق لوحة الحيوان الأليف" })).toBeTruthy();
    expect(await within(panel).findByText("استيراد زي")).toBeTruthy();
    expect(within(panel).getByText(/^يرتدي:/)).toBeTruthy();
    // Six pills, four drawn, the other two counted in Arabic text.
    expect(screen.getByRole("list", { name: "المصادر النشطة" }).textContent).toContain("أخرى");
    // The pet's own accessible name follows the language, with the state word translated.
    expect(within(panel).getByRole("button", { name: /^Fawkes — خامل/ })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Fawkes — Idle/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bpet\.[a-z]+\.[a-zA-Z.]+/);
    expect(document.body.textContent).not.toContain("Import an outfit");
    expect(document.body.textContent).not.toContain("Sources in Fawkes");
  });
});

describe("the pet screens in the pseudo-locale en-XA", () => {
  it("leave no English in the strings that were converted", async () => {
    screenIn("en-XA");
    const panel = screen.getByRole("dialog");
    await waitFor(() => expect(within(panel).queryByRole("tab", { name: "Wardrobe" })).toBeNull());
    expect((await within(panel).findAllByRole("radio", { name: /^\[/ })).length).toBeGreaterThan(8);
    const text = document.body.textContent ?? "";
    for (const english of [
      "Import an outfit",
      "Outfit pack (JSON)",
      "Import outfit",
      "Sources in Fawkes",
      "No outfit",
      "Follow the season",
      "Ember Scarf",
      "Northern",
      "Outfits are only decoration",
      "+2 more",
    ]) {
      expect(text, english).not.toContain(english);
    }
    expect(within(panel).queryByRole("button", { name: "Close Pet Panel" })).toBeNull();
    expect(within(panel).queryByRole("tablist", { name: "Pet Panel sections" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Active sources" })).toBeNull();
    expect(screen.getByRole("list", { name: /^\[.*\]$/ })).toBeTruthy();
    // Core's own words (the source's name) are data and stay as they are.
    expect(text).toContain("Codex");
  });
});
