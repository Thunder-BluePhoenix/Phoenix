// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentApprovals } from "../src/components/AgentApprovals";
import { AgentInstallersSection } from "../src/components/AgentInstallers";
import { ActivityFeed } from "../src/components/ActivityFeed";
import { ApprovalRulesSection } from "../src/components/ApprovalRules";
import { Approvals } from "../src/components/Approvals";
import { AgentSessionsPage } from "../src/components/AgentSessions";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { I18nProvider, type ActiveLocale } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { confirmation } from "./harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

const EXPIRES = new Date(Date.now() + 3_600_000).toISOString();

function screenIn(locale: ActiveLocale) {
  const api = fakeApi({
    "GET /api/confirmations": () => ({
      confirmations: [
        confirmation({
          summary: "Mock: write a note",
          preview: "Writes hello",
          risk: "high",
          task_id: undefined,
        }),
      ],
    }),
    "GET /api/agent-approvals": () => ({
      approvals: [
        {
          id: "apr_1",
          kind: "permission",
          agent: "claude-code",
          project: "/work/acme",
          tool: "Bash",
          input_summary: { command: "npm test" },
          expires_at: EXPIRES,
          always_ok: true,
        },
      ],
    }),
    "GET /api/agent-approvals/rules": () => ({
      rules: [
        {
          id: "rule_1",
          agent: "claude-code",
          project: "/work/acme",
          tool: "Bash",
          pattern: "npm test *",
          created_at: "2026-10-15T11:00:00Z",
          expires_at: EXPIRES,
          created_by: "user",
          uses: 3,
        },
      ],
    }),
    "GET /api/agent-relay/agents": () => ({
      relay: { running: true, version: 1, platform: "test" },
      agents: [
        {
          id: "claude",
          label: "Claude Code",
          support: "supported",
          doc_url: "https://example.com/claude",
          detected: true,
          detected_via: "settings directory",
          config_path: "/home/u/.claude/settings.json",
          state: "not_installed",
          missing: [],
        },
      ],
    }),
    "GET /api/events": () => ({
      events: [
        {
          seq: 1,
          description: "Built the thing",
          event: {
            event_type: "build.done",
            source: "kage",
            severity: "success",
            timestamp: "2026-10-15T11:00:00Z",
          },
        },
      ],
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
        <Approvals />
        <AgentApprovals />
        <ApprovalRulesSection />
        <AgentInstallersSection />
        <ActivityFeed />
        <AgentSessionsPage />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
}

const ENGLISH = [
  "Needs your approval",
  "Coding agents are asking",
  "Agent approval rules",
  "Coding agents",
  "Revoke",
  "Approve",
  "Reject",
  "Allow",
  "Deny",
  "Reply in terminal",
  "Always allow here",
  "What will happen",
  "Permissions used",
  "Expires",
  "Install",
  "Start a coding agent",
  "Configure a launcher",
  "All sources",
  "Severity",
  "Read what each request will do",
  "Time left",
  "3 times",
];

describe("the agents screens in Arabic", () => {
  it("are right-to-left, Arabic, and show no message id", async () => {
    screenIn("ar");
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    await waitFor(() => expect(screen.queryByText("Needs your approval")).toBeNull());
    const approvals = (await screen.findAllByRole("listitem", { name: "Mock: write a note" }))[0]!;
    // The approval card is translated: its buttons are Arabic and carry the (data) summary.
    const buttons = within(approvals).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons)
      expect(b.getAttribute("aria-label") ?? b.textContent).toMatch(/\p{Script=Arabic}/u);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/\p{Script=Arabic}/u);
    expect(text).not.toMatch(/\bagents\.[a-zA-Z]+\.[a-zA-Z.]+/);
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    // Data from Core and product words stay as they are.
    expect(text).toContain("claude-code");
    expect(text).toContain("npm test *");
    expect(text).toContain("Mock: write a note");
  });
});

describe("the agents screens in the pseudo-locale en-XA", () => {
  it("leave no English in the strings that were converted", async () => {
    screenIn("en-XA");
    await waitFor(() => expect(screen.queryByText("Needs your approval")).toBeNull());
    await screen.findAllByRole("listitem", { name: "Mock: write a note" });
    await screen
      .findByRole("heading", { name: /^\[.*\]$/, level: 3, hidden: true })
      .catch(() => null);
    const text = document.body.textContent ?? "";
    for (const english of ENGLISH) expect(text, english).not.toContain(english);
    expect(screen.queryByRole("button", { name: "Approve: Mock: write a note" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^\[/ }).length).toBeGreaterThan(5);
    // Core's own words are data and stay.
    expect(text).toContain("Mock: write a note");
    expect(text).toContain("claude-code");
  });
});
