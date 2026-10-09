// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 26 exit criteria, exercised through a real runtime and its real HTTP API with the real
// first-party capabilities: several integrations share one event protocol, each can be enabled
// and disabled on its own, source and severity are distinguishable, and a capability that fails
// never takes Core or the others down.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { connect, startCore } from "./helpers";

interface FeedEvent {
  event: { source: string; severity: string; event_type: string; correlation_id?: string };
}
interface CapabilityRow {
  id: string;
  status: string;
  health: { status: string; message?: string };
}

let stop: (() => Promise<void>) | undefined;
const servers: Server[] = [];
afterEach(async () => {
  await stop?.();
  stop = undefined;
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

/** A bench with one site, and a "Frappe" that answers ping until told otherwise. */
async function frappeFixture() {
  const bench = mkdtempSync(join(tmpdir(), "phoenix-bench-"));
  mkdirSync(join(bench, "sites", "shop.local"), { recursive: true });
  writeFileSync(join(bench, "sites", "apps.txt"), "frappe\n");
  writeFileSync(join(bench, "sites", "shop.local", "site_config.json"), "{}");
  let up = true;
  const server = createServer((_req, res) => {
    if (!up) return void res.socket?.destroy();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "pong" }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { bench, url, setUp: (value: boolean) => (up = value) };
}

describe("v0.2 gate: several integrations, one protocol", () => {
  it("every integration emits the same event shape, each enables and disables on its own", async () => {
    const frappe = await frappeFixture();
    const core = await startCore({}, { capabilities: builtinCapabilities("dev") });
    stop = () => core.runtime.stop();

    const configure = (id: string, config: unknown) =>
      core.api("POST", `/api/capabilities/${id}/config`, { config });
    expect(
      (
        await configure("frappe", {
          benches: [frappe.bench],
          sites: { "shop.local": frappe.url },
          poll_ms: 1000,
        })
      ).status,
    ).toBe(200);
    expect(
      (await configure("docker", { socket_path: join(frappe.bench, "no-docker.sock") })).status,
    ).toBe(200);

    // Only frappe is enabled: nothing else may start, poll or emit.
    expect((await core.api("POST", "/api/capabilities/frappe/enable", {})).json.status).toBe(
      "enabled",
    );
    const listed = async () =>
      (await core.api("GET", "/api/capabilities")).json.capabilities as CapabilityRow[];
    const status = async (id: string) => (await listed()).find((c) => c.id === id)?.status;
    expect(await status("docker")).toBe("installed");
    expect(await status("github")).toBe("installed");

    // The agents capability reports through the same API the hook CLI uses.
    expect((await core.api("POST", "/api/capabilities/agents/enable", {})).json.status).toBe(
      "enabled",
    );
    const report = await core.api("POST", "/api/capabilities/agents/commands/report", {
      input: {
        agent: "claude-code",
        agent_id: "session-1",
        workspace: frappe.bench,
        state: "waiting",
        reason: "permission",
      },
    });
    expect(report.status).toBe(202);

    // Docker is enabled with no daemon: degraded, quiet, and Core keeps serving.
    expect((await core.api("POST", "/api/capabilities/docker/enable", {})).json.status).toBe(
      "enabled",
    );

    await core.runtime.bus.drain();
    const feed = (await core.api("GET", "/api/events?limit=200")).json.events as FeedEvent[];
    const sources = new Set(feed.map((e) => e.event.source));
    expect(sources).toContain("agents");
    // Same protocol: every event from these integrations has a source of its own and a severity.
    for (const { event } of feed.filter((e) =>
      ["agents", "frappe", "docker"].includes(e.event.source),
    )) {
      expect(["info", "success", "warning", "error"]).toContain(event.severity);
      expect(
        event.event_type.startsWith(`${event.source === "agents" ? "agent" : event.source}.`),
      ).toBe(true);
    }

    // The waiting agent shows through the shared state engine and produced a notification.
    expect((await core.api("GET", "/api/pet/state")).json.state).toBe("WAITING");
    const notes = (await core.api("GET", "/api/notifications")).json.notifications as {
      source: string;
    }[];
    expect(notes.map((n) => n.source)).toContain("agents");

    // Disabling one integration clears only its own state and leaves the others enabled.
    expect((await core.api("POST", "/api/capabilities/agents/disable", {})).json.status).toBe(
      "disabled",
    );
    await core.runtime.bus.drain();
    expect((await core.api("GET", "/api/pet/state")).json.state).not.toBe("WAITING");
    expect(await status("frappe")).toBe("enabled");
    expect(await status("docker")).toBe("enabled");
  });

  it("a failing integration never crashes Core, and its failure is visible, not silent", async () => {
    const frappe = await frappeFixture();
    const core = await startCore({}, { capabilities: builtinCapabilities("dev") });
    stop = () => core.runtime.stop();
    const ws = connect(core.port);
    await ws.opened;
    ws.send({ type: "subscribe", channels: ["state.changed"] });

    await core.api("POST", "/api/capabilities/frappe/config", {
      config: { benches: [frappe.bench], sites: { "shop.local": frappe.url }, poll_ms: 500 },
    });
    await core.api("POST", "/api/capabilities/frappe/enable", {});
    // A repository that does not exist must degrade that capability, not Core.
    await core.api("POST", "/api/capabilities/git/config", {
      config: { repositories: ["/definitely/not/a/repo"], poll_ms: 500 },
    });
    await core.api("POST", "/api/capabilities/git/enable", {});

    const healthOf = async (id: string) => {
      await core.runtime.capabilities.checkHealth(id);
      const caps = (await core.api("GET", "/api/capabilities")).json
        .capabilities as CapabilityRow[];
      return caps.find((c) => c.id === id)?.health;
    };

    // git: broken from the start, and says why.
    await vi.waitFor(async () => expect((await healthOf("git"))?.status).toBe("unhealthy"), {
      timeout: 10_000,
    });
    expect((await healthOf("git"))?.message).toContain("/definitely/not/a/repo");

    // frappe: healthy, then its site goes down: Fawkes shows ERROR, and it recovers.
    await vi.waitFor(async () => expect((await healthOf("frappe"))?.status).toBe("healthy"), {
      timeout: 10_000,
    });
    frappe.setUp(false);
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "ERROR", 10_000);
    expect((await core.api("GET", "/api/pet/state")).json.explanation).toContain("shop.local");
    frappe.setUp(true);
    await ws.next((m) => m.channel === "state.changed" && m.data.state !== "ERROR", 10_000);

    // Throughout: Core answers, and neither failure disabled anything.
    expect((await core.api("GET", "/api/health")).status).toBe(200);
    const caps = (await core.api("GET", "/api/capabilities")).json.capabilities as CapabilityRow[];
    expect(caps.find((c) => c.id === "frappe")?.status).toBe("enabled");
    expect(caps.find((c) => c.id === "git")?.status).toBe("enabled");
  }, 40_000);
});
