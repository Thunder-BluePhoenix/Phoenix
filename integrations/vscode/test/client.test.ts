// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The editor's Core client against a REAL in-process Phoenix Core (registration, per-capability
// token, enable/disable lifecycle callbacks, Fawkes state), not a mock of it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, TOKEN } from "../../../core/runtime/test/helpers";
import {
  buildManifest,
  createTaskTracker,
  diagnosticsChanged,
  workspaceOpened,
} from "../src/events.js";
import { createPhoenixClient } from "../src/phoenix-client.js";

type Client = ReturnType<typeof createPhoenixClient>;
let stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

async function setup(sessionToken: () => string = () => TOKEN) {
  const core = await startCore();
  stops.push(() => core.runtime.stop());
  const enabled: string[] = [];
  const client: Client = createPhoenixClient({
    coreUrl: core.base,
    manifest: buildManifest(),
    sessionToken,
    onEnable: () => void enabled.push("enable"),
    onDisable: () => void enabled.push("disable"),
  });
  stops.push(() => client.close());
  await client.listen();
  return { core, client, enabled };
}

const eventTypes = async (core: Awaited<ReturnType<typeof startCore>>) =>
  (
    (await core.api("GET", "/api/events?source=editor&limit=50")).json.events as {
      event: { event_type: string };
    }[]
  )
    .map((e) => e.event.event_type)
    .reverse();

describe("editor capability against Phoenix Core", () => {
  it("registers, shows up in the capability list with its permission, and sends nothing until the user enables it", async () => {
    const { core, client } = await setup();
    expect(await client.reconcile()).toBe(true);
    const view = (await core.api("GET", "/api/capabilities/editor")).json;
    expect(view).toMatchObject({
      id: "editor",
      kind: "external",
      status: "installed",
      permissions: [{ permission: "filesystem_read", granted: false }],
    });

    const early = await client.emit(workspaceOpened({ name: "phoenix" }));
    expect(early).toMatchObject({ sent: false, reason: expect.stringMatching(/not enabled/) });
    expect(await eventTypes(core)).toEqual([]);

    await core.api("POST", "/api/capabilities/editor/enable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(true));
    expect(await client.emit(workspaceOpened({ name: "phoenix" }))).toEqual({ sent: true });
    expect(await eventTypes(core)).toEqual(["editor.workspace.opened"]);
  });

  it("a failing task drives Fawkes to ERROR naming the task; the next pass clears it", async () => {
    const { core, client } = await setup();
    await client.reconcile();
    await core.api("POST", "/api/capabilities/editor/enable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(true));
    const tasks = createTaskTracker();

    const run1 = {};
    await client.emit(tasks.started(run1, { name: "build", source: "Workspace", type: "shell" }));
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/pet/state")).json).toMatchObject({
        state: "WORKING",
        explanation: "Task build running",
      }),
    );
    await client.emit(tasks.ended(run1, 2));
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/pet/state")).json).toMatchObject({
        state: "ERROR",
        explanation: "Task build failed",
      }),
    );

    const run2 = {};
    await client.emit(tasks.started(run2, { name: "build", source: "Workspace", type: "shell" }));
    await client.emit(tasks.ended(run2, 0));
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/pet/state")).json).toMatchObject({ state: "SUCCESS" }),
    );
    expect(await eventTypes(core)).toEqual([
      "editor.task.started",
      "editor.task.failed",
      "editor.task.started",
      "editor.task.passed",
    ]);
  });

  it("diagnostics counts are recorded but do not change Fawkes", async () => {
    const { core, client } = await setup();
    await client.reconcile();
    await core.api("POST", "/api/capabilities/editor/enable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(true));
    await client.emit(
      diagnosticsChanged({ errors: 12, warnings: 3, previousErrors: 0, previousWarnings: 0 }),
    );
    expect(await eventTypes(core)).toEqual(["editor.diagnostics.changed"]);
    expect((await core.api("GET", "/api/pet/state")).json.state).toBe("IDLE");
  });

  it("stops sending when the user disables it in Phoenix", async () => {
    const { core, client, enabled } = await setup();
    await client.reconcile();
    await core.api("POST", "/api/capabilities/editor/enable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(true));
    await core.api("POST", "/api/capabilities/editor/disable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(false));
    expect(enabled).toEqual(["enable", "disable"]);
    expect(await client.emit(workspaceOpened({ name: "x" }))).toMatchObject({ sent: false });
    expect(await eventTypes(core)).toEqual([]);
  });

  it("recovers from a real Core restart (same port, new tokens, empty state)", async () => {
    const first = await startCore();
    const client = createPhoenixClient({
      coreUrl: first.base,
      manifest: buildManifest(),
      sessionToken: () => TOKEN,
    });
    stops.push(() => client.close());
    await client.listen();
    await client.reconcile();
    await first.api("POST", "/api/capabilities/editor/enable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(true));
    expect(await client.emit(workspaceOpened({ name: "before" }))).toEqual({ sent: true });

    // Restart: the same address, but Core has forgotten the capability and its tokens.
    await first.runtime.stop();
    const second = await startCore({ port: first.port });
    stops.push(() => second.runtime.stop());
    expect(second.port).toBe(first.port);

    // The stale capability token is rejected; the client registers again, and because the user
    // has not enabled the capability in this new Core, the event is not accepted.
    const lost = await client.emit(workspaceOpened({ name: "after" }));
    expect(lost).toMatchObject({ sent: false });
    expect(client.registered).toBe(true);
    expect(client.enabled).toBe(false);
    expect(await eventTypes(second)).toEqual([]);

    // Once the user enables it in the new Core, events flow again with no restart of the editor.
    await second.api("POST", "/api/capabilities/editor/enable", {});
    await vi.waitFor(() => expect(client.enabled).toBe(true));
    expect(await client.emit(workspaceOpened({ name: "after" }))).toEqual({ sent: true });
    expect(await eventTypes(second)).toEqual(["editor.workspace.opened"]);
  });

  it("reconcile notices a restarted Core even before an event is sent", async () => {
    const first = await startCore();
    const client = createPhoenixClient({
      coreUrl: first.base,
      manifest: buildManifest(),
      sessionToken: () => TOKEN,
    });
    stops.push(() => client.close());
    await client.listen();
    await client.reconcile();
    await first.runtime.stop();
    expect(await client.reconcile()).toBe(false); // Core is down
    expect(client.registered).toBe(false);
    const second = await startCore({ port: first.port });
    stops.push(() => second.runtime.stop());
    expect(await client.reconcile()).toBe(true);
    expect((await second.api("GET", "/api/capabilities/editor")).json).toMatchObject({
      id: "editor",
      kind: "external",
    });
  });

  it("reports an actionable problem, not an exception, when Core is not running", async () => {
    const client = createPhoenixClient({
      coreUrl: "http://127.0.0.1:1",
      manifest: buildManifest(),
      sessionToken: () => TOKEN,
    });
    stops.push(() => client.close());
    await client.listen();
    expect(await client.reconcile()).toBe(false);
    expect(client.problem).toBe("Phoenix Core is not running");
    expect(await client.emit(workspaceOpened({ name: "x" }))).toMatchObject({ sent: false });
  });

  it("a wrong session token is refused by Core and surfaced without leaking the token", async () => {
    const { client } = await setup(() => "wrong-token-wrong-token");
    expect(await client.reconcile()).toBe(false);
    expect(client.problem).toMatch(/Registration with Phoenix Core failed \(401\)/);
    expect(client.problem).not.toContain("wrong-token");
  });

  it("the callback endpoint rejects anyone but Core", async () => {
    const { client } = await setup();
    await client.reconcile();
    const anonymous = await fetch(`${client.endpoint}/health`);
    expect(anonymous.status).toBe(401);
    const forged = await fetch(`${client.endpoint}/phoenix/lifecycle`, {
      method: "POST",
      headers: { "x-phoenix-capability-token": "x".repeat(43), "content-type": "application/json" },
      body: JSON.stringify({ action: "enable" }),
    });
    expect(forged.status).toBe(401);
    expect(client.enabled).toBe(false);
  });
});
