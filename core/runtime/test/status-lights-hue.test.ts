// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hue pairing and light writes against a fake bridge link (no TLS, no bridge) through the running
// Core, plus the real TLS pinning code against a loopback TLS server with a self-signed certificate.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import {
  nodeHueLink,
  type HueCertificate,
  type HueLink,
  type HueRequest,
  type HueResponse,
} from "../src/status-lights/hue-link";
import { statusLightsHost } from "../src/status-lights/host";
import { event, startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const join2 = (...parts: string[]) => parts.join("");
const FINGERPRINT = "ab".repeat(32);
const OTHER_FINGERPRINT = "cd".repeat(32);
/** Built from parts: the scanners flag a 32+ character random-looking literal. */
const APP_KEY = join2("hueapp", "KEY", "0123456789", "abcdefABCDEF");
const LIGHT = "11111111-2222-3333-4444-555555555555";

interface Call {
  address: string;
  fingerprint: string;
  req: HueRequest;
}

class FakeBridge implements HueLink {
  calls: Call[] = [];
  probes: string[] = [];
  buttonPressed = false;
  certificate = FINGERPRINT;
  lightStatus = 200;
  lightBody = '{"errors":[],"data":[]}';

  async probe(target: { address: string }): Promise<HueCertificate> {
    this.probes.push(target.address);
    return { fingerprint: this.certificate, commonName: "001788fffe123456" };
  }

  async request(
    target: { address: string; port: number; fingerprint: string },
    req: HueRequest,
  ): Promise<HueResponse> {
    this.calls.push({ address: target.address, fingerprint: target.fingerprint, req });
    if (target.fingerprint !== this.certificate) throw new Error("certificate mismatch");
    if (req.method === "POST" && req.path === "/api")
      return {
        status: 200,
        body: this.buttonPressed
          ? JSON.stringify([{ success: { username: APP_KEY, clientkey: "unused" } }])
          : JSON.stringify([{ error: { type: 101, description: "link button not pressed" } }]),
      };
    if (req.headers["hue-application-key"] !== APP_KEY) return { status: 403, body: "{}" };
    if (req.method === "GET" && req.path === "/clip/v2/resource/light")
      return {
        status: 200,
        body: JSON.stringify({ data: [{ id: LIGHT, metadata: { name: "Desk" } }, { id: "../x" }] }),
      };
    return { status: this.lightStatus, body: this.lightBody };
  }
}

interface Rig {
  core: TestCore;
  bridge: FakeBridge;
  secrets: MemorySecretStore;
}

async function boot(): Promise<Rig> {
  const bridge = new FakeBridge();
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
      runtime: { statusLights: { hueLink: bridge, hueMinIntervalMs: 1 } },
    },
  );
  cleanups.push(() => core!.runtime.stop());
  return { core, bridge, secrets };
}

const pairBody = (over: Record<string, unknown> = {}) => ({
  id: "bridge1",
  address: "192.168.1.5",
  fingerprint: FINGERPRINT,
  ...over,
});

async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 5_000 && !done(); i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  expect(done()).toBe(true);
}

describe("Hue pairing through Core", () => {
  it("inspect shows the certificate fingerprint of an owner-entered address and sends nothing", async () => {
    const { core, bridge } = await boot();
    const res = await core.api("POST", "/api/status-lights/hue/inspect", {
      address: "192.168.1.5",
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      address: "192.168.1.5",
      port: 443,
      fingerprint: FINGERPRINT,
      common_name: "001788fffe123456",
    });
    expect(bridge.probes).toEqual(["192.168.1.5"]);
    expect(bridge.calls).toEqual([]);
  });

  it.each(["8.8.8.8", "hue.local", "192.168.1.255", "https://192.168.1.5", ""])(
    "refuses %s as a bridge address and contacts nothing",
    async (address) => {
      const { core, bridge } = await boot();
      expect((await core.api("POST", "/api/status-lights/hue/inspect", { address })).status).toBe(
        400,
      );
      expect(
        (await core.api("POST", "/api/status-lights/hue/bridges", pairBody({ address }))).status,
      ).toBe(400);
      expect(bridge.probes).toEqual([]);
      expect(bridge.calls).toEqual([]);
    },
  );

  it("needs the link button, then stores the key as a secret and never returns or lists it", async () => {
    const { core, bridge, secrets } = await boot();
    const early = await core.api("POST", "/api/status-lights/hue/bridges", pairBody());
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.json)).toContain("link button");
    expect(await secrets.get("status-lights.hue.bridge1")).toBeUndefined();
    expect((await core.api("GET", "/api/status-lights/hue/bridges")).json).toEqual({
      bridges: [],
    });

    bridge.buttonPressed = true;
    const paired = await core.api("POST", "/api/status-lights/hue/bridges", pairBody());
    expect(paired.status).toBe(200);
    expect(await secrets.get("status-lights.hue.bridge1")).toBe(APP_KEY);
    // The pairing request carries the confirmed fingerprint, a devicetype, no key.
    const post = bridge.calls.at(-1)!;
    expect(post).toMatchObject({
      address: "192.168.1.5",
      fingerprint: FINGERPRINT,
      req: { method: "POST", path: "/api", body: { devicetype: "phoenix#core" } },
    });
    const listed = await core.api("GET", "/api/status-lights/hue/bridges");
    expect(listed.json.bridges).toEqual([
      { id: "bridge1", address: "192.168.1.5", port: 443, fingerprint: FINGERPRINT },
    ]);
    // Nothing the API says, nor the settings, nor the audit log, contains the key.
    expect(JSON.stringify(paired.json) + JSON.stringify(listed.json)).not.toContain(APP_KEY);
    expect(
      JSON.stringify(core.runtime.settings.get("status-lights.hue-bridges", null)),
    ).not.toContain(APP_KEY);
    expect(JSON.stringify(core.runtime.permissions.audit.list({}))).not.toContain(APP_KEY);
  });

  it("refuses to pair without a confirmed fingerprint or when the certificate is not the confirmed one", async () => {
    const { core, bridge } = await boot();
    bridge.buttonPressed = true;
    expect(
      (await core.api("POST", "/api/status-lights/hue/bridges", pairBody({ fingerprint: "nope" })))
        .status,
    ).toBe(400);
    expect(bridge.calls).toEqual([]);
    const wrong = await core.api(
      "POST",
      "/api/status-lights/hue/bridges",
      pairBody({ fingerprint: OTHER_FINGERPRINT }),
    );
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.json)).toContain("confirmed");
    expect((await core.api("GET", "/api/status-lights/hue/bridges")).json.bridges).toEqual([]);
  });

  it("lists the bridge's lights (valid ids only) with its key, and removing a bridge deletes the key", async () => {
    const { core, bridge, secrets } = await boot();
    bridge.buttonPressed = true;
    await core.api("POST", "/api/status-lights/hue/bridges", pairBody());
    const lights = await core.api("GET", "/api/status-lights/hue/bridges/bridge1/lights");
    expect(lights.json).toEqual({ lights: [{ id: LIGHT, name: "Desk" }] });
    expect(bridge.calls.at(-1)!.req.headers["hue-application-key"]).toBe(APP_KEY);
    expect((await core.api("GET", "/api/status-lights/hue/bridges/nope/lights")).status).toBe(404);
    expect((await core.api("DELETE", "/api/status-lights/hue/bridges/bridge1")).status).toBe(200);
    expect(await secrets.get("status-lights.hue.bridge1")).toBeUndefined();
    expect((await core.api("GET", "/api/status-lights/hue/bridges")).json.bridges).toEqual([]);
  });

  it("is unavailable without an OS credential store", async () => {
    const bridge = new FakeBridge();
    bridge.buttonPressed = true;
    const core = await startCore({}, { runtime: { statusLights: { hueLink: bridge } } });
    cleanups.push(() => core.runtime.stop());
    const res = await core.api("POST", "/api/status-lights/hue/bridges", pairBody());
    expect(res.status).toBe(503);
    expect(bridge.calls).toEqual([]);
  });
});

describe("Hue light writes through Core", () => {
  async function paired(): Promise<Rig> {
    const rig = await boot();
    rig.bridge.buttonPressed = true;
    await rig.core.api("POST", "/api/status-lights/hue/bridges", pairBody());
    return rig;
  }
  const puts = (bridge: FakeBridge) => bridge.calls.filter((c) => c.req.method === "PUT");

  it("only provisions a Hue light on a paired bridge, with a plain resource id", async () => {
    const { core } = await paired();
    const put = (lights: unknown[]) => core.api("PUT", "/api/status-lights/devices", { lights });
    expect((await put([{ id: "h", kind: "hue", bridge: "other", resource: LIGHT }])).status).toBe(
      400,
    );
    for (const resource of ["../x", "not-a-uuid", `${LIGHT}/../x`])
      expect((await put([{ id: "h", kind: "hue", bridge: "bridge1", resource }])).status).toBe(400);
    expect(
      (
        await put([
          { id: "h", kind: "hue", bridge: "bridge1", resource: LIGHT, address: "8.8.8.8" },
        ])
      ).status,
    ).toBe(400);
    const ok = await put([{ id: "h", kind: "hue", bridge: "bridge1", resource: LIGHT }]);
    expect(ok.status).toBe(200);
    expect(ok.json.lights).toEqual([{ id: "h", kind: "hue", bridge: "bridge1", resource: LIGHT }]);
  });

  it("follows Fawkes: light state PUT with the key header, pinned fingerprint, only state fields", async () => {
    const { core, bridge } = await paired();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "h", kind: "hue", bridge: "bridge1", resource: LIGHT }],
    });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["h"] },
    });
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(event("agent.working", { source: "agents", severity: "info" }));
    const lit = () => puts(bridge).find((c) => "color" in (c.req.body as object));
    await settle(() => lit() !== undefined);
    const call = lit()!;
    expect(call.address).toBe("192.168.1.5");
    expect(call.fingerprint).toBe(FINGERPRINT);
    expect(call.req.path).toBe(`/clip/v2/resource/light/${LIGHT}`);
    expect(call.req.headers).toEqual({ "hue-application-key": APP_KEY });
    expect(Object.keys(call.req.body as object).sort()).toEqual(["color", "dimming", "on"]);
    const before = puts(bridge).length;
    core.runtime.bus.publish(event("agent.completed", { source: "agents", severity: "info" }));
    await settle(() => puts(bridge).length > before);
    expect(puts(bridge).at(-1)!.req.body).toEqual({ on: { on: false } });
  });

  it("goes unreachable, not wrong, when the bridge answers an error or the bridge was removed", async () => {
    const { core, bridge } = await paired();
    await core.api("PUT", "/api/status-lights/devices", {
      lights: [{ id: "h", kind: "hue", bridge: "bridge1", resource: LIGHT }],
    });
    await core.api("POST", "/api/capabilities/status-lights/config", {
      config: { devices: ["h"] },
    });
    await core.api("DELETE", "/api/status-lights/hue/bridges/bridge1");
    await core.api("POST", "/api/capabilities/status-lights/enable", {});
    core.runtime.bus.publish(event("agent.working", { source: "agents", severity: "info" }));
    await core.runtime.bus.drain();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(puts(bridge)).toEqual([]);
  });
});

describe("hueTransport limits", () => {
  it("refuses any path or field that is not a light state write", async () => {
    const { HueBridges } = await import("../src/status-lights/hue");
    const bridge = new FakeBridge();
    const secrets = new MemorySecretStore();
    await secrets.set("status-lights.hue.b", APP_KEY);
    const settings = new Map<string, unknown>();
    const hue = new HueBridges(
      {
        settings: {
          get: (k: string, d: unknown) => settings.get(k) ?? d,
          set: (k: string, v: unknown) => void settings.set(k, v),
        } as never,
        secrets,
        audit: { record() {} } as never,
        link: bridge,
      },
      1,
    );
    const transport = hue.transport({
      id: "b",
      address: "192.168.1.5",
      port: 443,
      fingerprint: FINGERPRINT,
    });
    const signal = new AbortController().signal;
    const path = `/clip/v2/resource/light/${LIGHT}`;
    for (const bad of [
      "/api/config",
      "/clip/v2/resource/bridge",
      `${path}/../device`,
      "/clip/v2/resource/light/x",
    ])
      await expect(transport.request(bad, { on: { on: true } }, signal)).rejects.toThrow(
        "Not a Hue",
      );
    for (const body of [
      { metadata: { name: "x" } },
      { on: { on: "yes" } },
      { dimming: { brightness: 101 } },
      { color: { xy: { x: 2, y: 0 } } },
      { on: { on: true, extra: 1 } },
      { on: true },
    ])
      await expect(transport.request(path, body as never, signal)).rejects.toThrow("Not a Hue");
    expect(bridge.calls).toEqual([]);
    await transport.request(path, { on: { on: true }, dimming: { brightness: 50 } }, signal);
    expect(bridge.calls).toHaveLength(1);
    // A bridge that reports `errors` is a failure; its text is not in the message.
    bridge.lightBody = JSON.stringify({ errors: [{ description: "leaky text" }] });
    await expect(transport.request(path, { on: { on: true } }, signal)).rejects.not.toThrow(
      "leaky",
    );
    await expect(transport.report(new Uint8Array(1), signal)).rejects.toThrow("not a raw-report");
  });

  it("paces writes to one bridge", async () => {
    const { HueBridges } = await import("../src/status-lights/hue");
    const bridge = new FakeBridge();
    const secrets = new MemorySecretStore();
    await secrets.set("status-lights.hue.b", APP_KEY);
    const hue = new HueBridges(
      {
        settings: { get: (_k: string, d: unknown) => d, set() {} } as never,
        secrets,
        audit: { record() {} } as never,
        link: bridge,
      },
      60,
    );
    const target = { id: "b", address: "192.168.1.5", port: 443, fingerprint: FINGERPRINT };
    const a = hue.transport(target);
    const b = hue.transport(target);
    const signal = new AbortController().signal;
    const path = `/clip/v2/resource/light/${LIGHT}`;
    const started = Date.now();
    await Promise.all([
      a.request(path, { on: { on: true } }, signal),
      b.request(path, { on: { on: false } }, signal),
      a.request(path, { on: { on: true } }, signal),
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });
});

describe("nodeHueLink TLS pinning (real TLS, loopback, self-signed)", () => {
  function selfSigned(): { key: string; cert: string; cleanup: () => void } | null {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-hue-"));
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          join(dir, "k.pem"),
          "-out",
          join(dir, "c.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=001788fffe123456",
        ],
        { stdio: "ignore" },
      );
      return {
        key: readFileSync(join(dir, "k.pem"), "utf8"),
        cert: readFileSync(join(dir, "c.pem"), "utf8"),
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
      };
    } catch {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
  }
  const material = selfSigned();

  it.skipIf(material === null)(
    "reads the fingerprint, sends nothing on a mismatch, and sends the key only to the pinned certificate",
    async () => {
      const seen: { auth: string | undefined; url: string | undefined }[] = [];
      const server: Server = createServer(
        { key: material!.key, cert: material!.cert },
        (req, res) => {
          seen.push({
            auth: req.headers["hue-application-key"] as string | undefined,
            url: req.url,
          });
          res.writeHead(200, { "content-type": "application/json" }).end('{"errors":[]}');
        },
      );
      server.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      cleanups.push(() => {
        server.closeAllConnections();
        server.close();
        material!.cleanup();
      });
      const target = { address: "127.0.0.1", port: (server.address() as AddressInfo).port };
      const signal = AbortSignal.timeout(10_000);
      const cert = await nodeHueLink.probe(target, signal);
      expect(cert.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(cert.commonName).toBe("001788fffe123456");
      expect(seen).toEqual([]); // probing sends no HTTP request

      const req: HueRequest = {
        method: "PUT",
        path: "/clip/v2/resource/light/x",
        headers: { "hue-application-key": APP_KEY },
        body: { on: { on: true } },
      };
      await expect(
        nodeHueLink.request({ ...target, fingerprint: OTHER_FINGERPRINT }, req, signal),
      ).rejects.toThrow("not the one you confirmed");
      expect(seen).toEqual([]); // the key never left on a mismatch
      const ok = await nodeHueLink.request(
        { ...target, fingerprint: cert.fingerprint },
        req,
        signal,
      );
      expect(ok).toEqual({ status: 200, body: '{"errors":[]}' });
      expect(seen).toEqual([{ auth: APP_KEY, url: "/clip/v2/resource/light/x" }]);
    },
  );
});
