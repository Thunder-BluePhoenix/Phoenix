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
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startMockGithub } from "../../../capabilities/github/testing/mock-github";
import { MOCK_KAGE_KEY, startMockKage } from "../../../capabilities/kage/testing/mock-kage";
import { builtinCapabilities } from "../src/builtins";
import { connect, startCore, TOKEN } from "./helpers";

interface FeedEvent {
  event: { source: string; severity: string; event_type: string; correlation_id?: string };
}
interface CapabilityRow {
  id: string;
  status: string;
  health: { status: string; message?: string; checkedAt?: string };
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

  it("cycles every production builtin and the development mock without external services", async () => {
    const frappe = await frappeFixture();
    const github = await startMockGithub();
    const kage = await startMockKage();
    const core = await startCore(
      {},
      { capabilities: builtinCapabilities("dev"), secrets: new MemorySecretStore() },
    );
    stop = async () => {
      try {
        await core.runtime.stop();
      } finally {
        await Promise.all([github.close(), kage.close()]);
      }
    };
    const api = core.api;
    const configure = async (id: string, config: unknown) => {
      expect((await api("POST", `/api/capabilities/${id}/config`, { config })).status).toBe(200);
    };
    await configure("frappe", {
      benches: [frappe.bench],
      sites: { "shop.local": frappe.url },
      poll_ms: 60_000,
    });
    await configure("docker", {
      socket_path: join(frappe.bench, "absent-docker.sock"),
      poll_ms: 60_000,
    });
    await configure("git", {
      repositories: [join(frappe.bench, "absent-repository")],
      poll_ms: 60_000,
    });
    await configure("github", {
      repositories: ["octo/phoenix"],
      api_url: github.url,
      poll_ms: 60_000,
    });
    await configure("kage", { base_url: kage.url, poll_ms: 60_000 });
    expect(
      (await api("POST", "/api/capabilities/kage/secrets/api_key", { value: MOCK_KAGE_KEY }))
        .status,
    ).toBe(200);
    // Issues has no tracker configured; it must not try a remote provider.
    // Device capture is only lifecycle/permission-smoked here: real media, local models,
    // hardware, agent launching, and tracker writes need a separate external signal.
    const ids = [
      ...builtinCapabilities("prod").map((module) => module.manifest.id),
      "capture-microphone",
      "capture-screen",
      "mock",
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(builtinCapabilities("prod").some((module) => module.manifest.id === "mock")).toBe(false);
    expect(
      (await api("GET", "/api/capabilities")).json.capabilities
        .map((cap: CapabilityRow) => cap.id)
        .sort(),
    ).toEqual([...ids].sort());
    const row = async (id: string) => {
      const response = await api("GET", `/api/capabilities/${id}`);
      expect(response.status).toBe(200);
      return response.json as CapabilityRow;
    };
    for (const id of ids) {
      expect((await row(id)).status).toBe("installed");
      const enabled = await api("POST", `/api/capabilities/${id}/enable`, {});
      expect(enabled.status).toBe(200);
      expect((await row(id)).status).toBe("enabled");
      const checked = await core.runtime.capabilities.checkHealth(id);
      expect(checked.health.status).toMatch(/^(healthy|degraded|unhealthy)$/);
      expect(checked.health.checkedAt).toBeTruthy();
      expect((await api("POST", `/api/capabilities/${id}/disable`, {})).json.status).toBe(
        "disabled",
      );
      expect((await row(id)).health.status).toBe("unknown");
      if (id === "mock") {
        expect(
          (await api("POST", "/api/capabilities/mock/commands/ping", { input: {} })).json.code,
        ).toBe("CAPABILITY_DISABLED");
      }
      expect((await api("POST", `/api/capabilities/${id}/enable`, {})).json.status).toBe("enabled");
      expect((await row(id)).status).toBe("enabled");
    }
    await vi.waitFor(async () => {
      expect((await core.runtime.capabilities.checkHealth("docker")).health.status).toBe(
        "degraded",
      );
      expect((await core.runtime.capabilities.checkHealth("git")).health.status).toBe("unhealthy");
      expect((await core.runtime.capabilities.checkHealth("frappe")).health.status).toBe("healthy");
    });
    expect((await core.runtime.capabilities.checkHealth("docker")).health.message).toContain(
      "Docker socket",
    );
    expect((await core.runtime.capabilities.checkHealth("git")).health.message).toContain(
      "absent-repository",
    );
    await vi.waitFor(async () => {
      expect((await core.runtime.capabilities.checkHealth("github")).health.status).toBe("healthy");
    });
    expect(github.requests.some((request) => request.path.startsWith("/repos/octo/phoenix/"))).toBe(
      true,
    );
    expect((await core.runtime.capabilities.checkHealth("issues")).health).toMatchObject({
      status: "degraded",
      message: "No trackers are configured",
    });
    expect((await core.runtime.capabilities.checkHealth("kage")).health.status).toBe("healthy");
    expect((await core.runtime.capabilities.checkHealth("mock")).health.status).toBe("healthy");
    const command = async (id: string, name: string, input: unknown) => {
      const posted = await api("POST", `/api/capabilities/${id}/commands/${name}`, { input });
      expect(posted.status).toBe(202);
      let operation: { status: string; result?: unknown; error?: { code: string } } | undefined;
      await vi.waitFor(async () => {
        operation = (await api("GET", `/api/operations/${posted.json.id}`)).json;
        expect(["succeeded", "failed"]).toContain(operation?.status);
      });
      return operation!;
    };
    expect(await command("mock", "ping", {})).toMatchObject({
      status: "succeeded",
      result: "pong",
    });
    // Planning has no authorized review service in this fixture; never synthesize plan data.
    expect(
      await command("plans", "review_context", {
        plan_id: `plan_${"0".repeat(32)}`,
      }),
    ).toMatchObject({ status: "failed", error: { code: "CAPABILITY_UNAVAILABLE" } });
    expect(
      await command("terminal", "report", {
        phase: "finished",
        id: "gate-smoke",
        command: "echo gate",
        kind: "command",
        exit_code: 0,
      }),
    ).toMatchObject({ status: "succeeded" });
    await core.runtime.bus.drain();
    expect(
      ((await api("GET", "/api/events?limit=200")).json.events as FeedEvent[]).some(
        ({ event }) => event.source === "terminal" && event.event_type === "command.completed",
      ),
    ).toBe(true);
    // A loopback Kage outage is visible without bringing down Core or the other pollers.
    kage.setDown(true);
    expect((await core.runtime.capabilities.checkHealth("kage")).health.status).toBe("unhealthy");
    expect((await api("GET", "/api/health")).status).toBe(200);
    expect((await row("frappe")).status).toBe("enabled");
    expect((await row("github")).status).toBe("enabled");
    kage.setDown(false);
    expect((await core.runtime.capabilities.checkHealth("kage")).health.status).toBe("healthy");
    // Capture grants are isolated; disabling either does not disable the other.
    expect(core.runtime.permissions.grants.has("capture-microphone", "microphone")).toBe(true);
    expect(core.runtime.permissions.grants.has("capture-screen", "screen_capture")).toBe(true);
    expect((await api("POST", "/api/capabilities/capture-screen/disable", {})).status).toBe(200);
    expect((await row("capture-microphone")).status).toBe("enabled");
    expect(core.runtime.multimodal.captureAllowed("screen")).toBe(false);
    expect(core.runtime.multimodal.captureAllowed("microphone")).toBe(true);
    expect((await api("POST", "/api/capabilities/capture-screen/enable", {})).status).toBe(200);
    expect(core.runtime.multimodal.captureAllowed("screen")).toBe(true);
    // Even with a lifecycle grant, no local speech model means no device data is accepted.
    const capture = new WebSocket(
      `ws://127.0.0.1:${core.port}/api/multimodal/capture`,
      [WS_PROTOCOL, WS_TOKEN_PREFIX + TOKEN],
      { headers: { Origin: core.base } },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        capture.once("open", resolve);
        capture.once("error", reject);
      });
      const refused = new Promise<{ type: string; error?: unknown }>((resolve, reject) => {
        capture.on("message", (data) => {
          const message = JSON.parse(data.toString()) as { type: string; error?: unknown };
          if (message.type === "error") resolve(message);
        });
        capture.once("close", () => reject(new Error("Capture closed before refusing input")));
      });
      capture.send(JSON.stringify({ kind: "microphone", agent_id: "user" }));
      expect((await refused).error).toBeTruthy();
      expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
    } finally {
      capture.terminate();
    }
    expect((await api("GET", "/api/health")).status).toBe(200);
    expect(github.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(github.writes).toEqual([]);
  }, 40_000);
});
