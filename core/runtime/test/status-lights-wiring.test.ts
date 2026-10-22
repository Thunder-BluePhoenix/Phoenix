// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { isLocalIPv4, STATUS_LIGHT_DEVICES_KEY } from "../src/status-lights/provision";
import { event, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Put {
  url: string;
  body: { lights: { on: number; brightness: number }[] };
}

/** A pretend Elgato Key Light on loopback that records each write. */
async function fakeLight(): Promise<{ port: number; puts: Put[] }> {
  const puts: Put[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      puts.push({
        url: `${req.method} ${req.url}`,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(200).end("{}");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port: (server.address() as AddressInfo).port, puts };
}

async function boot(): Promise<TestCore> {
  let core: TestCore | undefined;
  const capabilities = builtinCapabilities("prod", undefined, undefined, {
    statusLights: {
      devices: () => core!.runtime.statusLights.devices(),
      feed: () => core!.runtime.bus,
    },
  });
  core = await startCore({}, { capabilities });
  cleanups.push(() => core!.runtime.stop());
  return core;
}

async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 5_000 && !done(); i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  expect(done()).toBe(true);
}

const agent = (type: string) => event(type, { source: "agents", severity: "info" });

describe("status lights through the running Core", () => {
  it("is installed but off, and lists no lights, until the owner adds one", async () => {
    const core = await boot();
    const row = (await core.api("GET", "/api/capabilities")).json.capabilities.find(
      (c: { id: string }) => c.id === "status-lights",
    );
    expect(row.status).toBe("installed");
    expect((await core.api("GET", "/api/status-lights/devices")).json).toEqual({ lights: [] });
    expect((await fetch(`${core.base}/api/status-lights/devices`)).status).toBe(401);
  });

  it("lights a provisioned Key Light only after the owner consents to it, and follows Fawkes", async () => {
    const light = await fakeLight();
    const core = await boot();
    const put = await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "desk", kind: "key-light", address: "127.0.0.1", port: light.port }],
    });
    expect(put.status).toBe(200);
    // Provisioned but not consented: enabling the capability writes nothing to it.
    expect((await core.api("POST", "/api/capabilities/status-lights/enable", {})).status).toBe(200);
    core.runtime.bus.publish(agent("agent.working"));
    await core.runtime.bus.drain();
    await Promise.resolve();
    expect(light.puts).toEqual([]);

    // Consent is the capability's own setting; re-enable so it takes effect.
    await core.api("POST", "/api/capabilities/status-lights/disable", {});
    expect(
      (
        await core.api("POST", "/api/capabilities/status-lights/config", {
          config: { devices: ["desk"] },
        })
      ).status,
    ).toBe(200);
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(agent("agent.working"));
    await settle(() => light.puts.length > 0);
    expect(light.puts.at(-1)).toEqual({
      url: "PUT /elgato/lights",
      body: { numberOfLights: 1, lights: [{ on: 1, brightness: 35, temperature: 200 }] },
    });
    core.runtime.bus.publish(agent("agent.completed"));
    await settle(() => light.puts.at(-1)!.body.lights[0]!.on === 0);
  });

  it("ignores a state event that does not come from the agents source", async () => {
    const light = await fakeLight();
    const core = await boot();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "desk", kind: "key-light", address: "127.0.0.1", port: light.port }],
    });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["desk"] },
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(event("agent.working", { source: "terminal" }));
    await core.runtime.bus.drain();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(light.puts).toEqual([]);
  });

  it("goes dark when the emergency stop is engaged", async () => {
    const light = await fakeLight();
    const core = await boot();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "desk", kind: "key-light", address: "127.0.0.1", port: light.port }],
    });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["desk"] },
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(agent("agent.working"));
    await settle(() => light.puts.length > 0);
    core.runtime.permissions.engageKillSwitch("test");
    await core.runtime.bus.drain();
    await settle(() => light.puts.at(-1)!.body.lights[0]!.on === 0);
    const after = light.puts.length;
    core.runtime.bus.publish(agent("agent.working"));
    await core.runtime.bus.drain();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(light.puts).toHaveLength(after);
  });

  it("refuses anything but a LAN IPv4 address, an unknown kind, extra fields and duplicates", async () => {
    const core = await boot();
    const put = (lights: unknown) => core.api("PUT", "/api/status-lights/devices", { lights });
    const ok = { id: "desk", kind: "key-light", address: "192.168.1.20" };
    expect((await put([ok])).status).toBe(200);
    for (const bad of [
      { ...ok, address: "8.8.8.8" },
      { ...ok, address: "example.com" },
      { ...ok, address: "192.168.1.20/x" },
      { ...ok, address: "172.32.0.1" },
      { ...ok, address: "010.0.0.1" },
      { ...ok, address: "0x7f.0.0.1" },
      { ...ok, kind: "hue" },
      { ...ok, port: 0 },
      { ...ok, id: "../x" },
      { ...ok, url: "http://evil" },
    ])
      expect((await put([bad])).status).toBe(400);
    expect((await put([ok, ok])).status).toBe(400);
    expect((await put(Array.from({ length: 17 }, (_, i) => ({ ...ok, id: `l${i}` })))).status).toBe(
      400,
    );
    // A refused update leaves the previous list in place.
    expect((await core.api("GET", "/api/status-lights/devices")).json.lights).toHaveLength(1);
  });

  it("never contacts a stored light whose address is no longer a LAN address", async () => {
    const core = await boot();
    core.runtime.settings.set(STATUS_LIGHT_DEVICES_KEY, [
      { id: "far", kind: "key-light", address: "8.8.8.8", port: 9123 },
      { id: "near", kind: "key-light", address: "10.0.0.5", port: 9123 },
    ]);
    expect(core.runtime.statusLights.devices().map((d) => d.id)).toEqual(["near"]);
  });

  it("classifies private, link-local and loopback ranges and nothing else", () => {
    for (const a of [
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.1.1",
      "127.0.0.1",
    ])
      expect(isLocalIPv4(a)).toBe(true);
    for (const a of [
      "172.15.0.1",
      "172.32.0.1",
      "11.0.0.1",
      "192.169.0.1",
      "256.1.1.1",
      "1.2.3",
      "::1",
      "a.b.c.d",
    ])
      expect(isLocalIPv4(a)).toBe(false);
  });
});
