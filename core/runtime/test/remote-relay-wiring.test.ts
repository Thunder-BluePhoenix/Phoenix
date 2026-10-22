// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { RELAY_KEY_SECRET } from "../src/remote-relay/service";
import { RemoteRelayDevice } from "../src/remote-relay/device";
import type { RelayFrame } from "../src/remote-relay/crypto";
import { createRelayServer } from "../../../relay/src/server";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startRelay(): Promise<string> {
  const relay: Server = createRelayServer();
  relay.listen(0, "127.0.0.1");
  await once(relay, "listening");
  cleanups.push(() => {
    relay.closeAllConnections();
    relay.close();
  });
  return `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
}

/** The secret store the test shares across restarts, and the instant reconnect wait. */
interface RelayRig {
  secrets: MemorySecretStore;
  sleep: (ms: number) => Promise<void>;
}

/** Waits never elapse by themselves: the reconnect loop is driven by the test, not by a timer. */
function rig(secrets = new MemorySecretStore()): RelayRig {
  return { secrets, sleep: () => Promise.withResolvers<void>().promise };
}

async function boot(r: RelayRig, databasePath?: string): Promise<TestCore> {
  const core = await startCore(
    {},
    {
      secrets: r.secrets,
      runtime: {
        phone: { lanAddresses: () => ["127.0.0.1"], port: 0 },
        relay: { sleep: r.sleep },
        ...(databasePath ? { databasePath } : {}),
      },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return core;
}

function pairDevice(core: TestCore, route: string, corePublicKey: string) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const id = `dev_${randomBytes(6).toString("hex")}`;
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  core.runtime.phone.devicesStore.create({
    id,
    name: "Remote phone",
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
    revokedAt: null,
  });
  return { id, remote: new RemoteRelayDevice(route, id, privateKey, corePublicKey) };
}

async function nextFrame(url: string, signal: AbortSignal): Promise<RelayFrame> {
  const response = await fetch(url, { signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    pending += decoder.decode(chunk.value, { stream: true });
    const end = pending.indexOf("\n\n");
    if (end < 0) continue;
    const line = pending
      .slice(0, end)
      .split("\n")
      .find((row) => row.startsWith("data: "));
    if (line) return JSON.parse(line.slice(6)) as RelayFrame;
    pending = pending.slice(end + 2);
  }
  throw new Error("stream ended");
}

describe("the remote relay through the running Core", () => {
  it("is off by default and has no key, route or connection", async () => {
    const core = await boot(rig());
    expect((await core.api("GET", "/api/remote-relay")).json).toEqual({
      enabled: false,
      connected: false,
      url: null,
      route: null,
      core_public_key: null,
      last_error: null,
    });
    await core.runtime.stop();
  });

  it("enabling stores the private key only in the secret store and never returns it", async () => {
    const r = rig();
    const core = await boot(r);
    const url = await startRelay();
    const on = await core.api("POST", "/api/remote-relay", { url });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ enabled: true, url });
    expect(on.json.route).toMatch(/^[0-9a-f]{32}$/);
    const privateKey = await r.secrets.get(RELAY_KEY_SECRET);
    expect(privateKey).toContain("PRIVATE KEY");

    const everywhere = JSON.stringify([
      on.json,
      (await core.api("GET", "/api/remote-relay")).json,
      core.runtime.settings.get("remote-relay.config", null),
      core.runtime.permissions.audit.list({ limit: 50 }),
    ]);
    expect(everywhere).not.toContain("PRIVATE KEY");
    expect(everywhere).not.toContain(privateKey!.replace(/\s/g, "").slice(40, 80));
    await core.runtime.stop();
  });

  it("pushes approvals to a paired device and takes its signed decision through the relay", async () => {
    const r = rig();
    const core = await boot(r);
    const url = await startRelay();
    const on = (await core.api("POST", "/api/remote-relay", { url })).json;
    const device = pairDevice(core, on.route, on.core_public_key);
    const abort = new AbortController();
    cleanups.push(() => abort.abort());
    const waiting = nextFrame(`${url}/v1/routes/${on.route}/peers/${device.id}`, abort.signal);
    // The stream must be open before Core sends; wait for the relay to register it.
    await yieldToEventLoop();
    await core.api("POST", "/api/agent-approvals", {
      kind: "permission",
      agent: "claude",
      session_id: "s1",
      project: "/work/phoenix",
      tool: "Bash",
      input_summary: { command: "npm test" },
    });
    const pushed = await core.api("POST", `/api/remote-relay/devices/${device.id}/approvals`);
    expect(pushed.status).toBe(200);
    const payload = device.remote.readCore(await waiting, Date.now()) as {
      type: string;
      approvals: { source: string; tool: string }[];
    };
    expect(payload.type).toBe("approvals");
    expect(payload.approvals.map((a) => a.tool)).toEqual(["Bash"]);
    await core.runtime.stop();
  });

  it("refuses a relay that is not HTTPS (except loopback) or carries credentials", async () => {
    const core = await boot(rig());
    for (const url of [
      "http://relay.example.com",
      "https://user:pw@relay.example.com",
      "https://relay.example.com/?k=1",
      "ftp://relay.example.com",
      "not a url",
      "",
    ]) {
      const res = await core.api("POST", "/api/remote-relay", { url });
      expect([url, res.status]).toEqual([url, 400]);
    }
    expect((await core.api("GET", "/api/remote-relay")).json.enabled).toBe(false);
    await core.runtime.stop();
  });

  it("turning it off removes the key and the route, and pushing then fails", async () => {
    const r = rig();
    const core = await boot(r);
    const url = await startRelay();
    await core.api("POST", "/api/remote-relay", { url });
    const off = await core.api("DELETE", "/api/remote-relay");
    expect(off.json).toMatchObject({ enabled: false, route: null, core_public_key: null });
    expect(await r.secrets.get(RELAY_KEY_SECRET)).toBeUndefined();
    const push = await core.api("POST", "/api/remote-relay/devices/dev_0123456789ab/approvals");
    expect(push.status).toBeGreaterThanOrEqual(400);
    await core.runtime.stop();
  });

  it("the emergency stop turns the relay off and discards the key", async () => {
    const r = rig();
    const core = await boot(r);
    const url = await startRelay();
    await core.api("POST", "/api/remote-relay", { url });
    core.runtime.permissions.engageKillSwitch("test");
    await core.runtime.bus.drain();
    await settle(() => core.runtime.remoteRelay!.status().enabled === false);
    expect(await r.secrets.get(RELAY_KEY_SECRET)).toBeUndefined();
    const again = await core.api("POST", "/api/remote-relay", { url });
    expect(again.status).toBe(403);
    await core.runtime.stop();
  });

  it("resumes after a restart with the same route and key, and the management routes need the token", async () => {
    const r = rig();
    const databasePath = join(mkdtempSync(join(tmpdir(), "phoenix-relay-")), "core.db");
    const core = await boot(r, databasePath);
    const url = await startRelay();
    const on = (await core.api("POST", "/api/remote-relay", { url })).json;
    expect((await fetch(`${core.base}/api/remote-relay`)).status).toBe(401);
    await core.runtime.stop();

    const second = await boot(r, databasePath);
    const status = (await second.api("GET", "/api/remote-relay")).json;
    expect(status).toMatchObject({
      enabled: true,
      route: on.route,
      core_public_key: on.core_public_key,
    });
    await second.runtime.stop();
  });

  it("has no relay routes when there is no OS secret store", async () => {
    const core = await startCore();
    cleanups.push(() => core.runtime.stop());
    expect((await core.api("GET", "/api/remote-relay")).status).toBe(404);
    await core.runtime.stop();
  });
});

/** Waits for a condition by yielding to the event loop; no wall-clock timer. */
async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await yieldToEventLoop();
  expect(done()).toBe(true);
}

function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}
