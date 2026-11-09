// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseApprovalLink } from "../src/core/approval-link";
import type { AgentApproval } from "../src/core/types";
import { confirmation } from "./harness";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();
const H = "0123456789abcdef".repeat(4);
const M = "fedcba9876543210".repeat(4);
const NOT_FOUND = "Approval request not found.";

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.location.hash = "";
});

const agent = (patch: Partial<AgentApproval> = {}): AgentApproval => ({
  id: "apr_a1",
  kind: "permission",
  agent: "claude-code",
  project: "/work/acme",
  tool: "Bash",
  input_summary: { command: "npm test" },
  expires_at: inSeconds(90),
  always_ok: true,
  ...patch,
});
const conf = (id = "conf_1") =>
  confirmation({ id, summary: "Mock: write a note", expiresAt: inSeconds(90) });

const teamsHash = (over: Record<string, string> = {}) => {
  const q = new URLSearchParams({
    s: "agent",
    i: "apr_a1",
    h: H,
    e: "1790000000000",
    m: M,
    ...over,
  });
  return `#/approvals?${q.toString()}`;
};

describe("parseApprovalLink", () => {
  it("accepts only the id form and the five-field Teams form", () => {
    expect(parseApprovalLink("/approvals?id=apr_a1")).toEqual({ kind: "id", id: "apr_a1" });
    expect(parseApprovalLink(teamsHash().slice(1))).toMatchObject({ kind: "teams" });
    for (const bad of [
      "/approvals",
      "/approvals?",
      "/approvals?id=",
      "/approvals?id=a%20b",
      "/approvals?id=a/b",
      `/approvals?id=${"a".repeat(65)}`,
      "/approvals?id=apr_1&id=apr_2",
      "/approvals?id=apr_1&x=1",
      "/approvals/x?id=apr_1",
      teamsHash({ s: "other" }).slice(1),
      teamsHash({ h: "ab" }).slice(1),
      teamsHash({ e: "-1" }).slice(1),
      teamsHash({ m: M.toUpperCase() }).slice(1),
      `${teamsHash().slice(1)}&x=1`,
    ])
      expect(parseApprovalLink(bad), bad).toBeNull();
  });
});

describe("the approvals link page", () => {
  it("shows an agent approval only because Core lists it as pending", async () => {
    const { api } = openAt("#/approvals?id=apr_a1", {
      "GET /api/agent-approvals": () => ({ approvals: [agent(), agent({ id: "apr_other" })] }),
    });
    expect(await screen.findByText("claude-code wants to use Bash")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(api.calls.some((c) => c.method === "GET" && c.path === "/api/agent-approvals")).toBe(
      true,
    );
    expect(api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("shows a Phoenix confirmation the same way", async () => {
    openAt("#/approvals?id=conf_1", {
      "GET /api/confirmations": () => ({ confirmations: [conf(), conf("conf_2")] }),
    });
    expect(await screen.findByText("Mock: write a note")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says plainly not found for an unknown id and shows no other approval", async () => {
    openAt("#/approvals?id=apr_nope", {
      "GET /api/agent-approvals": () => ({ approvals: [agent()] }),
      "GET /api/confirmations": () => ({ confirmations: [conf()] }),
    });
    expect((await screen.findByText(NOT_FOUND)).textContent).toBe(NOT_FOUND);
    expect(screen.queryByText("claude-code wants to use Bash")).toBeNull();
    expect(screen.queryByText("Mock: write a note")).toBeNull();
  });

  it("says not found for an approval that has already expired", async () => {
    openAt("#/approvals?id=apr_a1", {
      "GET /api/agent-approvals": () => ({ approvals: [agent({ expires_at: inSeconds(-5) })] }),
    });
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
  });

  it("says not found for a malformed id without asking Core about it", async () => {
    const { api } = openAt("#/approvals?id=bad%20id");
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(api.calls.some((c) => c.path.startsWith("/api/agent-approvals?"))).toBe(false);
    expect(api.calls.some((c) => c.path === "/api/chat-approvals/teams/verify-link")).toBe(false);
  });

  it("says Core could not be reached rather than not found when the lists fail", async () => {
    openAt("#/approvals?id=apr_a1", {
      "GET /api/agent-approvals": () => new Response("{}", { status: 500 }),
    });
    expect(
      await screen.findByText("Phoenix Core could not be reached to check the link."),
    ).toBeTruthy();
  });
});

describe("a Teams link", () => {
  it("is sent to Core for verification and shown only when Core names a pending approval", async () => {
    const { api } = openAt(teamsHash(), {
      "POST /api/chat-approvals/teams/verify-link": () => ({ valid: true, approval_id: "apr_a1" }),
      "GET /api/agent-approvals": () => ({ approvals: [agent()] }),
    });
    expect(await screen.findByText("claude-code wants to use Bash")).toBeTruthy();
    const post = api.calls.find((c) => c.path === "/api/chat-approvals/teams/verify-link")!;
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({ query: `s=agent&i=apr_a1&h=${H}&e=1790000000000&m=${M}` });
  });

  it("shows only not found when Core says the link is not valid, even if the id is pending", async () => {
    const { api } = openAt(teamsHash(), {
      "POST /api/chat-approvals/teams/verify-link": () => ({ valid: false, approval_id: null }),
      "GET /api/agent-approvals": () => ({ approvals: [agent()] }),
    });
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.queryByText("claude-code wants to use Bash")).toBeNull();
    // Nothing is even listed for a link Core refused.
    expect(api.calls.some((c) => c.path === "/api/agent-approvals")).toBe(false);
  });

  it("uses Core's approval id, not the one written in the link", async () => {
    openAt(teamsHash({ i: "apr_other" }), {
      "POST /api/chat-approvals/teams/verify-link": () => ({ valid: true, approval_id: "apr_a1" }),
      "GET /api/agent-approvals": () => ({
        approvals: [agent(), agent({ id: "apr_other", tool: "Edit" })],
      }),
    });
    expect(await screen.findByText("claude-code wants to use Bash")).toBeTruthy();
    expect(screen.queryByText("claude-code wants to use Edit")).toBeNull();
  });

  it("says not found when Core is valid but the approval is no longer pending", async () => {
    openAt(teamsHash(), {
      "POST /api/chat-approvals/teams/verify-link": () => ({ valid: true, approval_id: "apr_a1" }),
    });
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
  });

  it("does not call Core for a link of the wrong shape", async () => {
    const { api } = openAt(teamsHash({ m: "abc" }));
    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(false));
  });
});
