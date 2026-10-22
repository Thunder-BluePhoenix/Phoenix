// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalClock } from "../src/agent-approvals";
import { signedRequestText } from "../src/phone-link";
import { RemoteRelayClient, type SignedDecision } from "../src/remote-relay/client";
import { newCoreIdentity, open, seal, type RelayFrame } from "../src/remote-relay/crypto";
import { RemoteRelayDevice } from "../src/remote-relay/device";
import { ReplayWindow, SIGNATURE_WINDOW_MS } from "../src/remote-relay/replay";
import { createRelayServer } from "../../../relay/src/server";
import { startCore, type TestCore } from "./helpers";

/** Time the relay client, the fake device and the phone link all agree on; nothing here waits on a timer. */
class ManualClock implements ApprovalClock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  after(): () => void {
    return () => {};
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

interface Approval {
  source: "confirmation" | "agent";
  id: string;
  request_hash: string;
  tool: string;
  preview: { summary: string };
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Collects the frames an SSE stream delivers and lets a test await the next one. */
async function openStream(
  url: string,
  record: (text: string) => void,
): Promise<{ next(): Promise<RelayFrame> }> {
  const abort = new AbortController();
  cleanups.push(() => abort.abort());
  const response = await fetch(url, { signal: abort.signal });
  const queue: RelayFrame[] = [];
  const waiting: PromiseWithResolvers<RelayFrame>[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      const reader = response.body!.getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const event = pending.slice(0, end);
          pending = pending.slice(end + 2);
          record(event);
          const line = event.split("\n").find((row) => row.startsWith("data: "));
          if (!line) continue;
          const frame = JSON.parse(line.slice(6)) as RelayFrame;
          const slot = waiting.shift();
          if (slot) slot.resolve(frame);
          else queue.push(frame);
        }
      }
    } catch {
      // aborted at cleanup
    }
  })();
  return {
    next() {
      const ready = queue.shift();
      if (ready) return Promise.resolve(ready);
      const slot = Promise.withResolvers<RelayFrame>();
      waiting.push(slot);
      return slot.promise;
    },
  };
}

async function rig(options: { nonces?: { total: number; perDevice: number } } = {}) {
  const clock = new ManualClock(Date.now());
  const core: TestCore = await startCore(
    {},
    { runtime: { phone: { clock, lanAddresses: () => ["127.0.0.1"], port: 0 } } },
  );
  cleanups.push(() => core.runtime.stop());

  const relay: Server = createRelayServer();
  relay.listen(0, "127.0.0.1");
  await once(relay, "listening");
  cleanups.push(() => {
    relay.closeAllConnections();
    relay.close();
  });
  const url = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;

  const route = RemoteRelayClient.newRoute();
  const identity = newCoreIdentity();
  /** Every byte handed to the relay: all it could ever see, apart from the URL. */
  const wire: string[] = [];
  const connected = Promise.withResolvers<void>();
  const recordingFetch: typeof fetch = async (input, init) => {
    if (typeof init?.body === "string") wire.push(init.body);
    const response = await fetch(input, init);
    if (init?.method === undefined) connected.resolve();
    return response;
  };
  const client = new RemoteRelayClient({
    url,
    route,
    corePrivateKey: identity.privateKey,
    devices: core.runtime.phone.devicesStore,
    phone: core.runtime.phone,
    audit: core.runtime.permissions.audit,
    fetcher: recordingFetch,
    clock: () => clock.now(),
    ...options,
  });

  // Errors the client reports for frames it refused; each waiter gets the next one.
  const errors: unknown[] = [];
  let errorWaiter: PromiseWithResolvers<unknown> | null = null;
  const abort = new AbortController();
  cleanups.push(() => abort.abort());
  void client
    .receive(abort.signal, (error) => {
      if (errorWaiter) {
        const slot = errorWaiter;
        errorWaiter = null;
        slot.resolve(error);
      } else errors.push(error);
    })
    .catch(() => {});
  await connected.promise;
  const nextError = (): Promise<unknown> => {
    const ready = errors.shift();
    if (ready) return Promise.resolve(ready);
    errorWaiter = Promise.withResolvers<unknown>();
    return errorWaiter.promise;
  };

  /** Pairs a fake device directly in the store: the pairing handshake itself is Phase 71's. */
  function pairDevice(name = "Remote phone") {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const id = `dev_${randomBytes(6).toString("hex")}`;
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    core.runtime.phone.devicesStore.create({
      id,
      name,
      publicKey,
      createdAt: new Date(clock.now()).toISOString(),
      lastSeenAt: null,
      revokedAt: null,
    });
    return {
      id,
      privateKey,
      publicKey,
      remote: new RemoteRelayDevice(route, id, privateKey, identity.publicKey),
    };
  }

  /** The device end: a stream it reads from the relay and a way to post a frame to Core. */
  async function deviceLink(id: string) {
    const stream = await openStream(`${url}/v1/routes/${route}/peers/${id}`, () => {});
    return {
      stream,
      post: (frame: RelayFrame) =>
        recordingFetch(`${url}/v1/routes/${route}/peers/core`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(frame),
        }),
    };
  }

  /** What a device does with a pushed approvals list. */
  async function approvalsFor(
    device: { id: string; remote: RemoteRelayDevice },
    link: { stream: { next(): Promise<RelayFrame> } },
  ): Promise<Approval[]> {
    await client.pushApprovals(device.id);
    const payload = device.remote.readCore(await link.stream.next(), clock.now()) as {
      type: string;
      approvals: Approval[];
    };
    expect(payload.type).toBe("approvals");
    return payload.approvals;
  }

  function raise(summary: string) {
    const settled = core.runtime.permissions
      .authorize({
        capabilityId: "demo",
        command: "deploy",
        permissions: [],
        sideEffect: "execute",
        summary,
      })
      .then(
        () => "approved" as const,
        () => "rejected" as const,
      );
    const id = core.runtime.permissions
      .pendingConfirmations()
      .find((c) => c.summary === summary)!.id;
    return { id, settled };
  }

  const pending = (id: string) =>
    core.runtime.permissions.pendingConfirmations().some((c) => c.id === id);
  const audit = async () =>
    (await core.api("GET", "/api/audit?limit=1000")).json.entries as {
      actor: string;
      action: string;
      details: Record<string, unknown>;
    }[];

  return {
    clock,
    core,
    relay,
    url,
    route,
    identity,
    wire,
    client,
    nextError,
    pairDevice,
    deviceLink,
    approvalsFor,
    raise,
    pending,
    audit,
  };
}

const body = (
  a: Approval,
  extra: Partial<SignedDecision["body"]> = {},
): SignedDecision["body"] => ({
  id: a.id,
  source: a.source,
  decision: "approve",
  request_hash: a.request_hash,
  user_verification: true,
  ...extra,
});

describe("approving through the relay", () => {
  it("approves a held request end to end, audited as the device, and the relay only ever sees ciphertext", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const secret = `Deploy payroll to production ${randomBytes(4).toString("hex")}`;
    const held = r.raise(secret);

    const approvals = await r.approvalsFor(device, link);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.preview.summary).toBe(secret);

    const decision = device.remote.decision(body(approvals[0]!), r.clock.now());
    expect((await link.post(decision)).status).toBe(202);
    expect(await held.settled).toBe("approved");

    const rows = await r.audit();
    const decided = rows.find((row) => row.action === "phone.approval.decided");
    expect(decided).toMatchObject({
      actor: `device:${device.id}`,
      details: { id: held.id, decision: "approve", user_verification: true },
    });
    expect(rows.some((row) => row.action === "confirmation.approved")).toBe(true);

    // Everything handed to the relay (both directions) is opaque: none of the request's content,
    // hash, decision or the device's signed fields appears in it.
    const onWire = r.wire.join("\n");
    expect(onWire.length).toBeGreaterThan(100);
    for (const plain of [
      secret,
      held.id,
      approvals[0]!.request_hash,
      "approve",
      "request_hash",
      "signature",
      "demo.deploy",
    ]) {
      expect(onWire).not.toContain(plain);
    }
    for (const text of r.wire) {
      const frame = JSON.parse(text) as Record<string, string>;
      expect(Object.keys(frame).sort()).toEqual([
        "ciphertext",
        "ephemeral_key",
        "iv",
        "sender",
        "tag",
      ]);
    }
  });

  it("carries a denial too, and resolves nothing else", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const first = r.raise("Delete the archive");
    const other = r.raise("Send the report");
    const approvals = await r.approvalsFor(device, link);
    const target = approvals.find((a) => a.id === first.id)!;
    await link.post(
      device.remote.decision(
        body(target, { decision: "deny", user_verification: false }),
        r.clock.now(),
      ),
    );
    expect(await first.settled).toBe("rejected");
    expect(r.pending(other.id)).toBe(true);
  });

  it("refuses an approve the phone did not verify, as the phone link does", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const held = r.raise("Rotate credentials");
    const [approval] = await r.approvalsFor(device, link);
    await link.post(
      device.remote.decision(body(approval!, { user_verification: false }), r.clock.now()),
    );
    expect(String(await r.nextError())).toContain("confirm it is you");
    expect(r.pending(held.id)).toBe(true);
  });
});

describe("a revoked device", () => {
  it("is refused on its very next decision and Core stops sending to it", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const held = r.raise("Wipe the scratch disk");
    const [approval] = await r.approvalsFor(device, link);

    expect((await r.core.api("DELETE", `/api/phone/devices/${device.id}`)).status).toBe(200);

    await link.post(device.remote.decision(body(approval!), r.clock.now()));
    expect(String(await r.nextError())).toContain("revoked");
    expect(r.pending(held.id)).toBe(true);
    await expect(r.client.sendToDevice(device.id, { type: "hello" })).rejects.toThrow(/revoked/);
    await expect(r.client.pushApprovals(device.id)).rejects.toThrow(/revoked/);

    const refused = (await r.audit()).filter((row) => row.action === "relay.decision.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      actor: `device:${device.id}`,
      details: { device_id: device.id, reason: "Device not paired or revoked" },
    });
  });

  it("does not hold a revoked device's approvals in escrow: a signed-before-revoke frame is refused after", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const held = r.raise("Merge to main");
    const [approval] = await r.approvalsFor(device, link);
    const frame = device.remote.decision(body(approval!), r.clock.now());
    r.core.runtime.phone.revokeDevice(device.id);
    await link.post(frame);
    expect(String(await r.nextError())).toContain("revoked");
    expect(r.pending(held.id)).toBe(true);
  });

  it("an unknown device id and an unpaired attacker are refused without touching any request", async () => {
    const r = await rig();
    const ghostId = `dev_${randomBytes(6).toString("hex")}`;
    const ghost = new RemoteRelayDevice(
      r.route,
      ghostId,
      generateKeyPairSync("ec", { namedCurve: "prime256v1" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
      r.identity.publicKey,
    );
    const held = r.raise("Install the update");
    const probe = await r.deviceLink(ghostId);
    await probe.post(
      ghost.decision(
        {
          id: held.id,
          source: "confirmation",
          decision: "approve",
          request_hash: "0".repeat(64),
          user_verification: true,
        },
        r.clock.now(),
      ),
    );
    expect(String(await r.nextError())).toContain("not paired");
    expect(r.pending(held.id)).toBe(true);
  });
});

describe("refusal auditing", () => {
  it("caps refusal rows per minute, resumes after it, and never records frame contents", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const intruder = new RemoteRelayDevice(
      r.route,
      device.id,
      generateKeyPairSync("ec", { namedCurve: "prime256v1" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
      r.identity.publicKey,
    );
    const forged = body(
      {
        source: "confirmation",
        id: "x",
        request_hash: "0".repeat(64),
        tool: "t",
        preview: { summary: "s" },
      },
      {},
    );
    const refusals = async () =>
      (await r.audit()).filter((row) => row.action === "relay.decision.refused");
    for (let i = 0; i < 25; i++) {
      await link.post(intruder.decision(forged, r.clock.now()));
      await r.nextError();
    }
    expect(await refusals()).toHaveLength(20);
    r.clock.advance(60_000);
    await link.post(intruder.decision(forged, r.clock.now()));
    await r.nextError();
    expect(await refusals()).toHaveLength(21);
    for (const row of await refusals())
      expect(Object.keys(row.details).sort()).toEqual(["device_id", "reason"]);
  });

  it("refuses a frame sealed to the wrong key without decrypting anything", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    await link.post(seal(r.route, device.id, "core", newCoreIdentity().publicKey, { hello: 1 }));
    expect(String(await r.nextError())).toContain("could not be decrypted");
  });
});

describe("replay", () => {
  it("refuses a recorded frame sent again, even though it still decrypts and verifies", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const first = r.raise("Deploy v2");
    const [a] = await r.approvalsFor(device, link);
    const frame = device.remote.decision(
      body(a!, { decision: "deny", user_verification: false }),
      r.clock.now(),
    );
    await link.post(frame);
    expect(await first.settled).toBe("rejected");

    // A fresh request that the replayed frame's id does not match: the replay must die at the nonce.
    await link.post(frame);
    expect(String(await r.nextError())).toBe("Error: Replayed message");
    expect(
      (await r.audit()).some(
        (row) =>
          row.action === "relay.decision.refused" && row.details.reason === "Replayed message",
      ),
    ).toBe(true);
  });

  it("refuses a fresh signature when its nonce was already used", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const first = r.raise("First");
    const second = r.raise("Second");
    const approvals = await r.approvalsFor(device, link);
    const send = (a: Approval, nonce: string) => {
      const payload = body(a, { decision: "deny", user_verification: false });
      const timestamp = String(r.clock.now());
      const signature = sign(
        "sha256",
        Buffer.from(
          signedRequestText(
            device.id,
            "POST",
            "/remote/v1/decision",
            timestamp,
            nonce,
            Buffer.from(JSON.stringify(payload)),
          ),
        ),
        device.privateKey,
      ).toString("base64");
      return link.post(
        seal(r.route, device.id, "core", r.identity.publicKey, {
          device_id: device.id,
          timestamp,
          nonce,
          signature,
          body: payload,
        } satisfies SignedDecision),
      );
    };
    const nonce = randomBytes(18).toString("base64url");
    await send(
      approvals.find((a) => a.id === first.id)!,
      nonce,
    );
    expect(await first.settled).toBe("rejected");
    await send(
      approvals.find((a) => a.id === second.id)!,
      nonce,
    );
    expect(String(await r.nextError())).toContain("Replayed");
    expect(r.pending(second.id)).toBe(true);
  });

  it("refuses stale and future-dated decisions beyond the signature window", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const held = r.raise("Time travel");
    const [a] = await r.approvalsFor(device, link);
    await link.post(device.remote.decision(body(a!), r.clock.now() - SIGNATURE_WINDOW_MS - 1));
    expect(String(await r.nextError())).toContain("Expired");
    await link.post(device.remote.decision(body(a!), r.clock.now() + SIGNATURE_WINDOW_MS + 1));
    expect(String(await r.nextError())).toContain("Expired");
    expect(r.pending(held.id)).toBe(true);
    // Exactly at the edge is still inside the window.
    await link.post(device.remote.decision(body(a!), r.clock.now() - SIGNATURE_WINDOW_MS));
    expect(await held.settled).toBe("approved");
  });

  it("bounds the replay table per device so one device cannot starve another", async () => {
    const r = await rig({ nonces: { total: 4, perDevice: 2 } });
    const noisy = r.pairDevice("Noisy");
    const quiet = r.pairDevice("Quiet");
    const noisyLink = await r.deviceLink(noisy.id);
    const quietLink = await r.deviceLink(quiet.id);
    const held = r.raise("Capacity");
    const [a] = await r.approvalsFor(noisy, noisyLink);
    const wrong = body(a!, { request_hash: "f".repeat(64) });
    for (let i = 0; i < 2; i++) {
      await noisyLink.post(noisy.remote.decision(wrong, r.clock.now()));
      await r.nextError(); // the gateway refuses the hash; the nonce is spent
    }
    await noisyLink.post(noisy.remote.decision(wrong, r.clock.now()));
    expect(String(await r.nextError())).toContain("capacity");
    await quietLink.post(quiet.remote.decision(body(a!), r.clock.now()));
    expect(await held.settled).toBe("approved");
  });
});

describe("decisions are bound to the exact request", () => {
  it("refuses a hash from another request and a stale hash, leaving the request pending", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const a = r.raise("Request A");
    const b = r.raise("Request B");
    const approvals = await r.approvalsFor(device, link);
    const forA = approvals.find((x) => x.id === a.id)!;
    const forB = approvals.find((x) => x.id === b.id)!;
    expect(forA.request_hash).not.toBe(forB.request_hash);

    // Signed by the device, but the hash it saw was request A's and the id is B's.
    await link.post(
      device.remote.decision(body(forB, { request_hash: forA.request_hash }), r.clock.now()),
    );
    expect(String(await r.nextError())).toContain("not what was shown");
    expect(r.pending(b.id)).toBe(true);
    expect(r.pending(a.id)).toBe(true);

    // The matching hash resolves exactly B and not A.
    await link.post(device.remote.decision(body(forB), r.clock.now()));
    expect(await b.settled).toBe("approved");
    expect(r.pending(a.id)).toBe(true);
    const refusals = (await r.audit()).filter((row) => row.action === "phone.approval.refused");
    expect(refusals.map((row) => row.details.reason)).toEqual(["request_changed"]);
  });

  it("the device signature covers the hash and the id: an in-flight edit fails verification", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const a = r.raise("Request A");
    const b = r.raise("Request B");
    const approvals = await r.approvalsFor(device, link);
    const forA = approvals.find((x) => x.id === a.id)!;
    const forB = approvals.find((x) => x.id === b.id)!;

    // The device approves A. Core's public key is public, so anyone can re-seal an edited copy.
    const original = open(
      r.route,
      "core",
      device.id,
      r.identity.privateKey,
      device.remote.decision(body(forA), r.clock.now()),
    ) as SignedDecision;
    for (const edit of [
      { id: forB.id, request_hash: forB.request_hash },
      { decision: "deny" as const },
      { user_verification: false },
    ]) {
      const forged = { ...original, body: { ...original.body, ...edit } };
      await link.post(seal(r.route, device.id, "core", r.identity.publicKey, forged));
      expect(String(await r.nextError())).toContain("Invalid device signature");
    }
    expect(r.pending(a.id)).toBe(true);
    expect(r.pending(b.id)).toBe(true);
  });

  it("another key cannot speak for the device, and a decision cannot be re-targeted by the path", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    const held = r.raise("Request A");
    const [a] = await r.approvalsFor(device, link);
    const attacker = new RemoteRelayDevice(
      r.route,
      device.id,
      generateKeyPairSync("ec", { namedCurve: "prime256v1" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
      r.identity.publicKey,
    );
    await link.post(attacker.decision(body(a!), r.clock.now()));
    expect(String(await r.nextError())).toContain("Invalid device signature");
    expect(r.pending(held.id)).toBe(true);
  });
});

describe("end-to-end encryption and pinning", () => {
  it("a frame cannot be opened with another route, another recipient or after any bit flip", () => {
    const core = newCoreIdentity();
    const route = RemoteRelayClient.newRoute();
    const frame = seal(route, "dev_000000000001", "core", core.publicKey, { n: 1 });
    expect(open(route, "core", "dev_000000000001", core.privateKey, frame)).toEqual({ n: 1 });
    expect(() =>
      open(RemoteRelayClient.newRoute(), "core", "dev_000000000001", core.privateKey, frame),
    ).toThrow();
    expect(() => open(route, "core", "dev_000000000002", core.privateKey, frame)).toThrow(/sender/);
    expect(() =>
      open(route, "core", "dev_000000000001", newCoreIdentity().privateKey, frame),
    ).toThrow();
    const flipped = Buffer.from(frame.ciphertext, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      open(route, "core", "dev_000000000001", core.privateKey, {
        ...frame,
        ciphertext: flipped.toString("base64"),
      }),
    ).toThrow();
    expect(() =>
      open(route, "core", "dev_000000000001", core.privateKey, { ...frame, sender: "core" }),
    ).toThrow();
  });

  it("a device accepts Core's messages only when signed by the pinned Core key, fresh and once", async () => {
    const r = await rig();
    const device = r.pairDevice();
    const link = await r.deviceLink(device.id);
    await r.client.sendToDevice(device.id, { type: "ping" });
    const frame = await link.stream.next();
    expect(device.remote.readCore(frame, r.clock.now())).toEqual({ type: "ping" });
    // The same frame again is a replay.
    expect(() => device.remote.readCore(frame, r.clock.now())).toThrow(/Replayed/);
    // A relay (or anyone) can seal to the device's public key, but cannot sign as Core.
    const rogue = newCoreIdentity();
    const forged = seal(r.route, "core", device.id, device.publicKey, {
      timestamp: String(r.clock.now()),
      nonce: randomBytes(18).toString("base64url"),
      signature: sign("sha256", Buffer.from("x"), rogue.privateKey).toString("base64"),
      payload: { type: "approvals", approvals: [] },
    });
    expect(() => device.remote.readCore(forged, r.clock.now())).toThrow(/Invalid Core signature/);
    // Fresh but old.
    await r.client.sendToDevice(device.id, { type: "late" });
    const late = await link.stream.next();
    expect(() => device.remote.readCore(late, r.clock.now() + SIGNATURE_WINDOW_MS + 1)).toThrow(
      /Expired/,
    );
  });

  it("refuses a relay URL that is not HTTPS (loopback excepted) or that carries credentials or a route", () => {
    const base = {
      route: RemoteRelayClient.newRoute(),
      corePrivateKey: newCoreIdentity().privateKey,
    };
    const build = (url: string, route = base.route) =>
      new RemoteRelayClient({
        ...base,
        route,
        url,
        devices: undefined as never,
        phone: undefined as never,
      });
    expect(() => build("http://relay.example.com")).toThrow(/HTTPS/);
    expect(() => build("https://user:pw@relay.example.com")).toThrow(/credentials/);
    expect(() => build("https://relay.example.com/?k=1")).toThrow(/credentials/);
    expect(() => build("https://relay.example.com", "short")).toThrow(/route/);
    expect(() => build("https://relay.example.com")).not.toThrow();
    expect(() => build("http://127.0.0.1:9")).not.toThrow();
  });
});

describe("replay window", () => {
  it("keeps a nonce until its timestamp can no longer pass the signature window", () => {
    const window = new ReplayWindow();
    window.claim("dev", "n1", 1_000);
    expect(() => window.claim("dev", "n1", 1_000 + 2 * SIGNATURE_WINDOW_MS)).toThrow(/Replayed/);
    window.claim("dev", "n1", 1_000 + 2 * SIGNATURE_WINDOW_MS + 1);
    expect(window.size).toBe(1);
  });

  it("scopes nonces per peer, caps each peer, and forgets on request", () => {
    const window = new ReplayWindow(5, 2);
    window.claim("a", "n", 0);
    window.claim("b", "n", 0);
    window.claim("a", "m", 0);
    expect(() => window.claim("a", "k", 0)).toThrow(/capacity/);
    window.claim("b", "m", 0);
    window.forget("a");
    window.claim("a", "n", 0);
    window.claim("a", "m", 0);
    expect(() => window.claim("b", "z", 0)).toThrow(/capacity/);
    expect(() => new ReplayWindow(1, 1).claim("a", "n", 0)).not.toThrow();
  });
});
