// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapabilityView } from "../src/core/types";
import { FakeWebSocket } from "./fake-ws";
import { expectInert, openAt, XSS } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const ai: CapabilityView = {
  id: "research",
  name: "Research",
  version: "1.2.3",
  description: "Research assistant",
  kind: "external",
  status: "installed",
  health: { status: "unknown" },
  permissions: [{ permission: "network", description: "External requests", granted: false }],
  commands: [],
  data_categories: ["project_notes", "meeting_transcripts"],
  context_sources: [
    {
      name: "Project index",
      description: "Reads indexed notes",
      data_access: [{ category: "project_notes", sensitivity: "internal" }],
      permissions: ["memory.read"],
      provider: { locality: "local", provider: "On-device index" },
    },
  ],
  ai_tools: [
    {
      name: "Cloud model",
      description: "Answers questions remotely",
      command: "ask",
      kind: "model_provider",
      data_access: [{ category: "meeting_transcripts", sensitivity: "sensitive" }],
      permissions: ["network"],
      provider: { locality: "cloud", provider: "Example AI" },
    },
  ],
};

const enablePath = "/api/capabilities/research/enable";
const disablePath = "/api/capabilities/research/disable";

async function panel() {
  const summary = await screen.findByText("Research", { selector: "strong" });
  return within(summary.closest("details")!);
}

describe("AI capability activation disclosure", () => {
  it("shows the complete manifest disclosure before allowing explicit version acknowledgment and enable", async () => {
    const { api } = openAt("#/settings", {
      "GET /api/capabilities": () => ({ capabilities: [ai] }),
    });
    const p = await panel();
    expect(p.queryByText("Cloud model")).toBeNull();
    fireEvent.click(p.getByRole("button", { name: "Enable Research" }));
    expect(api.posts(enablePath)).toHaveLength(0);
    const disclosure = within(
      await p.findByRole("region", { name: "AI activation disclosure for Research" }),
    );
    expect(disclosure.getByRole("heading", { name: /Review AI access/ })).toBeTruthy();
    // Query the labelled section itself: every declared field must be visible prior to activation.
    const content = p.getByRole("region", {
      name: "AI activation disclosure for Research",
    }).textContent!;
    expect(content).toContain("1.2.3");
    expect(content).toContain("external");
    expect(content).toContain("project_notes");
    expect(content).toContain("meeting_transcripts");
    expect(content).toContain("network: External requests");
    expect(content).toContain("Project index");
    expect(content).toContain("Reads indexed notes");
    expect(content).toContain("memory.read");
    expect(content).toContain("internal");
    expect(content).toContain("On-device index; locality: local");
    expect(content).toContain("Cloud model");
    expect(content).toContain("Answers questions remotely");
    expect(content).toContain("model_provider; command: ask");
    expect(content).toContain("Example AI; locality: external/cloud");
    expect(content).toContain("sensitive");
    const confirm = disclosure.getByRole("button", {
      name: "Confirm enable for version 1.2.3",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(api.posts(enablePath)).toHaveLength(0);
    fireEvent.click(disclosure.getByRole("checkbox", { name: /manifest version 1\.2\.3/ }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.posts(enablePath)).toHaveLength(1));
    expect(api.posts(enablePath)[0]?.body).toEqual({ manifest_version: "1.2.3" });
  });

  it("invalidates an acknowledged disclosure when Core reports a different version", async () => {
    let current: CapabilityView = ai;
    const { api, ws } = openAt("#/settings", {
      "GET /api/capabilities": () => ({ capabilities: [current] }),
    });
    const p = await panel();
    fireEvent.click(p.getByRole("button", { name: "Enable Research" }));
    fireEvent.click(p.getByRole("checkbox", { name: /manifest version 1\.2\.3/ }));
    expect(
      (p.getByRole("button", { name: "Confirm enable for version 1.2.3" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    current = { ...ai, version: "2.0.0" };
    ws.message("capability.health", { event_type: "capability.updated" });
    await waitFor(() =>
      expect(p.queryByRole("button", { name: "Confirm enable for version 1.2.3" })).toBeNull(),
    );
    expect(api.posts(enablePath)).toHaveLength(0);
    fireEvent.click(p.getByRole("button", { name: "Enable Research" }));
    expect(
      (p.getByRole("button", { name: "Confirm enable for version 2.0.0" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(api.posts(enablePath)).toHaveLength(0);
    fireEvent.click(p.getByRole("checkbox", { name: /manifest version 2\.0\.0/ }));
    fireEvent.click(p.getByRole("button", { name: "Confirm enable for version 2.0.0" }));
    await waitFor(() => expect(api.posts(enablePath)).toHaveLength(1));
    expect(api.posts(enablePath)[0]?.body).toEqual({ manifest_version: "2.0.0" });
  });

  it("requires a fresh review and acknowledgment for restart, never auto-enabling after disable", async () => {
    const enabled = { ...ai, status: "enabled" as const };
    const { api } = openAt("#/settings", {
      "GET /api/capabilities": () => ({ capabilities: [enabled] }),
    });
    const p = await panel();
    fireEvent.click(p.getByRole("button", { name: "Restart" }));
    expect(api.posts(disablePath)).toHaveLength(0);
    expect(api.posts(enablePath)).toHaveLength(0);
    fireEvent.click(p.getByRole("button", { name: "Cancel" }));
    expect(api.posts(disablePath)).toHaveLength(0);
    fireEvent.click(p.getByRole("button", { name: "Restart" }));
    expect(
      (p.getByRole("button", { name: "Confirm restart for version 1.2.3" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(p.getByRole("checkbox", { name: /manifest version 1\.2\.3/ }));
    fireEvent.click(p.getByRole("button", { name: "Confirm restart for version 1.2.3" }));
    await waitFor(() => expect(api.posts(enablePath)).toHaveLength(1));
    expect(api.posts(disablePath)).toHaveLength(1);
    expect(api.posts(enablePath)[0]?.body).toEqual({ manifest_version: "1.2.3" });
  });

  it("retains the ordinary non-AI one-click enable body", async () => {
    const { api } = openAt("#/settings", {
      "GET /api/capabilities": () => ({
        capabilities: [{ ...ai, context_sources: [], ai_tools: [] }],
      }),
    });
    const p = await panel();
    fireEvent.click(p.getByRole("button", { name: "Enable Research" }));
    await waitFor(() => expect(api.posts(enablePath)).toHaveLength(1));
    expect(api.posts(enablePath)[0]?.body).toEqual({});
    expect(p.queryByRole("region", { name: /AI activation disclosure/ })).toBeNull();
  });

  it("renders untrusted AI metadata as inert text", async () => {
    const { container, api } = openAt("#/settings", {
      "GET /api/capabilities": () => ({
        capabilities: [{ ...ai, ai_tools: [{ ...ai.ai_tools[0], description: XSS }] }],
      }),
    });
    const p = await panel();
    fireEvent.click(p.getByRole("button", { name: "Enable Research" }));
    expectInert(container);
    expect(api.posts(enablePath)).toHaveLength(0);
  });
});
