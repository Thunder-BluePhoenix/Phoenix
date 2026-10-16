// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentApprovalRule } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { sendEvent } from "./harness";
import { openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const rule = (patch: Partial<AgentApprovalRule> = {}): AgentApprovalRule => ({
  id: "rule_1",
  agent: "claude-code",
  project: "/work/acme",
  tool: "Bash",
  pattern: "npm test *",
  created_at: "2026-10-15T11:00:00Z",
  expires_at: "2026-10-15T12:00:00Z",
  created_by: "user",
  uses: 3,
  ...patch,
});

function settings(initial: AgentApprovalRule[]) {
  let rules = initial;
  const m = openAt("#/settings", {
    "GET /api/agent-approvals/rules": () => ({ rules }),
    "DELETE /api/agent-approvals/rules/rule_1": () => {
      rules = rules.filter((r) => r.id !== "rule_1");
      return {};
    },
  });
  return { ...m, set: (next: AgentApprovalRule[]) => (rules = next) };
}

const section = async () =>
  within(
    (await screen.findByRole("heading", { name: "Agent approval rules" })).closest("section")!,
  );

describe("Settings: Agent approval rules", () => {
  it("lists each rule with project, tool, pattern, expiry and uses", async () => {
    settings([rule(), rule({ id: "rule_2", tool: "Edit", pattern: "src/a.ts", uses: 1 })]);
    const s = await section();
    const item = await s.findByRole("listitem", { name: "Bash npm test * in /work/acme" });
    const i = within(item);
    expect(i.getByText("npm test *").tagName).toBe("CODE");
    expect(i.getByText("/work/acme")).toBeTruthy();
    expect(i.getByText("claude-code")).toBeTruthy();
    expect(i.getByText("Agent", { selector: "dt" })).toBeTruthy();
    expect(i.getByText("3 times")).toBeTruthy();
    expect(i.getByText(/2026|Oct/)).toBeTruthy();
    expect(s.getByText("1 time")).toBeTruthy();
    expect(s.getAllByRole("button", { name: /^Revoke rule/ })).toHaveLength(2);
  });

  it("says so when there are none", async () => {
    settings([]);
    expect((await section()).getByText("No agent approval rules are active.")).toBeTruthy();
  });

  it("revokes with DELETE and removes the rule", async () => {
    const m = settings([rule()]);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /^Revoke rule: Bash npm test \*/ }));
    await waitFor(() =>
      expect(m.api.calls.filter((c) => c.method === "DELETE")).toEqual([
        { method: "DELETE", path: "/api/agent-approvals/rules/rule_1", body: {} },
      ]),
    );
    await waitFor(() => expect(s.queryByRole("listitem")).toBeNull());
    expect((await s.findByRole("status")).textContent).toContain("Revoked");
  });

  it("re-reads when a rule changes elsewhere", async () => {
    const m = settings([rule()]);
    const s = await section();
    await s.findByRole("listitem");
    m.set([]);
    sendEvent(m.ws, 1, "agent.approval.rule.changed");
    await waitFor(() => expect(s.queryByRole("listitem")).toBeNull());
  });

  it("shows a pattern containing markup as text", async () => {
    const { container } = settings([rule({ pattern: XSS })]);
    await (await section()).findByRole("listitem");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(XSS);
  });
});
