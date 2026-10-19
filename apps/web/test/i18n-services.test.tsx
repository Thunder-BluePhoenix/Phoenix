// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiProviders } from "../src/components/AiProviders";
import { CapabilityList } from "../src/components/CapabilityList";
import { AgentsGlance } from "../src/components/Integrations";
import { QuickActions } from "../src/components/Overview";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { formatPct, formatUsd } from "../src/core/portfolio";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { aiStatus } from "./ai-fixtures";
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

const agentSession = {
  agent: "claude-code",
  agent_id: "s1",
  workspace: "/work/phoenix",
  repository: "phoenix",
  state: "waiting",
  reason: "permission",
  updated_at: new Date().toISOString(),
};

function screenIn(locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/capabilities": () => ({
      capabilities: [
        {
          ...capability("agents", "enabled"),
          permissions: [{ permission: "network", description: "Network", granted: true }],
          data_categories: ["code"],
        },
        capability("frappe", "installed"),
      ],
    }),
    "POST /api/capabilities/agents/commands/list": () => ({ id: "op-agents" }),
    "GET /api/operations/op-agents": () => ({
      status: "succeeded",
      result: { agents: [agentSession] },
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
        <QuickActions
          state={{
            state: "WORKING",
            explanation: "Building",
            since: "",
            recording: false,
            sleeping: false,
          }}
        />
        <AgentsGlance />
        <CapabilityList />
        <AiProviders status={aiStatus()} reload={async () => {}} />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

describe("the services screens in Arabic", () => {
  it("are right-to-left, Arabic, and show no message id", async () => {
    screenIn("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(await screen.findByRole("heading", { name: "وكلاء البرمجة" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "إجراءات سريعة" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "مزوّدو الذكاء الاصطناعي" })).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bservices\.[a-z]+\.[a-zA-Z.]+/);
    for (const english of ["Quick actions", "Coding agents", "Emergency stop", "AI providers"]) {
      expect(text, english).not.toContain(english);
    }
    // Digits and signs of the figures follow the language too.
    expect(formatUsd(1234.5)).not.toBe("$1,234.50");
    expect(formatPct(1.5)).toContain("1");
  });
});

describe("the services screens in the pseudo-locale en-XA", () => {
  it("leave no English in the strings that were converted", async () => {
    screenIn("en-XA");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Quick actions" })).toBeNull(),
    );
    await screen.findByRole("heading", { name: /^\[.*ç.*\]$/ });
    const text = document.body.textContent ?? "";
    for (const english of [
      "Quick actions",
      "Pause Fawkes",
      "Emergency stop",
      "Coding agents",
      "Needs your input",
      "Disable agents",
      "Permissions (",
      "Accesses:",
      "AI providers",
      "Custom endpoints",
      "Add endpoint",
      "Which model does what",
      "Save prices",
      "Key missing",
    ]) {
      expect(text, english).not.toContain(english);
    }
    expect(screen.queryByRole("list", { name: "AI providers" })).toBeNull();
    // Data from Core stays as it is.
    expect(text).toContain("claude-code");
    expect(text).toContain("OpenAI");
  });
});
