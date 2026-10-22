// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isValidScope,
  sameGrants,
  type McpClient,
  type McpGrants,
  type McpStatus,
} from "../src/core/mcp";
import type { FakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { openAt } from "./views-harness";

beforeEach(() => {
  FakeWebSocket.reset();
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

const NONE: McpGrants = { tools: [], memory: [], request_approval: false, notify: false };
const off = (patch: Partial<McpStatus> = {}): McpStatus => ({
  enabled: false,
  listening: false,
  port: 47822,
  url: null,
  kill_switch: false,
  clients: 0,
  unavailable: false,
  ...patch,
});
const client = (patch: Partial<McpClient> = {}): McpClient => ({
  id: "mcp_aaaaaaaaaaaa",
  name: "Cursor",
  grants: NONE,
  created_at: "2026-10-01T09:00:00Z",
  last_used_at: null,
  revoked_at: null,
  ...patch,
});
const TOKEN = ["pmcp", "_", "T".repeat(43)].join("");

interface World {
  status: McpStatus;
  clients: McpClient[];
}

function open(initial: McpStatus, clients: McpClient[] = []) {
  const world: World = { status: initial, clients };
  const view = openAt("#/settings", {
    "GET /api/mcp/status": () => world.status,
    "GET /api/mcp/clients": () => ({ clients: world.clients }),
    "POST /api/mcp/settings": (body) => {
      const patch = body as { enabled?: boolean; port?: number };
      world.status = {
        ...world.status,
        ...(patch.port === undefined ? {} : { port: patch.port }),
        ...(patch.enabled === undefined
          ? {}
          : {
              enabled: patch.enabled,
              listening: patch.enabled,
              url: patch.enabled ? `http://127.0.0.1:${world.status.port}/mcp` : null,
            }),
      };
      return world.status;
    },
    "POST /api/mcp/clients": (body) => {
      const made = client({ id: "mcp_bbbbbbbbbbbb", name: (body as { name: string }).name });
      world.clients = [made, ...world.clients];
      world.status = { ...world.status, clients: world.status.clients + 1 };
      return { client: made, token: TOKEN };
    },
    "POST /api/mcp/clients/*": (body) => {
      world.clients = world.clients.map((c, i) =>
        i === 0 ? { ...c, grants: body as McpGrants } : c,
      );
      return world.clients[0];
    },
    "DELETE /api/mcp/clients/*": () => {
      world.clients = world.clients.map((c) => ({ ...c, revoked_at: "2026-10-20T10:00:00Z" }));
      return { id: "x", revoked: true };
    },
  });
  return { ...view, world };
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Phoenix MCP server" })).closest("section")!);
const posts = (api: FakeApi, prefix: string) =>
  api.calls.filter((c) => c.method === "POST" && c.path.startsWith(prefix));

describe("MCP clients: off by default", () => {
  it("shows the local-only warning, an unchecked switch and the empty client list", async () => {
    open(off());
    const s = await section();
    expect(await s.findByText(/127\.0\.0\.1/)).toBeTruthy();
    const toggle = await s.findByRole("checkbox", {
      name: /Allow MCP clients on this computer to connect/,
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(await s.findByText("No clients yet.")).toBeTruthy();
    expect(s.queryByText("Address")).toBeNull();
  });

  it("turning it on posts enabled:true and shows the address; turning it off posts false", async () => {
    const { api } = open(off());
    const s = await section();
    const toggle = await s.findByRole("checkbox", { name: /Allow MCP clients/ });
    fireEvent.click(toggle);
    expect(await s.findByText("http://127.0.0.1:47822/mcp")).toBeTruthy();
    expect(posts(api, "/api/mcp/settings")[0]!.body).toEqual({ enabled: true });
    fireEvent.click(await s.findByRole("checkbox", { name: /Allow MCP clients/ }));
    await waitFor(() =>
      expect(posts(api, "/api/mcp/settings")[1]!.body).toEqual({ enabled: false }),
    );
  });

  it("says the emergency stop closed it", async () => {
    open(off({ kill_switch: true, enabled: false }));
    expect(await (await section()).findByText(/emergency stop is on/i)).toBeTruthy();
  });
});

describe("MCP clients: token shown once", () => {
  it("creates a client, shows its token with a copy button, and forgets it when dismissed", async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    const { api } = open(
      off({ enabled: true, listening: true, url: "http://127.0.0.1:47822/mcp" }),
    );
    const s = await section();
    fireEvent.change(await s.findByLabelText("Client name"), { target: { value: "Cursor" } });
    fireEvent.click(s.getByRole("button", { name: "Create client" }));
    expect((await s.findByLabelText("Client token")).textContent).toBe(TOKEN);
    expect(posts(api, "/api/mcp/clients")[0]!.body).toEqual({ name: "Cursor" });
    expect(await s.findByText(/no grants yet/)).toBeTruthy();

    fireEvent.click(s.getByRole("button", { name: "Copy token" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(TOKEN));

    fireEvent.click(s.getByRole("button", { name: "I have saved it" }));
    await waitFor(() => expect(s.queryByLabelText("Client token")).toBeNull());
    expect(document.body.textContent).not.toContain(TOKEN);
    // A later list read never returns it again.
    const listed = api.calls.filter((c) => c.method === "GET" && c.path === "/api/mcp/clients");
    expect(listed.length).toBeGreaterThan(0);
  });

  it("says so when copying fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    open(off({ enabled: true, listening: true, url: "http://127.0.0.1:47822/mcp" }));
    const s = await section();
    fireEvent.change(await s.findByLabelText("Client name"), { target: { value: "Codex" } });
    fireEvent.click(s.getByRole("button", { name: "Create client" }));
    fireEvent.click(await s.findByRole("button", { name: "Copy token" }));
    expect(await s.findByText(/Could not copy/)).toBeTruthy();
  });
});

describe("MCP clients: grants and revoke", () => {
  const on = off({ enabled: true, listening: true, url: "http://127.0.0.1:47822/mcp", clients: 1 });

  it("a client with no grants says so, and saving is disabled until something changes", async () => {
    open(on, [client()]);
    const s = await section();
    expect(
      await s.findByText(/No grants: this client can connect but is refused everything/),
    ).toBeTruthy();
    expect((s.getByRole("button", { name: "Save grants" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows each client's id, so an approval card that names it can be matched to the client", async () => {
    open(on, [client(), client({ id: "mcp_bbbbbbbbbbbb", name: "Codex" })]);
    const s = await section();
    expect(await s.findByText(/Client ID mcp_aaaaaaaaaaaa/)).toBeTruthy();
    expect(s.getByText(/Client ID mcp_bbbbbbbbbbbb/)).toBeTruthy();
  });

  it("saves ticked tools and the two action grants as exactly what Core stores", async () => {
    const { api } = open(on, [client()]);
    const s = await section();
    fireEvent.click(await s.findByRole("checkbox", { name: "Recent agent sessions" }));
    fireEvent.click(s.getByRole("checkbox", { name: "Ask me for approval" }));
    fireEvent.click(s.getByRole("checkbox", { name: /Tell Fawkes its state/ }));
    fireEvent.click(s.getByRole("button", { name: "Save grants" }));
    await waitFor(() =>
      expect(posts(api, "/api/mcp/clients/mcp_aaaaaaaaaaaa/grants")).toHaveLength(1),
    );
    expect(posts(api, "/api/mcp/clients/mcp_aaaaaaaaaaaa/grants")[0]!.body).toEqual({
      tools: ["phoenix_activity"],
      memory: [],
      request_approval: true,
      notify: true,
    });
    expect(await s.findByText("Grants saved.")).toBeTruthy();
  });

  it("adds a memory scope with its sensitivity, refuses a malformed one, and removes one", async () => {
    const { api } = open(on, [client()]);
    const s = await section();
    const scope = await s.findByLabelText("Scope");
    fireEvent.change(scope, { target: { value: "../etc/passwd" } });
    expect(await s.findByText(/A scope is \*, global/)).toBeTruthy();
    expect((s.getByRole("button", { name: "Add scope" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(scope, { target: { value: "repo:phoenix*" } });
    fireEvent.change(s.getByLabelText("Highest sensitivity"), { target: { value: "public" } });
    fireEvent.click(s.getByRole("button", { name: "Add scope" }));
    expect(await s.findByText("repo:phoenix*")).toBeTruthy();
    fireEvent.click(s.getByRole("button", { name: "Save grants" }));
    await waitFor(() =>
      expect(posts(api, "/api/mcp/clients/mcp_aaaaaaaaaaaa/grants")).toHaveLength(1),
    );
    expect(posts(api, "/api/mcp/clients/mcp_aaaaaaaaaaaa/grants")[0]!.body).toMatchObject({
      memory: [{ scope: "repo:phoenix*", max_sensitivity: "public" }],
    });

    fireEvent.click(await s.findByRole("button", { name: "Remove scope repo:phoenix*" }));
    expect(await s.findByText("No memory scope granted.")).toBeTruthy();
  });

  it("revoking asks first, then revokes and shows the client as revoked with no grant controls", async () => {
    const { api } = open(on, [
      client({ last_used_at: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: "Revoke Cursor" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(await s.findByRole("button", { name: "Keep" }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(await s.findByRole("button", { name: "Revoke Cursor" }));
    fireEvent.click(await s.findByRole("button", { name: "Yes, revoke" }));
    expect(await s.findByText(/^Revoked /)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/api/mcp/clients/mcp_aaaaaaaaaaaa",
    ]);
    expect(s.queryByRole("button", { name: "Save grants" })).toBeNull();
    expect(s.queryByRole("button", { name: "Revoke Cursor" })).toBeNull();
  });

  it("shows a hostile client name as text, not markup", async () => {
    open(on, [client({ name: '<img src=x onerror="alert(1)">' })]);
    const s = await section();
    expect(await s.findByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("MCP helpers", () => {
  it("accepts the scope shapes Core accepts and refuses the rest", () => {
    for (const ok of [
      "*",
      "global",
      "repo:phoenix",
      "repo:*",
      "path:/Users/me/proj/*",
      "meeting:kage:1",
    ])
      expect(isValidScope(ok), ok).toBe(true);
    for (const bad of [
      "",
      "repo",
      "owner",
      "repo:a*b",
      "../x",
      "repo:a\nb",
      "repo:\u202Ea",
      "REPO:x",
    ])
      expect(isValidScope(bad), bad).toBe(false);
  });

  it("compares grants by meaning, not by tool order", () => {
    const a: McpGrants = { ...NONE, tools: ["phoenix_activity", "phoenix_meetings"] };
    expect(sameGrants(a, { ...a, tools: ["phoenix_meetings", "phoenix_activity"] })).toBe(true);
    expect(sameGrants(a, { ...a, notify: true })).toBe(false);
    expect(sameGrants(a, { ...a, tools: ["phoenix_activity"] })).toBe(false);
  });
});
