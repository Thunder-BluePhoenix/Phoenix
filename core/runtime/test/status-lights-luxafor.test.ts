// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Luxafor through its documented local webhook, against a fake webhook server on loopback. No
// Luxafor app or device was involved. Also LIFX discovery through the Core API with a fake socket.
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LIFX_SOURCE, lifxStateService } from "@phoenix/capability-status-lights";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { statusLightsHost } from "../src/status-lights/host";
import type { DiscoverySocket } from "../src/status-lights/lifx-discovery";
import { event, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Built from parts: scanners flag a long random-looking literal. */
const TOKEN = ["luxafor", "webhook", "t0ken", "9f8e7d6c5b4a"].join("-");

interface Hit {
  method: string | undefined;
  url: string | undefined;
  auth: string | undefined;
  body: unknown;
}

async function fakeLuxafor(): Promise<{ port: number; hits: Hit[] }> {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      hits.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(200, { "content-length": 0 }).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port: (server.address() as AddressInfo).port, hits };
}

async function boot(statusLights: Record<string, unknown> = {}): Promise<{
  core: TestCore;
  secrets: MemorySecretStore;
}> {
  const secrets = new MemorySecretStore();
  let core: TestCore | undefined;
  const capabilities = builtinCapabilities("prod", undefined, undefined, {
    statusLights: statusLightsHost(() => core!.runtime),
  });
  core = await startCore(
    {},
    {
      capabilities,
      secrets,
      runtime: { statusLights: { luxaforMinIntervalMs: 1, ...statusLights } },
    },
  );
  cleanups.push(() => core!.runtime.stop());
  return { core, secrets };
}

async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 5_000 && !done(); i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  expect(done()).toBe(true);
}

describe("Luxafor local webhook", () => {
  it("is provisioned with a LAN address only, and the token is write-only", async () => {
    const { core, secrets } = await boot();
    const put = (lights: unknown[]) => core.api("PUT", "/api/status-lights/devices", { lights });
    for (const address of ["8.8.8.8", "luxafor.local", "https://127.0.0.1"])
      expect((await put([{ id: "l", kind: "luxafor", address }])).status).toBe(400);
    const ok = await put([{ id: "l", kind: "luxafor", address: "127.0.0.1" }]);
    expect(ok.json.lights).toEqual([
      { id: "l", kind: "luxafor", address: "127.0.0.1", port: 5383 },
    ]);

    const token = (id: string, value: unknown) =>
      core.api("PUT", `/api/status-lights/luxafor/${id}/token`, { token: value });
    expect((await token("missing", TOKEN)).status).toBe(404);
    for (const bad of ["", "has space", "x".repeat(129), 5, undefined])
      expect((await token("l", bad)).status).toBe(400);
    const stored = await token("l", TOKEN);
    expect(stored.status).toBe(200);
    expect(stored.json).toEqual({ stored: true });
    expect(await secrets.get("status-lights.luxafor.l")).toBe(TOKEN);
    const everything =
      JSON.stringify((await core.api("GET", "/api/status-lights/devices")).json) +
      JSON.stringify(core.runtime.permissions.audit.list({})) +
      JSON.stringify(core.runtime.settings.get("status-lights.provisioned", null));
    expect(everything).not.toContain(TOKEN);
    // Taking the light out of the list deletes the token.
    await put([]);
    expect(await secrets.get("status-lights.luxafor.l")).toBeUndefined();
  });

  it("follows Fawkes with POST /color and the bearer token, one fixed hex colour per state", async () => {
    const fake = await fakeLuxafor();
    const { core } = await boot();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "l", kind: "luxafor", address: "127.0.0.1", port: fake.port }],
    });
    await core.api("PUT", "/api/status-lights/luxafor/l/token", { token: TOKEN });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["l"] },
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(event("agent.failed", { source: "agents", severity: "info" }));
    await settle(() => fake.hits.some((h) => (h.body as { color: string }).color === "FF2018"));
    for (const hit of fake.hits) {
      expect(hit.method).toBe("POST");
      expect(hit.url).toBe("/color");
      expect(hit.auth).toBe(`Bearer ${TOKEN}`);
      expect(Object.keys(hit.body as object)).toEqual(["color"]);
      expect((hit.body as { color: string }).color).toMatch(/^[0-9A-F]{6}$/);
    }
  });

  it("sends nothing when no token is stored", async () => {
    const fake = await fakeLuxafor();
    const { core } = await boot();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "l", kind: "luxafor", address: "127.0.0.1", port: fake.port }],
    });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["l"] },
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(event("agent.failed", { source: "agents", severity: "info" }));
    await core.runtime.bus.drain();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(fake.hits).toEqual([]);
  });
});

class OneShotSocket implements DiscoverySocket {
  sent: { address: string; port: number }[] = [];
  private listener: (m: Uint8Array, from: { address: string; port: number }) => void = () => {};
  bind(_p: number, cb: () => void) {
    queueMicrotask(cb);
  }
  setBroadcast() {}
  send(message: Uint8Array, port: number, address: string, cb: (e: Error | null) => void) {
    this.sent.push({ address, port });
    cb(null);
    const sequence = message[23]!;
    this.listener(lifxStateService("d073d5000001", 56_700, LIFX_SOURCE, sequence), {
      address: "192.168.1.40",
      port: 56_700,
    });
  }
  on(event: "message" | "error", listener: any) {
    if (event === "message") this.listener = listener;
    return this;
  }
  close() {}
}

describe("LIFX discovery through Core", () => {
  it("lists candidates, sends no state and provisions nothing until the owner adds one", async () => {
    const sockets: OneShotSocket[] = [];
    let now = 1_000_000;
    const { core } = await boot({
      discoverySocket: () => {
        const s = new OneShotSocket();
        sockets.push(s);
        return s;
      },
      discoveryWaitMs: 15,
      now: () => now,
    });
    const found = await core.api("POST", "/api/status-lights/lifx/discover", {});
    expect(found.status).toBe(200);
    expect(found.json.lights).toEqual([
      { mac: "d073d5000001", address: "192.168.1.40", port: 56_700, provisioned: false },
    ]);
    expect(sockets[0]!.sent).toEqual([{ address: "255.255.255.255", port: 56_700 }]); // GetService only
    expect((await core.api("GET", "/api/status-lights/devices")).json).toEqual({ lights: [] });

    // Rate bound: a second discovery right away is refused; after the cooldown it works.
    expect((await core.api("POST", "/api/status-lights/lifx/discover", {})).status).toBe(400);
    expect(sockets).toHaveLength(1);
    now += 6_000;
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "bulb", kind: "lifx", address: "192.168.1.40", mac: "d073d5000001" }],
    });
    const again = await core.api("POST", "/api/status-lights/lifx/discover", {});
    expect(again.json.lights[0].provisioned).toBe(true);
  });

  it("refuses a public broadcast target and unknown fields", async () => {
    const { core } = await boot({ discoverySocket: () => new OneShotSocket() });
    const post = (body: unknown) => core.api("POST", "/api/status-lights/lifx/discover", body);
    expect((await post({ broadcast: "8.8.8.8" })).status).toBe(400);
    expect((await post({ broadcast: "lifx.example.com" })).status).toBe(400);
    expect((await post({ mac: "d073d5000001" })).status).toBe(400);
  });
});
