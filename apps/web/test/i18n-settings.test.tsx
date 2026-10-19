// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsPage } from "../src/components/Settings";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { PetState } from "../src/core/types";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { pseudoMessage } from "../src/i18n/pseudo";
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

const STATE: PetState = {
  state: "IDLE",
  explanation: "",
  since: "2026-10-09T12:00:00Z",
  recording: false,
  sleeping: false,
};

const kage = {
  id: "kage",
  name: "Kage",
  version: "0.1.0",
  description: "Capture of calls",
  kind: "builtin",
  status: "enabled",
  health: { status: "healthy" },
  permissions: [{ permission: "meeting_recording", description: "Record meetings", granted: true }],
  commands: [],
  data_categories: ["transcripts"],
  config: {},
  config_schema: { type: "object", properties: { base_url: { type: "string" } } },
  secrets: [{ name: "api_key", description: "Your Kage API key", set: true }],
};

const inventory = {
  location: "/home/me/.phoenix/dev",
  data: [
    { id: "events", description: "What capabilities reported.", count: 12, retention_days: 30 },
    { id: "meetings", description: "Meetings.", count: 0, retention_days: null },
  ],
  audit_log: { description: "Security record.", count: 5 },
  credentials: [],
  telemetry: "none",
  external_ai: "No AI is used.",
};

function open(locale: ActiveLocale) {
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
      <I18nProvider forceLocale={locale}>
        <SettingsPage state={STATE} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}

/** Every piece of text a person or a screen reader gets from the page. */
function shown(root: ParentNode): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll("*")) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out.push((node.textContent ?? "").trim());
    }
    for (const attr of ["aria-label", "title", "placeholder"]) {
      const value = el.getAttribute(attr);
      if (value) out.push(value.trim());
    }
  }
  return out.filter(Boolean);
}

describe("Settings in Arabic", () => {
  it("is right-to-left, shows Arabic text and leaks no message key", async () => {
    open("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(await screen.findByRole("heading", { level: 1, name: "الإعدادات" })).toBeTruthy();
    const privacy = (await screen.findByRole("heading", { name: "الخصوصية والبيانات" })).closest(
      "section",
    )!;
    // Plural-aware record count, the retention choice and the Core-sent description side by side.
    expect(within(privacy).getByText(/^\(المحفوظ: [12١٢]+\)$/)).toBeTruthy();
    expect(within(privacy).getByText("What capabilities reported.")).toBeTruthy();
    expect(within(privacy).getByText("سجل التدقيق", { selector: "strong" })).toBeTruthy();
    expect(within(privacy).getByText("لا يرسل Phoenix أي قياسات عن بُعد.")).toBeTruthy();
    const caps = (await screen.findByRole("heading", { name: "القدرات" })).closest("section")!;
    expect(within(caps).getByText("مفعّل", { selector: "span.status" })).toBeTruthy();
    expect(within(caps).getByRole("button", { name: "تعطيل Kage" })).toBeTruthy();
    expect(within(caps).getByRole("button", { name: "حفظ الإعدادات" })).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\bsettings\.[a-zA-Z]+\.[a-zA-Z.]*/);
    expect(body).not.toMatch(/\bcommon\.[a-zA-Z]+\.[a-zA-Z]+/);
  });

  it("deleting reads as a full Arabic sentence with the plural form of the count", async () => {
    const api = open("ar");
    api.set("POST /api/privacy/delete", () => ({ deleted: 3 }));
    const privacy = (await screen.findByRole("heading", { name: "الخصوصية والبيانات" })).closest(
      "section",
    )!;
    const events = within(privacy).getByText("سجل النشاط", { selector: "strong" }).closest("li")!;
    fireEvent.click(within(events).getByRole("button", { name: "حذف الكل…" }));
    fireEvent.click(within(events).getByRole("button", { name: "تأكيد: حذف سجل النشاط بالكامل" }));
    expect((await within(privacy).findByRole("status")).textContent).toMatch(
      /^حُذفت [3٣] سجلات من سجل النشاط\.$/,
    );
  });
});

describe("Settings in the pseudo-locale en-XA", () => {
  it("leaves no converted English on the page", async () => {
    open("en-XA");
    await screen.findByRole("heading", { level: 1, name: pseudoMessage(en["settings.title"]) });
    await screen.findByText(pseudoMessage(en["settings.privacy.title"]));
    await screen.findByText(pseudoMessage(en["settings.capabilities.title"]));
    await screen.findByText(pseudoMessage(en["settings.notifications.title"]));
    await screen.findByText(pseudoMessage(en["settings.support.title"]));

    const english = new Set<string>(
      Object.entries(en)
        .filter(([key, text]) => key.startsWith("settings.") && !text.includes("{"))
        .map(([, text]) => text),
    );
    // Only the sections of this namespace; the other sections belong to other namespaces.
    const titles = [
      en["settings.privacy.title"],
      en["settings.capabilities.title"],
      en["settings.notifications.title"],
      en["settings.support.title"],
    ];
    const mine = titles.map((title) => screen.getByText(pseudoMessage(title)).closest("section")!);
    const leaked = mine.flatMap((section) => shown(section)).filter((text) => english.has(text));
    expect(leaked).toEqual([]);

    // Messages built from variables keep the variable, wrapped in the pseudo text.
    expect(
      await screen.findByRole("button", {
        name: pseudoMessage(en["settings.capability.disable"]).replace("{name}", "Kage"),
      }),
    ).toBeTruthy();
    expect(screen.getByText("/home/me/.phoenix/dev", { selector: "code" })).toBeTruthy();
  });
});
