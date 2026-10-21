// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwakeGlance } from "../src/components/Awake";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const idle = { active: false, battery_floor_percent: 10, min_minutes: 1, max_minutes: 10080 };

function screenIn(locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/capabilities": () => ({ capabilities: [capability("awake", "enabled")] }),
    "POST /api/capabilities/awake/commands/status": () => ({ id: "op-status" }),
    "GET /api/operations/op-status": () => ({ status: "succeeded", result: idle }),
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
        <AwakeGlance />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

const ENGLISH = [
  "Keep awake",
  "15 minutes",
  "4 hours",
  "While agents work",
  "Reason (optional)",
  "Closing the lid still puts",
];

describe("Keep awake in Arabic", () => {
  it("is right-to-left, Arabic, with Arabic plurals, and shows no message id", async () => {
    screenIn("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(await screen.findByRole("heading", { name: "إبقاء الجهاز مستيقظًا" })).toBeTruthy();
    // Arabic "few" (3-10) and the dual for 2 hours come from the locale's plural rules.
    expect(screen.getByRole("button", { name: /^١٥ دقيقة$|^15 دقيقة$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^٤ ساعات$|^4 ساعات$/ })).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bpower\.awake\.[a-zA-Z.]+/);
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
  });
});

describe("Keep awake in the pseudo-locale en-XA", () => {
  it("leaves no English in the converted strings", async () => {
    screenIn("en-XA");
    await screen.findByRole("heading", { name: /^\[.*\]$/ });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Keep awake" })).toBeNull());
    const text = document.body.textContent ?? "";
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    expect(text).not.toMatch(/\bpower\.awake\.[a-zA-Z.]+/);
  });
});
