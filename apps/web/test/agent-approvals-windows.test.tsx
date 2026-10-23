// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import type { AgentApproval } from "../src/core/types";
import { FloatingApp } from "../src/floating/FloatingApp";
import type { DesktopShell } from "../src/floating/shell";
import { IslandApp } from "../src/island/IslandApp";
import type { IslandFrame, IslandShell } from "../src/island/shell";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { sendEvent } from "./harness";
import { XSS } from "./views-harness";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const approval = (patch: Partial<AgentApproval> = {}): AgentApproval => ({
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

const TITLE = "claude-code wants to use Bash";

const desktopShell: DesktopShell = {
  connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
  moveBy: () => {},
  dragEnded: () => {},
  openInPhoenix: () => {},
  showMenu: () => {},
};

const islandShell = (state: IslandFrame["state"]): IslandShell => ({
  connection: async () => ({ base_url: "http://127.0.0.1:4870", token: "tok" }),
  frame: async () => ({
    state,
    pointer: "poll",
    layout: { rect: { x: 0, y: 0, w: 360, h: 176 }, notch_width: 0, has_notch: false },
  }),
  onFrame: async () => () => {},
  send: () => {},
  openInPhoenix: () => {},
  showMenu: () => {},
});

interface Posted {
  id: string;
  body: unknown;
}

/**
 * One window against a fake Core whose pending list changes when a decision is posted, like the
 * real one. `list` answers GET /api/agent-approvals (a Response simulates a Core without it; a plain object replaces the pending list).
 */
async function open(
  window: "floating" | "island",
  initial: AgentApproval[],
  list?: () => Response | { approvals: AgentApproval[] } | undefined,
  frame: IslandFrame["state"] = "expanded",
) {
  let pending = initial;
  const posted: Posted[] = [];
  const api = fakeApi({
    "GET /api/pet/settings": () => ({ reduced_motion: "auto" }),
    "GET /api/agent-approvals": () => list?.() ?? { approvals: pending },
  });
  for (const a of initial) {
    api.set(`POST /api/agent-approvals/${a.id}/decision`, (body) => {
      posted.push({ id: a.id, body });
      pending = pending.filter((p) => p.id !== a.id);
      return { id: a.id, outcome: "decided" };
    });
  }
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    minReconnectMs: 3_600_000,
    maxReconnectMs: 3_600_000,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      {window === "floating" ? (
        <FloatingApp shell={desktopShell} />
      ) : (
        <IslandApp shell={islandShell(frame)} />
      )}
    </CoreProvider>,
  );
  const ws = FakeWebSocket.last;
  act(() => ws.open());
  act(() =>
    ws.message("state.changed", {
      state: "WAITING",
      explanation: "Waiting for you",
      recording: false,
      since: "",
    }),
  );
  await act(async () => {});
  return {
    api,
    ws,
    posted,
    /** What another client (a second window, the CLI) did: it resolved the request. */
    resolvedElsewhere: (id: string) => {
      pending = pending.filter((p) => p.id !== id);
      sendEvent(ws, 1, "agent.approval.resolved", { id });
    },
  };
}

const card = () => screen.findByRole("listitem", { name: TITLE });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe.each(["floating", "island"] as const)("agent approval card in the %s window", (window) => {
  it("shows the pending request next to Fawkes without hiding her state", async () => {
    await open(window, [approval()]);
    const c = within(await card());
    expect(c.getByText("claude-code", { selector: "dd" })).toBeTruthy();
    expect(c.getByText("/work/acme")).toBeTruthy();
    expect(c.getByText("npm test").tagName).toBe("CODE");
    expect(c.getByText("1:30")).toBeTruthy();
    const fawkes = screen.getByRole("button", { name: /^Fawkes/ });
    expect(fawkes.getAttribute("data-state")).toBe("WAITING");
    expect(document.querySelector(".agent-approvals-compact")).not.toBeNull();
  });

  it("renders hostile text as text and escapes hidden characters", async () => {
    await open(window, [
      approval({
        project: `/work/${XSS}`,
        input_summary: { command: `${XSS} rm\u200b -rf /`, path: XSS },
      }),
    ]);
    const c = await card();
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.textContent).toContain(`/work/${XSS}`);
    expect(c.textContent).toContain("rm\\u{200b} -rf /");
    expect(c.textContent).not.toContain("\u200b");
    expect(within(c).getByRole("note").textContent).toContain("contains non-ASCII characters");
  });

  it("Allow posts the same request the Pet Panel does and the card clears", async () => {
    const { posted, api } = await open(window, [approval()]);
    await card();
    press(`Allow: ${TITLE}`);
    await waitFor(() => expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "allow" } }]));
    expect(api.calls.filter((c) => c.method === "POST")).toEqual([
      { method: "POST", path: "/api/agent-approvals/apr_a1/decision", body: { behavior: "allow" } },
    ]);
    await waitFor(() => expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull());
    expect(
      (await screen.findByRole("status", { name: "Agent approval results" })).textContent,
    ).toBe(`Allowed: ${TITLE}.`);
  });

  it("Deny posts {behavior:'deny'}", async () => {
    const { posted } = await open(window, [approval()]);
    await card();
    press(`Deny: ${TITLE}`);
    await waitFor(() => expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "deny" } }]));
  });

  it("Always allow keeps its one-hour rule body and stays gated by always_ok", async () => {
    const { posted } = await open(window, [approval()]);
    await card();
    press(`Always allow here (1 h): ${TITLE}`);
    await waitFor(() =>
      expect(posted).toEqual([
        { id: "apr_a1", body: { behavior: "allow", always: { ttl_minutes: 60 } } },
      ]),
    );
    cleanup();
    FakeWebSocket.reset();
    await open(window, [approval({ always_ok: false })]);
    const c = await card();
    expect(within(c).queryByRole("button", { name: /Always allow/ })).toBeNull();
    expect(within(c).getByRole("button", { name: /^Allow:/ })).toBeTruthy();
  });

  it("Reply in terminal posts {behavior:'deny', terminal:true}", async () => {
    const { posted } = await open(window, [approval()]);
    await card();
    press(`Reply in terminal: ${TITLE}`);
    await waitFor(() =>
      expect(posted).toEqual([{ id: "apr_a1", body: { behavior: "deny", terminal: true } }]),
    );
  });

  it("clears when another window or client resolves the request", async () => {
    const m = await open(window, [approval()]);
    await card();
    m.resolvedElsewhere("apr_a1");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull());
    expect(m.posted).toEqual([]);
  });

  it("shows a card for a request raised while the window is open", async () => {
    let pending: AgentApproval[] = [];
    const m = await open(window, [], () => ({ approvals: pending }));
    expect(screen.queryByRole("listitem", { name: TITLE })).toBeNull();
    pending = [approval()];
    sendEvent(m.ws, 2, "agent.approval.requested", { id: "apr_a1" });
    await card();
  });

  it("renders nothing when no request is waiting", async () => {
    await open(window, []);
    expect(document.querySelector(".agent-approvals-compact")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders nothing when Core has no agent approvals (404)", async () => {
    await open(window, [approval()], () => {
      return new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
        status: 404,
      });
    });
    await act(async () => {});
    expect(document.querySelector(".agent-approvals-compact")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("agent approval card in the island", () => {
  it("is not drawn while the island is collapsed", async () => {
    await open("island", [approval()], undefined, "small");
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByRole("button", { name: /^Fawkes/ })).toBeTruthy();
  });

  it("keeps the open-in-Phoenix button beside the card", async () => {
    await open("island", [approval()]);
    await card();
    expect(screen.getByRole("button", { name: "Open in Phoenix" })).toBeTruthy();
  });
});
