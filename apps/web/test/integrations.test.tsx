// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { AgentSession, FrappeSite } from "../src/core/types";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => cleanup());

const capability = (id: string, status: "enabled" | "installed") => ({
  id,
  name: id,
  version: "0.1.0",
  description: id,
  kind: "builtin",
  status,
  health: { status: "healthy" },
  permissions: [],
  commands: [],
  data_categories: [],
});

/** Fakes a capability command: POST starts operation `op-<id>`, GET returns its result. */
function command(id: string, command: string, result: () => unknown) {
  return {
    [`POST /api/capabilities/${id}/commands/${command}`]: () => ({ id: `op-${id}` }),
    [`GET /api/operations/op-${id}`]: () => ({ status: "succeeded", result: result() }),
  };
}

function open(routes: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(routes);
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <App />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  fireEvent.click(screen.getByRole("button", { name: /^Fawkes/ }));
  return { api, ws: FakeWebSocket.last };
}

const agent = (over: Partial<AgentSession> = {}): AgentSession => ({
  agent: "claude-code",
  agent_id: "s1",
  workspace: "/work/phoenix",
  repository: "phoenix",
  state: "working",
  since: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

const site = (over: Partial<FrappeSite> = {}): FrappeSite => ({
  site: "shop.local",
  bench: "/work/bench",
  url: "http://127.0.0.1:8000",
  status: "healthy",
  consecutive_failures: 0,
  response_ms: 42,
  apps: ["frappe"],
  ...over,
});

describe("Coding agents in the Pet Panel", () => {
  it("is absent, and calls nothing, while the capability is off", async () => {
    const { api } = open({
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "installed")] }),
    });
    await screen.findByRole("heading", { name: "Active tasks" });
    expect(screen.queryByRole("heading", { name: "Coding agents" })).toBeNull();
    expect(api.calls.some((c) => c.path.includes("/commands/"))).toBe(false);
  });

  it("lists agents, says in words when one needs input, and refreshes on agent events", async () => {
    let agents = [agent({ state: "waiting", reason: "permission", task: undefined })];
    const { ws } = open({
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "enabled")] }),
      ...command("agents", "list", () => ({ agents })),
    });
    const section = (await screen.findByRole("heading", { name: "Coding agents" })).closest(
      "section",
    )!;
    await waitFor(() =>
      expect(within(section).getByText(/Needs your input \(permission\)/)).toBeTruthy(),
    );
    expect(within(section).getByText("claude-code")).toBeTruthy();

    agents = [agent({ state: "working" })];
    act(() =>
      ws.message("event.created", {
        seq: 9,
        event: {
          event_id: "evt_x",
          event_type: "agent.working",
          source: "agents",
          severity: "info",
          version: "1.1",
          timestamp: new Date().toISOString(),
          payload: {},
        },
      }),
    );
    await waitFor(() => expect(within(section).getByText(/Working/)).toBeTruthy());
    expect(within(section).queryByText(/Needs your input/)).toBeNull();
  });

  it("says plainly when no agent has reported", async () => {
    open({
      "GET /api/capabilities": () => ({ capabilities: [capability("agents", "enabled")] }),
      ...command("agents", "list", () => ({ agents: [] })),
    });
    expect(await screen.findByText("No coding agent has reported yet.")).toBeTruthy();
  });
});

describe("Frappe sites in the Pet Panel", () => {
  it("shows an unreachable site with its error and when it was last healthy", async () => {
    open({
      "GET /api/capabilities": () => ({ capabilities: [capability("frappe", "enabled")] }),
      ...command("frappe", "sites", () => ({
        sites: [
          site(),
          site({
            site: "erp.local",
            status: "unhealthy",
            error: "No answer from the site",
            last_ok_at: new Date(Date.now() - 5 * 60_000).toISOString(),
            response_ms: undefined,
          }),
        ],
      })),
    });
    const section = (await screen.findByRole("heading", { name: "Frappe sites" })).closest(
      "section",
    )!;
    await waitFor(() => expect(within(section).getByText("erp.local")).toBeTruthy());
    expect(within(section).getByText(/Not responding/)).toBeTruthy();
    expect(within(section).getByText("No answer from the site")).toBeTruthy();
    expect(within(section).getByText(/Last healthy 5 min ago/)).toBeTruthy();
    expect(within(section).getByText(/42 ms/)).toBeTruthy();
  });

  it("is absent while Frappe is not enabled", async () => {
    open({
      "GET /api/capabilities": () => ({ capabilities: [capability("frappe", "installed")] }),
    });
    await screen.findByRole("heading", { name: "Active tasks" });
    expect(screen.queryByRole("heading", { name: "Frappe sites" })).toBeNull();
  });
});
