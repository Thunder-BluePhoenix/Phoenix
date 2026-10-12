// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWebSocket } from "./fake-ws";
import { capability, doubleClick, openAt, sendEvent } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const listPath = "/api/capabilities/agents/commands/session.list";
const disablePath = "/api/capabilities/agents/disable";
const enablePath = "/api/capabilities/agents/enable";
const session = (id: string, state: string) => ({ id, state });

function openAgents() {
  const { api, ws } = openAt("#/settings", {
    "GET /api/capabilities": () => ({ capabilities: [capability("agents", "enabled")] }),
    [`POST ${listPath}`]: () => ({ id: "check" }),
    "GET /api/operations/check": () => ({ status: "succeeded", result: { sessions: [] } }),
  });
  return { api, ws };
}

async function buttons() {
  const name = await screen.findByText("agents", { selector: "strong" });
  return within(name.closest("details")!);
}

describe("agent capability session stop acknowledgement", () => {
  it("disables idle agents without an acknowledgement", async () => {
    const { api } = openAgents();
    const panel = await buttons();
    fireEvent.click(panel.getByRole("button", { name: "Disable agents" }));
    await waitFor(() => expect(api.posts(disablePath)).toHaveLength(1));
    expect(api.posts(listPath)).toHaveLength(1);
    expect(panel.queryByRole("region", { name: "Agent session stop acknowledgement" })).toBeNull();
  });

  it("requires acknowledgement for running and waiting sessions, and checks again before restart", async () => {
    const { api } = openAgents();
    let sessions = [session("run-1", "running"), session("wait-2", "waiting")];
    api.set("GET /api/operations/check", () => ({ status: "succeeded", result: { sessions } }));
    const panel = await buttons();
    fireEvent.click(panel.getByRole("button", { name: "Restart" }));
    const review = await panel.findByRole("region", { name: "Agent session stop acknowledgement" });
    expect(review.textContent).toContain("run-1:running");
    expect(review.textContent).toContain("wait-2:waiting");
    expect(api.posts(disablePath)).toHaveLength(0);
    expect(
      (within(review).getByRole("button", { name: "Confirm restart" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(within(review).getByRole("checkbox"));
    fireEvent.click(within(review).getByRole("button", { name: "Confirm restart" }));
    await waitFor(() => expect(api.posts(enablePath)).toHaveLength(1));
    expect(api.posts(disablePath)).toHaveLength(1);
    expect(api.posts(listPath)).toHaveLength(2);
  });

  it("does not disable when an active-session review is cancelled", async () => {
    const { api } = openAgents();
    api.set("GET /api/operations/check", () => ({
      status: "succeeded",
      result: {
        sessions: [session("running-1", "running")],
      },
    }));
    const panel = await buttons();
    fireEvent.click(panel.getByRole("button", { name: "Disable agents" }));
    const review = await panel.findByRole("region", { name: "Agent session stop acknowledgement" });
    fireEvent.click(within(review).getByRole("button", { name: "Cancel" }));
    expect(api.posts(disablePath)).toHaveLength(0);
    expect(panel.queryByRole("region", { name: "Agent session stop acknowledgement" })).toBeNull();
  });

  it("prevents duplicate operations while the session check is pending", async () => {
    const { api } = openAgents();
    const { promise, resolve } = Promise.withResolvers<unknown>();
    api.set("GET /api/operations/check", () => promise);
    const panel = await buttons();
    doubleClick(() => fireEvent.click(panel.getByRole("button", { name: "Disable agents" })));
    await waitFor(() => expect(api.posts(listPath)).toHaveLength(1));
    expect(api.posts(disablePath)).toHaveLength(0);
    resolve({ status: "succeeded", result: { sessions: [] } });
    await waitFor(() => expect(api.posts(disablePath)).toHaveLength(1));
  });

  it("blocks disable or restart when session inspection fails", async () => {
    const { api } = openAgents();
    api.set("GET /api/operations/check", () => ({
      status: "failed",
      error: { message: "Session list unavailable" },
    }));
    const panel = await buttons();
    fireEvent.click(panel.getByRole("button", { name: "Disable agents" }));
    expect((await panel.findByRole("alert")).textContent).toContain("Session list unavailable");
    fireEvent.click(panel.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(api.posts(listPath)).toHaveLength(2));
    expect(api.posts(disablePath)).toHaveLength(0);
    expect(api.posts(enablePath)).toHaveLength(0);
  });

  it("invalidates acknowledgement when sessions change before confirmation", async () => {
    const { api } = openAgents();
    let sessions = [session("run-1", "running")];
    api.set("GET /api/operations/check", () => ({ status: "succeeded", result: { sessions } }));
    const panel = await buttons();
    fireEvent.click(panel.getByRole("button", { name: "Disable agents" }));
    const review = await panel.findByRole("region", { name: "Agent session stop acknowledgement" });
    fireEvent.click(within(review).getByRole("checkbox"));
    sessions = [session("run-1", "running"), session("wait-2", "waiting")];
    fireEvent.click(within(review).getByRole("button", { name: "Confirm disable" }));
    await waitFor(() => expect(review.textContent).toContain("wait-2:waiting"));
    expect((within(review).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(api.posts(disablePath)).toHaveLength(0);
  });

  it("invalidates review when the capability version changes", async () => {
    let version = "0.1.0";
    const { api, ws } = openAgents();
    api.set("GET /api/capabilities", () => ({
      capabilities: [{ ...capability("agents", "enabled"), version }],
    }));
    api.set("GET /api/operations/check", () => ({
      status: "succeeded",
      result: { sessions: [session("run-1", "running")] },
    }));
    const panel = await buttons();
    fireEvent.click(panel.getByRole("button", { name: "Disable agents" }));
    await panel.findByRole("region", { name: "Agent session stop acknowledgement" });
    version = "0.2.0";
    sendEvent(ws, 101, "capability.updated");
    await waitFor(() =>
      expect(
        panel.queryByRole("region", { name: "Agent session stop acknowledgement" }),
      ).toBeNull(),
    );
    expect(api.posts(disablePath)).toHaveLength(0);
  });
});
