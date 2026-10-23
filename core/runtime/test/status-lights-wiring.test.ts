// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { isLocalIPv4 } from "../src/status-lights/lan-address";
import { STATUS_LIGHT_DEVICES_KEY } from "../src/status-lights/provision";
import { statusLightsHost } from "../src/status-lights/host";
import { fakeLifx, until, type FakeLifx } from "./fake-lifx";
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
    statusLights: statusLightsHost(() => core!.runtime),
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

  it("keeps a Key Light stored before LIFX existed, and lists it unchanged", async () => {
    const core = await boot();
    core.runtime.settings.set(STATUS_LIGHT_DEVICES_KEY, [
      { id: "desk", kind: "key-light", address: "192.168.1.20", port: 9123 },
    ]);
    expect((await core.api("GET", "/api/status-lights/devices")).json).toEqual({
      lights: [{ id: "desk", kind: "key-light", address: "192.168.1.20", port: 9123 }],
    });
    expect(core.runtime.statusLights.devices()).toMatchObject([{ id: "desk", kind: "key-light" }]);
  });

  it("provisions a LIFX light with a validated serial, normalised, and audits it", async () => {
    const core = await boot();
    const put = await core.api("PUT", "/api/status-lights/devices", {
      lights: [
        { id: "desk", kind: "key-light", address: "192.168.1.20" },
        { id: "shelf", kind: "lifx", address: "192.168.1.21", mac: "D0:73:D5:01:23:45" },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.json.lights).toEqual([
      { id: "desk", kind: "key-light", address: "192.168.1.20", port: 9123 },
      { id: "shelf", kind: "lifx", address: "192.168.1.21", port: 56700, mac: "d073d5012345" },
    ]);
    expect(core.runtime.statusLights.devices().map((d) => [d.id, d.kind, d.mac])).toEqual([
      ["desk", "key-light", undefined],
      ["shelf", "lifx", "d073d5012345"],
    ]);
    const audited = core.runtime.permissions.audit
      .list({ limit: 50 })
      .find((e) => e.action === "status_lights.provisioned");
    expect(audited).toMatchObject({
      actor: "user",
      decision: "allowed",
      details: { count: 2, kinds: ["key-light", "lifx"] },
    });
    expect(JSON.stringify(audited)).not.toContain("d073d5012345"); // the serial is not logged
  });

  it("refuses a LIFX entry that is not a unicast LAN IPv4 with a valid serial and port", async () => {
    const core = await boot();
    const put = (lights: unknown) => core.api("PUT", "/api/status-lights/devices", { lights });
    const ok = { id: "shelf", kind: "lifx", address: "192.168.1.21", mac: "d073d5012345" };
    expect((await put([ok])).status).toBe(200);
    for (const bad of [
      { ...ok, address: "8.8.8.8" },
      { ...ok, address: "lifx.example.com" },
      { ...ok, address: "192.168.1.255" },
      { ...ok, address: "255.255.255.255" },
      { ...ok, address: "10.0.0.0" },
      { ...ok, address: "224.0.0.1" },
      { ...ok, mac: undefined },
      { ...ok, mac: "d073d501234" },
      { ...ok, mac: "000000000000" },
      { ...ok, mac: "ffffffffffff" },
      { ...ok, mac: "d073d5012345; rm -rf" },
      { ...ok, mac: 12 },
      { ...ok, port: 1234 }, // a real light is always on 56700; other ports only on loopback
      { ...ok, port: 0 },
      { ...ok, id: "../x" },
      { ...ok, url: "udp://x" },
      { id: "desk", kind: "key-light", address: "192.168.1.20", mac: ok.mac },
      { id: "x", address: "192.168.1.20" }, // kind is required
    ])
      expect((await put([bad])).status).toBe(400);
    expect((await put([ok, { ...ok, mac: "d073d5aabbcc" }])).status).toBe(400); // duplicate id
    expect((await core.api("GET", "/api/status-lights/devices")).json.lights).toHaveLength(1);
  });

  it("never contacts a stored LIFX light whose address or serial no longer validates", async () => {
    const core = await boot();
    core.runtime.settings.set(STATUS_LIGHT_DEVICES_KEY, [
      { id: "far", kind: "lifx", address: "8.8.8.8", port: 56700, mac: "d073d5012345" },
      { id: "bcast", kind: "lifx", address: "192.168.1.255", port: 56700, mac: "d073d5012345" },
      { id: "nomac", kind: "lifx", address: "192.168.1.9", port: 56700 },
      { id: "zero", kind: "lifx", address: "192.168.1.9", port: 56700, mac: "000000000000" },
      { id: "near", kind: "lifx", address: "192.168.1.9", port: 56700, mac: "D073D5012345" },
    ]);
    expect(core.runtime.statusLights.devices().map((d) => [d.id, d.mac])).toEqual([
      ["near", "d073d5012345"],
    ]);
  });

  async function provisionLifx(core: TestCore, light: FakeLifx): Promise<void> {
    expect(
      (
        await core.api("PUT", "/api/status-lights/devices", {
          lights: [
            { id: "shelf", kind: "lifx", address: "127.0.0.1", port: light.port, mac: light.mac },
          ],
        })
      ).status,
    ).toBe(200);
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["shelf"] },
    });
    expect((await core.api("POST", "/api/capabilities/status-lights/enable", {})).status).toBe(200);
  }

  const lifxTypes = (light: FakeLifx) =>
    light.received.map((r) => new DataView(r.bytes.buffer).getUint16(32, true));

  it("lights a consented LIFX light over UDP and follows Fawkes, against a fake light", async () => {
    const light = await fakeLifx();
    cleanups.push(() => light.close());
    const core = await boot();
    await provisionLifx(core, light);
    core.runtime.bus.publish(agent("agent.working"));
    await until(() => light.received.length >= 3);
    // Enabling darkens the light first (IDLE is a power-off), then WORKING is colour, then power on.
    expect(lifxTypes(light)).toEqual([117, 102, 117]);
    const colour = new DataView(light.received[1]!.bytes.buffer);
    expect((colour.getUint16(37, true) / 65535) * 360).toBeGreaterThan(200); // blue
    expect(colour.getUint16(41, true)).toBe(Math.round(0.35 * 65535)); // the Key Light's brightness
    expect(light.received[2]!.bytes[36]).toBe(0xff); // power on
    core.runtime.bus.publish(agent("agent.completed"));
    await until(() => light.received.length >= 4);
    expect(lifxTypes(light).at(-1)).toBe(117);
    expect(light.received.at(-1)!.bytes[36]).toBe(0); // power off for IDLE
  });

  it("sends nothing to a provisioned LIFX light the owner has not consented to", async () => {
    const light = await fakeLifx();
    cleanups.push(() => light.close());
    const core = await boot();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [
        { id: "shelf", kind: "lifx", address: "127.0.0.1", port: light.port, mac: light.mac },
      ],
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(agent("agent.working"));
    await core.runtime.bus.drain();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(light.received).toEqual([]);
  });

  it("follows Focus mode: the light goes dark when Focus starts and returns when it stops", async () => {
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
    await settle(() => light.puts.length === 1 && light.puts[0]!.body.lights[0]!.on === 1);

    expect((await core.api("POST", "/api/focus", {})).json).toMatchObject({ active: true });
    await settle(() => light.puts.length === 2);
    expect(light.puts[1]!.body.lights[0]!.on).toBe(0);
    // While Focus is on, new work does not light it.
    core.runtime.bus.publish(agent("agent.waiting"));
    await core.runtime.bus.drain();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(light.puts).toHaveLength(2);

    expect((await core.api("DELETE", "/api/focus")).json).toMatchObject({ active: false });
    await settle(() => light.puts.length === 3);
    expect(light.puts[2]!.body.lights[0]!.on).toBe(1);
  });

  it("stops following Focus once the capability is disabled", async () => {
    const light = await fakeLight();
    const core = await boot();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "desk", kind: "key-light", address: "127.0.0.1", port: light.port }],
    });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["desk"] },
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    await core.api("POST", "/api/capabilities/status-lights/disable", {});
    const before = light.puts.length;
    await core.api("POST", "/api/focus", {});
    await core.runtime.bus.drain();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(light.puts).toHaveLength(before);
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
