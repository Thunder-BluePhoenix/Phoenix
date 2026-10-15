// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentInstallAction,
  AgentInstallView,
  InstallApplied,
  InstallPreview,
} from "../src/core/types";
import type { Call } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { sendEvent } from "./harness";
import { openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const agent = (patch: Partial<AgentInstallView> = {}): AgentInstallView => ({
  id: "claude",
  label: "Claude Code",
  support: "supported",
  doc_url: "https://example.com/claude",
  detected: true,
  detected_via: "settings directory",
  config_path: "/home/u/.claude/settings.json",
  state: "not_installed",
  missing: [],
  ...patch,
});

const previewOf = (
  action: AgentInstallAction,
  patch: Partial<InstallPreview> = {},
): InstallPreview => ({
  mode: "preview",
  action,
  agent: "claude",
  path: "/home/u/.claude/settings.json",
  changed: true,
  diff: "--- a\n+++ b\n+hook",
  hash: "hash_1",
  notes: [],
  ...patch,
});

const appliedOf = (
  action: AgentInstallAction,
  patch: Partial<InstallApplied> = {},
): InstallApplied => ({
  mode: "applied",
  action,
  agent: "claude",
  path: "/home/u/.claude/settings.json",
  changed: true,
  summary: "Done.",
  kept_user_edits: false,
  ...patch,
});

type Body = { agent: string; confirm_hash?: string };

/** Mounts Settings against a fake relay whose agent list can be swapped. */
function settings(
  initial: AgentInstallView[],
  opts: {
    preview?: (action: AgentInstallAction) => InstallPreview;
    apply?: (action: AgentInstallAction) => Response | InstallApplied;
    relay?: { running: boolean; version: number; platform: string; error?: string };
  } = {},
) {
  let agents = initial;
  const handle = (action: AgentInstallAction) => (body: unknown) => {
    const b = body as Body;
    if (b.confirm_hash) return (opts.apply ?? appliedOf)(action);
    return (opts.preview ?? previewOf)(action);
  };
  const m = openAt("#/settings", {
    "GET /api/agent-relay/agents": () => ({
      relay: opts.relay ?? { running: true, version: 3, platform: "darwin" },
      agents,
    }),
    "POST /api/agent-relay/install": handle("install"),
    "POST /api/agent-relay/uninstall": handle("uninstall"),
    "POST /api/agent-relay/repair": handle("repair"),
  });
  return { ...m, set: (next: AgentInstallView[]) => (agents = next) };
}

const section = async () =>
  within((await screen.findByRole("heading", { name: "Coding agents" })).closest("section")!);

const relayPosts = (m: { api: { calls: Call[] } }) =>
  m.api.calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/agent-relay/"));

describe("Settings: Coding agents", () => {
  it("shows relay status", async () => {
    settings([], { relay: { running: false, version: 3, platform: "darwin", error: "port busy" } });
    const s = await section();
    expect((await s.findByText(/not running/)).textContent).toContain("version 3");
    expect(s.getByText(/port busy/)).toBeTruthy();
  });

  it("lists detected, undetected and unsupported agents with the right buttons", async () => {
    settings([
      agent(),
      agent({ id: "gone", label: "Gone Agent", detected: false, detected_via: undefined }),
      agent({
        id: "old",
        label: "Old Agent",
        support: "unsupported",
        state: "unsupported",
        reason: "No hook system",
        doc_url: "https://example.com/old",
      }),
      agent({ id: "done", label: "Done Agent", state: "installed" }),
      agent({ id: "bad", label: "Bad Agent", state: "needs_repair", missing: ["PreToolUse"] }),
    ]);
    const s = await section();

    const claude = within(await s.findByRole("listitem", { name: "Claude Code" }));
    expect(claude.getByText(/^Detected/)).toBeTruthy();
    expect(claude.getByText("Not installed")).toBeTruthy();
    expect(claude.getByText("/home/u/.claude/settings.json").tagName).toBe("CODE");
    expect(claude.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Install Phoenix hooks for Claude Code",
    ]);

    const gone = within(s.getByRole("listitem", { name: "Gone Agent" }));
    expect(gone.getByText("Not detected")).toBeTruthy();
    expect(gone.getByText(/not found on this computer/i)).toBeTruthy();
    expect(gone.queryByRole("button")).toBeNull();

    const done = within(s.getByRole("listitem", { name: "Done Agent" }));
    expect(done.getByText("Installed")).toBeTruthy();
    expect(done.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Uninstall Phoenix hooks for Done Agent",
    ]);

    const bad = within(s.getByRole("listitem", { name: "Bad Agent" }));
    expect(bad.getByText(/Needs repair — missing: PreToolUse/)).toBeTruthy();
    expect(bad.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Repair Phoenix hooks for Bad Agent",
      "Uninstall Phoenix hooks for Bad Agent",
    ]);
  });

  it("shows an unsupported agent's reason and doc link and no buttons", async () => {
    settings([
      agent({
        id: "old",
        label: "Old Agent",
        support: "unsupported",
        state: "unsupported",
        reason: "No hook system",
        doc_url: "https://example.com/old",
      }),
    ]);
    const item = within(await (await section()).findByRole("listitem", { name: "Old Agent" }));
    expect(item.getByText(/Unsupported: No hook system/)).toBeTruthy();
    const link = item.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com/old");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(item.queryByRole("button")).toBeNull();
  });

  it("previews as text, confirms with the preview hash, then re-reads on agent.relay.changed", async () => {
    const m = settings([agent()], {
      preview: (a) => previewOf(a, { diff: `+${XSS}`, notes: ["Backs up first"] }),
      apply: (a) => appliedOf(a, { summary: "Installed hooks.", kept_user_edits: true }),
    });
    const s = await section();
    fireEvent.click(
      await s.findByRole("button", { name: "Install Phoenix hooks for Claude Code" }),
    );

    const region = within(await s.findByRole("region", { name: "Preview: install Claude Code" }));
    expect(region.getByText(`+${XSS}`).tagName).toBe("PRE");
    expect(m.container.querySelector("img")).toBeNull();
    expect(m.container.querySelector("script")).toBeNull();
    expect(region.getByText("Backs up first")).toBeTruthy();
    expect(relayPosts(m)).toEqual([
      { method: "POST", path: "/api/agent-relay/install", body: { agent: "claude" } },
    ]);

    m.set([agent({ state: "installed" })]);
    fireEvent.click(region.getByRole("button", { name: "Confirm install" }));
    await waitFor(() =>
      expect(relayPosts(m)[1]).toEqual({
        method: "POST",
        path: "/api/agent-relay/install",
        body: { agent: "claude", confirm_hash: "hash_1" },
      }),
    );
    const status = await s.findByRole("status");
    expect(status.textContent).toContain("Installed hooks.");
    expect(status.textContent).toContain("kept");
    expect(s.queryByRole("region")).toBeNull();

    sendEvent(m.ws, 1, "agent.relay.changed");
    expect(
      await s.findByRole("button", { name: "Uninstall Phoenix hooks for Claude Code" }),
    ).toBeTruthy();
  });

  it("says when nothing would change", async () => {
    settings([agent()], { preview: (a) => previewOf(a, { changed: false, diff: "" }) });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /^Install Phoenix hooks/ }));
    const region = within(await s.findByRole("region", { name: "Preview: install Claude Code" }));
    expect(region.getByText("No changes needed")).toBeTruthy();
  });

  it("sends nothing more on Cancel", async () => {
    const m = settings([agent()]);
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /^Install Phoenix hooks/ }));
    const region = within(await s.findByRole("region", { name: "Preview: install Claude Code" }));
    fireEvent.click(region.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(s.queryByRole("region")).toBeNull());
    expect(relayPosts(m)).toHaveLength(1);
    expect(s.queryByRole("status")).toBeNull();
  });

  it("tells the user on 409 and previews again", async () => {
    let hash = 0;
    const m = settings([agent()], {
      preview: (a) => previewOf(a, { hash: `hash_${++hash}` }),
      apply: () =>
        new Response(
          JSON.stringify({ code: "CONFLICT", message: "The file changed since the preview." }),
          {
            status: 409,
          },
        ),
    });
    const s = await section();
    fireEvent.click(await s.findByRole("button", { name: /^Install Phoenix hooks/ }));
    const region = within(await s.findByRole("region", { name: "Preview: install Claude Code" }));
    fireEvent.click(region.getByRole("button", { name: "Confirm install" }));

    expect((await s.findByRole("alert")).textContent).toContain(
      "The file changed since the preview.",
    );
    expect(region.queryByRole("button", { name: "Confirm install" })).toBeNull();
    fireEvent.click(region.getByRole("button", { name: "Preview again" }));
    await waitFor(() => expect(relayPosts(m)).toHaveLength(3));
    expect(relayPosts(m)[2]).toEqual({
      method: "POST",
      path: "/api/agent-relay/install",
      body: { agent: "claude" },
    });
    expect(await s.findByRole("button", { name: "Confirm install" })).toBeTruthy();
    expect(s.queryByRole("alert")).toBeNull();
  });

  it("repairs an agent with the preview hash", async () => {
    const m = settings([agent({ state: "needs_repair", missing: ["Stop"] })], {
      apply: (a) => appliedOf(a, { summary: "Repaired hooks." }),
    });
    const s = await section();
    expect(await s.findByText(/missing: Stop/)).toBeTruthy();
    fireEvent.click(s.getByRole("button", { name: "Repair Phoenix hooks for Claude Code" }));
    const region = within(await s.findByRole("region", { name: "Preview: repair Claude Code" }));
    fireEvent.click(region.getByRole("button", { name: "Confirm repair" }));
    expect((await s.findByRole("status")).textContent).toContain("Repaired hooks.");
    expect(relayPosts(m).map((c) => [c.path, c.body])).toEqual([
      ["/api/agent-relay/repair", { agent: "claude" }],
      ["/api/agent-relay/repair", { agent: "claude", confirm_hash: "hash_1" }],
    ]);
  });

  it("uninstalls an agent with the preview hash", async () => {
    const m = settings([agent({ state: "installed" })], {
      apply: (a) => appliedOf(a, { summary: "Removed hooks." }),
    });
    const s = await section();
    fireEvent.click(
      await s.findByRole("button", { name: "Uninstall Phoenix hooks for Claude Code" }),
    );
    const region = within(await s.findByRole("region", { name: "Preview: uninstall Claude Code" }));
    fireEvent.click(region.getByRole("button", { name: "Confirm uninstall" }));
    expect((await s.findByRole("status")).textContent).toContain("Removed hooks.");
    expect(relayPosts(m).map((c) => [c.path, c.body])).toEqual([
      ["/api/agent-relay/uninstall", { agent: "claude" }],
      ["/api/agent-relay/uninstall", { agent: "claude", confirm_hash: "hash_1" }],
    ]);
  });
});
