// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { once } from "node:events";
import { request as httpsRequest } from "node:https";
import { connect as netConnect, type Socket } from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { PhoneThrottledError, type PhoneAuthRequest } from "@phoenix/api";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger, type LogRecord } from "@phoenix/logging";
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalClock } from "../src/agent-approvals";
import {
  AUTH_FAILURES_PER_MINUTE,
  lanAddressesFrom,
  LOCKOUT_MS,
  MAX_NONCES_PER_DEVICE,
  MAX_WRONG_CODES,
  MAX_WRONG_CODES_PER_CODE,
  PAIRING_TTL_MS,
  requestHash,
  previewHash,
  type PhoneLinkTuning,
} from "../src/phone-link";
import { FakePhone } from "./phone-client";
import { startCore, TOKEN, type TestCore } from "./helpers";

/** Time the phone link sees; nothing in these tests waits on a real timer. */
class ManualClock implements ApprovalClock {
  private current: number;
  private readonly timers: { at: number; fn: () => void; live: boolean }[] = [];
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.current + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  advance(ms: number): void {
    this.current += ms;
    for (const t of this.timers) {
      if (t.live && t.at <= this.current) {
        t.live = false;
        t.fn();
      }
    }
  }
}

interface Status {
  enabled: boolean;
  listening: boolean;
  address: string | null;
  port: number | null;
  fingerprint: string | null;
  require_user_verification: boolean;
  kill_switch: boolean;
  pairing: { expires_at: string } | null;
  pending_pair: {
    name: string;
    key_fingerprint: string;
    confirmation_id: string | null;
  } | null;
  locked_out_until: string | null;
  devices: number;
}

interface Approval {
  source: "confirmation" | "agent";
  id: string;
  tool: string;
  title: string;
  preview: Record<string, unknown>;
  preview_hash: string;
  expires_at: string;
  request_hash: string;
}

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});

async function rig(tuning: PhoneLinkTuning = {}) {
  const clock = new ManualClock(Date.now());
  const logs: LogRecord[] = [];
  const core = await startCore(
    {},
    {
      logger: createLogger({ level: "debug", sink: (r) => logs.push(r) }),
      runtime: { phone: { clock, lanAddresses: () => ["127.0.0.1"], port: 0, ...tuning } },
    },
  );
  cores.push(core);
  const status = async (): Promise<Status> => (await core.api("GET", "/api/phone/status")).json;
  const enable = async (): Promise<Status> =>
    (await core.api("POST", "/api/phone/settings", { enabled: true })).json;

  /** A phone that pins the fingerprint the desktop shows and pairs through the whole flow. */
  async function pairedPhone(name = "Test phone", approve = true) {
    const on = await status();
    const info = on.listening ? on : await enable();
    const phone = new FakePhone("127.0.0.1", info.port!, info.fingerprint, () => clock.now());
    const pairing = (await core.api("POST", "/api/phone/pairing")).json;
    const reply = await phone.pair(pairing.code, name);
    expect(reply.status).toBe(200);
    const confirmation = (await status()).pending_pair!.confirmation_id!;
    expect((await core.api("POST", `/api/confirmations/${confirmation}`, { approve })).status).toBe(
      200,
    );
    const done = await phone.pairStatus(reply.json.pair_id as string);
    if (approve) phone.deviceId = done.json.device_id as string;
    return { phone, pairing, done };
  }

  /** A held permission request as a capability would raise it. */
  function raise(summary: string) {
    const outcome = core.runtime.permissions.authorize({
      capabilityId: "demo",
      command: "deploy",
      permissions: [],
      sideEffect: "execute",
      summary,
    });
    const settled = outcome.then(
      () => "approved" as const,
      () => "rejected" as const,
    );
    const pending = core.runtime.permissions
      .pendingConfirmations()
      .find((c) => c.capabilityId === "demo" && c.summary === summary)!;
    return { id: pending.id, settled };
  }

  const audit = async () =>
    (await core.api("GET", "/api/audit?limit=1000")).json.entries as {
      actor: string;
      action: string;
      details: Record<string, unknown>;
    }[];

  return { core, clock, logs, status, enable, pairedPhone, raise, audit };
}

/** A well-formed pairing body for calling `pair()` directly with a chosen remote address. */
const pairBody = (code: string) => ({
  code,
  name: "Direct caller",
  public_key: new FakePhone("127.0.0.1", 0, null, () => 0).publicKey,
});

const bodyOf = (a: Approval, extra: Record<string, unknown> = {}) => ({
  id: a.id,
  source: a.source,
  decision: "approve",
  request_hash: a.request_hash,
  user_verification: true,
  ...extra,
});

describe("off by default", () => {
  it("binds nothing, writes no certificate and refuses to pair until the user enables it", async () => {
    const r = await rig();
    const s = await r.status();
    expect(s).toMatchObject({
      enabled: false,
      listening: false,
      port: null,
      address: null,
      fingerprint: null,
      require_user_verification: true,
    });
    expect((await r.core.api("POST", "/api/phone/pairing")).status).toBe(503);
    expect(existsSync(join(r.core.dataDir, "phone"))).toBe(false);
  });

  it("enabling opens a separate listener whose certificate is the fingerprint pairing reports", async () => {
    const r = await rig();
    const on = await r.enable();
    expect(on).toMatchObject({ enabled: true, listening: true, address: "127.0.0.1" });
    expect(on.port).not.toBe(r.core.port); // never the loopback API port
    const pairing = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect(pairing.fingerprint).toBe(on.fingerprint);
    expect(pairing.uri).toContain(encodeURIComponent(on.fingerprint!));
    expect(pairing.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const reply = await phone.raw("GET", "/phone/v1/pair/pair_x", {});
    expect(reply.peerFingerprint).toBe(pairing.fingerprint);
    // A phone pinned to some other fingerprint refuses to talk at all.
    const wrong = new FakePhone("127.0.0.1", on.port!, "AA:BB", () => r.clock.now());
    await expect(wrong.raw("GET", "/phone/v1/pair/pair_x", {})).rejects.toThrow(/pin/);
  });

  it("disabling closes the listener and forgets a code that was shown", async () => {
    const r = await rig();
    const on = await r.enable();
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    await r.core.api("POST", "/api/phone/settings", { enabled: false });
    expect((await r.status()).listening).toBe(false);
    await expect(phone.pair(code, "late")).rejects.toThrow();
    const again = await r.enable();
    const reopened = new FakePhone("127.0.0.1", again.port!, again.fingerprint, () =>
      r.clock.now(),
    );
    expect((await reopened.pair(code, "late")).status).toBe(403); // the old code died with the listener
  });
});

describe("pairing", () => {
  it("a person confirms 'Pair <name>?' with the key fingerprint, and the device gets an id", async () => {
    const r = await rig();
    const { phone, done } = await r.pairedPhone("Ada's <b>phone</b>");
    expect(done.json).toMatchObject({ status: "approved" });
    expect(phone.deviceId).toMatch(/^dev_[0-9a-f]{12}$/);
    const devices = (await r.core.api("GET", "/api/phone/devices")).json.devices;
    expect(devices).toEqual([
      expect.objectContaining({ id: phone.deviceId, name: "Ada's <b>phone</b>", revoked_at: null }),
    ]);
    expect(devices[0].key_fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(JSON.stringify(devices)).not.toContain(phone.publicKey);
    expect((await r.core.api("GET", "/api/privacy")).json.derived).toContainEqual(
      expect.objectContaining({ id: "phone_devices", count: 1 }),
    );
  });

  it("shows the name and key fingerprint in the confirmation and creates nothing if refused", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    const reply = await phone.pair(code, "Kitchen tablet");
    const pending = (await r.status()).pending_pair!;
    expect(pending.name).toBe("Kitchen tablet");
    expect(pending.key_fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const confirmations = (await r.core.api("GET", "/api/confirmations")).json.confirmations;
    expect(confirmations).toContainEqual(
      expect.objectContaining({
        id: pending.confirmation_id,
        summary: `Pair phone "Kitchen tablet"? Key fingerprint ${pending.key_fingerprint}`,
      }),
    );
    await r.core.api("POST", `/api/confirmations/${pending.confirmation_id}`, { approve: false });
    expect((await phone.pairStatus(reply.json.pair_id as string)).json).toEqual({
      status: "denied",
    });
    expect((await r.core.api("GET", "/api/phone/devices")).json.devices).toEqual([]);
  });

  it("a pairing nobody confirms expires and withdraws the prompt", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    const reply = await phone.pair(code, "Slow");
    r.clock.advance(PAIRING_TTL_MS + 1);
    await new Promise((resolve) => setImmediate(resolve));
    expect((await phone.pairStatus(reply.json.pair_id as string)).json).toEqual({
      status: "expired",
    });
    expect((await r.status()).pending_pair).toBeNull();
    expect(r.core.runtime.permissions.pendingConfirmations()).toEqual([]);
    expect((await r.core.api("GET", "/api/phone/devices")).json.devices).toEqual([]);
  });

  it("a pairing code works once", async () => {
    const r = await rig();
    const { phone, pairing } = await r.pairedPhone();
    const intruder = new FakePhone("127.0.0.1", phone.port, phone.pinnedFingerprint, () =>
      r.clock.now(),
    );
    expect((await intruder.pair(pairing.code, "Replayer")).status).toBe(403);
    expect((await r.status()).pending_pair).toBeNull();
  });

  it("a pairing code expires", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    r.clock.advance(PAIRING_TTL_MS + 1);
    expect((await r.status()).pairing).toBeNull();
    expect((await phone.pair(code, "Late")).status).toBe(403);
  });

  it("locks one address out after too many wrong codes, but leaves the live code and other addresses alone", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const live = (await r.core.api("POST", "/api/phone/pairing")).json;
    for (let i = 0; i < MAX_WRONG_CODES; i++)
      expect((await phone.pair("AAAA-AAAA-AAAA", "Guesser")).status).toBe(403);
    const blocked = await phone.pair(live.code, "Right code, locked address");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    // Pairing as a whole is not locked and the code the user is showing still lives.
    expect((await r.status()).locked_out_until).toBeNull();
    expect((await r.status()).pairing).not.toBeNull();
    expect(() => r.core.runtime.phone.pair(pairBody(live.code), "192.0.2.77")).not.toThrow();
    r.clock.advance(LOCKOUT_MS + 1);
    expect((await phone.pair("AAAA-AAAA-AAAA", "After the wait")).status).toBe(403);
  });

  it("bad posts while no pairing is active count for nothing: they neither lock pairing nor spoil the next code", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    for (let i = 0; i < MAX_WRONG_CODES * 4; i++)
      expect((await phone.pair("AAAA-AAAA-AAAA", "Noise")).status).toBe(403);
    expect((await r.status()).locked_out_until).toBeNull();
    const fresh = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect((await phone.pair(fresh.code, "Right after the noise")).status).toBe(200);
  });

  it("one address's bad posts against a live code do not kill it for the user's phone", async () => {
    const r = await rig();
    await r.enable();
    const live = (await r.core.api("POST", "/api/phone/pairing")).json;
    for (let i = 0; i < MAX_WRONG_CODES; i++)
      expect(() => r.core.runtime.phone.pair(pairBody("AAAA-AAAA-AAAA"), "192.0.2.1")).toThrow(
        /invalid or expired/,
      );
    expect(() => r.core.runtime.phone.pair(pairBody("AAAA-AAAA-AAAA"), "192.0.2.1")).toThrow(
      PhoneThrottledError,
    );
    expect((await r.status()).locked_out_until).toBeNull();
    expect(r.core.runtime.phone.pair(pairBody(live.code), "192.0.2.2").status).toBe("pending");
  });

  it("many addresses together cannot grind one live code: the budget destroys it and pauses pairing", async () => {
    const r = await rig();
    await r.enable();
    const live = (await r.core.api("POST", "/api/phone/pairing")).json;
    const guesses = MAX_WRONG_CODES_PER_CODE + 1;
    for (let i = 0; i < guesses; i++) {
      expect(() =>
        r.core.runtime.phone.pair(
          pairBody("AAAA-AAAA-AAAA"),
          `192.0.2.${10 + Math.floor(i / MAX_WRONG_CODES)}`,
        ),
      ).toThrow(/invalid or expired/);
    }
    expect((await r.status()).locked_out_until).not.toBeNull();
    expect((await r.status()).pairing).toBeNull();
    expect(() => r.core.runtime.phone.pair(pairBody(live.code), "192.0.2.200")).toThrow(
      PhoneThrottledError,
    );
    r.clock.advance(LOCKOUT_MS + 1);
    const later = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect(r.core.runtime.phone.pair(pairBody(later.code), "192.0.2.200").status).toBe("pending");
  });

  it("rejects a malformed key or name without spending a second try", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect((await phone.pair(code, "ok", "bm90IGEga2V5")).status).toBe(400);
    expect((await r.core.api("GET", "/api/phone/devices")).json.devices).toEqual([]);
    const second = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect((await phone.pair(second.code, "bad\u202Ename")).status).toBe(400);
  });
});

describe("device-signed requests", () => {
  it("accepts a correctly signed request and records last_seen", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const reply = await phone.signed("GET", "/phone/v1/whoami");
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      device_id: phone.deviceId,
      require_user_verification: true,
    });
    const row = (await r.core.api("GET", "/api/phone/devices")).json.devices[0];
    expect(row.last_seen_at).not.toBeNull();
  });

  it("refuses the replay of a signed request", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const headers = phone.headersFor("GET", "/phone/v1/whoami", "");
    expect((await phone.raw("GET", "/phone/v1/whoami", headers)).status).toBe(200);
    const replay = await phone.raw("GET", "/phone/v1/whoami", headers);
    expect(replay.status).toBe(401);
    // The same nonce with a fresh signature over a later time is still a replay of the nonce.
    const nonce = headers["x-phoenix-nonce"];
    r.clock.advance(1_000);
    expect((await phone.signed("GET", "/phone/v1/whoami", undefined, { nonce })).status).toBe(401);
  });

  it("refuses a tampered body, a different path or method, and another key", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    expect(approval!.id).toBe(a.id);
    // Signed for one body, delivered with another.
    const tampered = await phone.decide(bodyOf(approval!), {
      sentBody: JSON.stringify(bodyOf(approval!, { decision: "deny" })),
    });
    expect(tampered.status).toBe(401);
    // Signed for GET /approvals, sent to /whoami.
    const headers = phone.headersFor("GET", "/phone/v1/approvals", "");
    expect((await phone.raw("GET", "/phone/v1/whoami", headers)).status).toBe(401);
    // The right device id with someone else's key.
    const other = new FakePhone("127.0.0.1", phone.port, phone.pinnedFingerprint, () =>
      r.clock.now(),
    );
    other.deviceId = phone.deviceId;
    expect((await other.signed("GET", "/phone/v1/whoami")).status).toBe(401);
    expect(r.core.runtime.permissions.pendingConfirmations().map((c) => c.id)).toContain(a.id);
  });

  it("refuses a request outside the clock window and one with missing headers", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const stale = await phone.signed("GET", "/phone/v1/whoami", undefined, {
      timestamp: r.clock.now() - 61_000,
    });
    expect(stale.status).toBe(401);
    expect((await phone.raw("GET", "/phone/v1/whoami", {})).status).toBe(401);
    const unknown = await phone.signed("GET", "/phone/v1/whoami", undefined, {
      deviceId: "dev_000000000000",
    });
    expect(unknown.status).toBe(401);
  });

  it("slows a client that keeps failing, and audits the failures without keys", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    for (let i = 0; i < AUTH_FAILURES_PER_MINUTE; i++)
      expect((await phone.raw("GET", "/phone/v1/whoami", {})).status).toBe(401);
    const limited = await phone.signed("GET", "/phone/v1/whoami");
    expect(limited.status).toBe(429);
    r.clock.advance(61_000);
    expect((await phone.signed("GET", "/phone/v1/whoami")).status).toBe(200);
    const failures = (await r.audit()).filter((e) => e.action === "phone.auth.failed");
    expect(failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(failures)).not.toContain(phone.publicKey);
  });
});

describe("revocation", () => {
  it("a revoked device fails at once, with the same valid-looking request", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const headers = phone.headersFor("GET", "/phone/v1/whoami", "");
    expect((await r.core.api("DELETE", `/api/phone/devices/${phone.deviceId}`)).status).toBe(200);
    expect((await phone.raw("GET", "/phone/v1/whoami", headers)).status).toBe(401);
    expect((await phone.signed("GET", "/phone/v1/approvals")).status).toBe(401);
    const row = (await r.core.api("GET", "/api/phone/devices")).json.devices[0];
    expect(row.revoked_at).not.toBeNull();
    expect((await r.core.api("DELETE", `/api/phone/devices/${phone.deviceId}`)).status).toBe(404);
    const events = await r.audit();
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "phone.device.revoked",
        details: { device_id: phone.deviceId },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "phone.auth.failed",
        details: expect.objectContaining({ reason: "revoked", device_id: phone.deviceId }),
      }),
    );
  });

  it("a revoked device identity stays dead (it is not revived by anything but a new confirmed pairing)", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    await r.core.api("DELETE", `/api/phone/devices/${phone.deviceId}`);
    expect((await phone.signed("GET", "/phone/v1/whoami")).status).toBe(401);
  });

  it("deleting all phone data forgets the devices and closes the listener", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const res = await r.core.api("POST", "/api/privacy/delete", { data: "phone", confirm: true });
    expect(res.json).toEqual({ deleted: 1 });
    // The socket may already be closed (refused) or still answer: either way not with success.
    const after = await phone.signed("GET", "/phone/v1/whoami").catch(() => null);
    expect(after === null || after.status === 401).toBe(true);
    // A no-op configure queues behind the listener shutdown deleteAll started.
    await r.core.runtime.phone.configure({});
    expect(await r.status()).toMatchObject({ enabled: false, listening: false, devices: 0 });
  });
});

describe("approvals bound to the exact request", () => {
  it("lists pending confirmations and agent approvals, but never the phone's own pairing prompt", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const agent = (
      await r.core.api("POST", "/api/agent-approvals", {
        kind: "permission",
        agent: "claude",
        session_id: "s1",
        project: "/work/phoenix",
        tool: "Bash",
        input_summary: { command: "npm test" },
      })
    ).json;
    const onPhone = await r.status();
    expect(onPhone.pending_pair).toBeNull();
    const list = (await phone.approvals()).json.approvals as Approval[];
    expect(list.map((x) => `${x.source}:${x.id}`).sort()).toEqual(
      [`confirmation:${a.id}`, `agent:${agent.id}`].sort(),
    );
    for (const item of list) {
      expect(item.request_hash).toBe(
        requestHash({
          source: item.source,
          id: item.id,
          tool: item.tool,
          preview_hash: previewHash(item.preview),
          expires_at: item.expires_at,
        }),
      );
    }
    // A pairing prompt raised while the phone is connected is invisible to it and cannot be answered.
    const second = new FakePhone("127.0.0.1", phone.port, phone.pinnedFingerprint, () =>
      r.clock.now(),
    );
    const code = (await r.core.api("POST", "/api/phone/pairing")).json.code;
    await second.pair(code, "Another");
    const pairId = (await r.status()).pending_pair!.confirmation_id!;
    expect(
      ((await phone.approvals()).json.approvals as Approval[]).some((x) => x.id === pairId),
    ).toBe(false);
    const forged = await phone.decide({
      id: pairId,
      source: "confirmation",
      decision: "approve",
      request_hash: "0".repeat(64),
      user_verification: true,
    });
    expect(forged.status).toBe(404);
    expect((await r.status()).pending_pair).not.toBeNull();
  });

  it("approves through the audited gateway path as device:<id>, with the verification claim recorded", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    const reply = await phone.decide(bodyOf(approval!));
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ id: a.id, source: "confirmation", decision: "approve" });
    expect(await a.settled).toBe("approved");
    const entries = await r.audit();
    expect(entries).toContainEqual(
      expect.objectContaining({
        actor: `device:${phone.deviceId}`,
        action: "confirmation.approved",
        details: expect.objectContaining({ confirmationId: a.id }),
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        actor: `device:${phone.deviceId}`,
        action: "phone.approval.decided",
        details: expect.objectContaining({
          id: a.id,
          decision: "approve",
          user_verification: true,
          request_hash: approval!.request_hash,
        }),
      }),
    );
  });

  it("approves and denies agent approvals through the agent path", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const make = async (command: string) =>
      (
        await r.core.api("POST", "/api/agent-approvals", {
          kind: "permission",
          agent: "claude",
          session_id: "s1",
          project: "/work/phoenix",
          tool: "Bash",
          input_summary: { command },
        })
      ).json;
    const yes = await make("npm test");
    const no = await make("rm -rf build");
    const list = (await phone.approvals()).json.approvals as Approval[];
    const yesView = list.find((x) => x.id === yes.id)!;
    const noView = list.find((x) => x.id === no.id)!;
    expect((await phone.decide(bodyOf(yesView))).status).toBe(200);
    expect(
      (await phone.decide(bodyOf(noView, { decision: "deny", user_verification: false }))).status,
    ).toBe(200);
    const history = (await r.core.api("GET", "/api/agent-approvals/history")).json.history;
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: yes.id,
          outcome: "allow",
          client: `device:${phone.deviceId}`,
        }),
        expect.objectContaining({ id: no.id, outcome: "deny", client: `device:${phone.deviceId}` }),
      ]),
    );
  });

  it("refuses an approval whose request hash is not the request as it is now", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const first = r.raise("Deploy the thing");
    const second = r.raise("Delete the database");
    const list = (await phone.approvals()).json.approvals as Approval[];
    const a = list.find((x) => x.id === first.id)!;
    const b = list.find((x) => x.id === second.id)!;
    // The phone showed (and hashed) something else: changed summary...
    const changed = requestHash({
      source: a.source,
      id: a.id,
      tool: a.tool,
      preview_hash: previewHash({ ...a.preview, summary: "Something harmless" }),
      expires_at: a.expires_at,
    });
    expect((await phone.decide(bodyOf(a, { request_hash: changed }))).status).toBe(403);
    // ...the hash of another request that really is pending...
    expect((await phone.decide(bodyOf(a, { request_hash: b.request_hash }))).status).toBe(403);
    // ...or a different expiry.
    const moved = requestHash({
      source: a.source,
      id: a.id,
      tool: a.tool,
      preview_hash: a.preview_hash,
      expires_at: new Date(Date.parse(a.expires_at) + 1000).toISOString(),
    });
    expect((await phone.decide(bodyOf(a, { request_hash: moved }))).status).toBe(403);
    expect(r.core.runtime.permissions.pendingConfirmations().map((c) => c.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    const refusals = (await r.audit()).filter((e) => e.action === "phone.approval.refused");
    expect(refusals).toHaveLength(3);
    expect(refusals[0]!.details).toMatchObject({ reason: "request_changed" });
  });

  it("refuses an expired request and a second approval of the same one", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    expect((await phone.decide(bodyOf(approval!))).status).toBe(200);
    const again = await phone.decide(bodyOf(approval!));
    expect(again.status).toBe(404);
    expect(await a.settled).toBe("approved");

    const late = r.raise("Deploy something later");
    const [lateView] = ((await phone.approvals()).json.approvals as Approval[]).filter(
      (x) => x.id === late.id,
    );
    r.clock.advance(10 * 60_000);
    const expired = await phone.decide(bodyOf(lateView!));
    expect(expired.status).toBe(504);
    expect(r.core.runtime.permissions.pendingConfirmations().map((c) => c.id)).toContain(late.id);
  });

  it("refuses an approve without the user-verification claim while it is required, but never a deny", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    for (const claim of [false, undefined]) {
      const body = bodyOf(approval!, claim === undefined ? {} : { user_verification: claim });
      if (claim === undefined) delete (body as Record<string, unknown>).user_verification;
      const refused = await phone.decide(body);
      expect(refused.status).toBe(403);
    }
    expect(r.core.runtime.permissions.pendingConfirmations().map((c) => c.id)).toContain(a.id);
    const deny = await phone.decide(
      bodyOf(approval!, { decision: "deny", user_verification: false }),
    );
    expect(deny.status).toBe(200);
    expect(await a.settled).toBe("rejected");
    const entry = (await r.audit()).find(
      (e) => e.action === "phone.approval.decided" && e.details.decision === "deny",
    );
    expect(entry!.details).toMatchObject({ user_verification: false });
  });

  it("accepts an approve without the claim once the user turns the requirement off", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const set = await r.core.api("POST", "/api/phone/settings", {
      require_user_verification: false,
    });
    expect(set.json.require_user_verification).toBe(false);
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    expect((await phone.decide(bodyOf(approval!, { user_verification: false }))).status).toBe(200);
    expect(await a.settled).toBe("approved");
    const entry = (await r.audit()).find((e) => e.action === "phone.approval.decided");
    expect(entry!.details).toMatchObject({ user_verification: false });
  });

  it("rejects malformed decisions", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    for (const bad of [
      { ...bodyOf(approval!), decision: "maybe" },
      { ...bodyOf(approval!), source: "other" },
      { ...bodyOf(approval!), request_hash: "short" },
      { ...bodyOf(approval!), extra: 1 },
      { ...bodyOf(approval!), user_verification: "yes" },
    ])
      expect((await phone.decide(bad)).status, JSON.stringify(bad)).toBe(400);
    expect(r.core.runtime.permissions.pendingConfirmations().map((c) => c.id)).toContain(a.id);
  });
});

describe("isolation from the loopback API", () => {
  it("the session token does nothing on the LAN listener", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const bearer = { authorization: `Bearer ${TOKEN}` };
    for (const path of ["/phone/v1/whoami", "/phone/v1/approvals"])
      expect((await phone.raw("GET", path, bearer)).status).toBe(401);
    expect((await phone.raw("GET", "/api/health", bearer)).status).toBe(404);
    expect((await phone.raw("GET", "/api/confirmations", bearer)).status).toBe(404);
    expect(
      (await phone.raw("POST", "/api/phone/settings", bearer, JSON.stringify({ enabled: false })))
        .status,
    ).toBe(404);
    expect((await r.status()).enabled).toBe(true);
  });

  it("device signatures do nothing on the loopback API", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    for (const path of ["/api/confirmations", "/api/phone/devices", "/api/agent-approvals"]) {
      const res = await fetch(r.core.base + path, {
        headers: phone.headersFor("GET", path, ""),
      });
      expect(res.status, path).toBe(401);
    }
    const revoke = await fetch(`${r.core.base}/api/phone/devices/${phone.deviceId}`, {
      method: "DELETE",
      headers: phone.headersFor("DELETE", `/api/phone/devices/${phone.deviceId}`, ""),
    });
    expect(revoke.status).toBe(401);
    expect((await phone.signed("GET", "/phone/v1/whoami")).status).toBe(200);
  });

  it("exposes only the five /phone/v1 routes: no loopback route, static file, listing or socket", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const paths = [
      "/",
      "/index.html",
      "/api/health",
      "/api/phone/status",
      "/api/ws",
      "/phone",
      "/phone/",
      "/phone/v1",
      "/phone/v1/",
      "/phone/v1/whoami/extra",
      "/phone/v1/../../api/health",
      "/phone/v1/pair/../approvals",
      "/%2e%2e/api/health",
    ];
    for (const path of paths) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const reply = await phone.raw(
          method,
          path,
          phone.headersFor(method, path, method === "POST" ? "{}" : ""),
          method === "POST" ? "{}" : undefined,
        );
        expect([404, 400], `${method} ${path}`).toContain(reply.status);
        expect(JSON.stringify(reply.json)).not.toMatch(/<html|index\.html|directory/i);
      }
    }
    // Wrong method on a real route is also a plain 404: nothing more to learn.
    expect((await phone.raw("POST", "/phone/v1/whoami", {}, "{}")).status).toBe(404);
    expect((await phone.raw("OPTIONS", "/phone/v1/whoami", {})).status).toBe(404);
  });

  it("refuses browser origins, foreign Host headers, other content types and large bodies", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const origin = await phone.signed("GET", "/phone/v1/whoami", undefined, {
      extraHeaders: { origin: "https://evil.example" },
    });
    expect(origin.status).toBe(403);
    expect(origin.headers["access-control-allow-origin"]).toBeUndefined();
    const rebound = await phone.raw("GET", "/phone/v1/whoami", {
      ...phone.headersFor("GET", "/phone/v1/whoami", ""),
      host: "evil.example",
    });
    expect(rebound.status).toBe(403);
    const form = await phone.raw("POST", "/phone/v1/pair", { "content-type": "text/plain" }, "x");
    expect(form.status).toBe(400);
    const big = JSON.stringify({ code: "x".repeat(20_000) });
    const huge = await phone.raw("POST", "/phone/v1/pair", {}, big).catch(() => null);
    expect(huge === null || huge.status === 413).toBe(true);
  });

  it("closes a WebSocket upgrade attempt", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const { promise, resolve } = Promise.withResolvers<string>();
    const req = httpsRequest({
      host: "127.0.0.1",
      port: phone.port,
      path: "/phone/v1/whoami",
      rejectUnauthorized: false,
      headers: { connection: "Upgrade", upgrade: "websocket", host: `127.0.0.1:${phone.port}` },
    });
    req.on("upgrade", () => resolve("upgraded"));
    req.on("error", () => resolve("closed"));
    req.on("response", () => resolve("response"));
    req.end();
    expect(await promise).toBe("closed");
  });
});

describe("kill switch and shutdown", () => {
  it("the kill switch closes the listener, drops sessions and keeps it closed", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect((await phone.signed("GET", "/phone/v1/whoami")).status).toBe(200);
    await r.core.api("POST", "/api/security/kill-switch", { engaged: true });
    await r.core.runtime.bus.drain();
    const s = await r.status();
    expect(s).toMatchObject({ enabled: false, listening: false, kill_switch: true });
    await expect(phone.signed("GET", "/phone/v1/whoami")).rejects.toThrow();
    await expect(phone.pair(code, "Late")).rejects.toThrow();
    expect((await r.core.api("POST", "/api/phone/settings", { enabled: true })).status).toBe(403);
    expect((await r.status()).listening).toBe(false);
    // After the user releases the switch the link stays off until it is enabled again, with no old code.
    await r.core.api("POST", "/api/security/kill-switch", { engaged: false });
    const back = await r.enable();
    const reopened = new FakePhone("127.0.0.1", back.port!, back.fingerprint, () => r.clock.now());
    reopened.deviceId = phone.deviceId;
    expect((await reopened.pair(code, "Old code")).status).toBe(403);
    // The kill switch is not a revocation: the device is still paired, and signs in again.
    const again = new FakePhone("127.0.0.1", back.port!, back.fingerprint, () => r.clock.now());
    Object.assign(again, { privateKey: phone.privateKey, deviceId: phone.deviceId });
    expect((await again.signed("GET", "/phone/v1/whoami")).status).toBe(200);
    expect(
      (await r.audit()).some(
        (e) => e.action === "phone.listener.closed" && e.details.reason === "kill_switch",
      ),
    ).toBe(true);
  });

  it("refuses device requests while the kill switch is engaged even before the listener is closed", async () => {
    const r = await rig();
    const { phone } = await r.pairedPhone();
    r.core.runtime.permissions.engageKillSwitch("user");
    const reply = await phone.signed("GET", "/phone/v1/whoami").catch(() => null);
    expect(reply === null || reply.status === 403).toBe(true);
  });
});

describe("what is stored and logged", () => {
  it("never puts a key, a code or a token in the audit log or the logs, and records device ids", async () => {
    const r = await rig();
    const { phone, pairing } = await r.pairedPhone();
    const a = r.raise("Deploy the thing");
    const [approval] = (await phone.approvals()).json.approvals as Approval[];
    await phone.decide(bodyOf(approval!));
    await phone.decide(bodyOf(approval!)); // refused: second approval
    await phone.signed("GET", "/phone/v1/whoami", undefined, { nonce: "short" }); // refused
    await a.settled;
    const entries = await r.audit();
    const dump = JSON.stringify(entries) + JSON.stringify(r.logs);
    const privateKey = phone.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const plainCode = (pairing.code as string).replace(/-/g, "");
    for (const secret of [phone.publicKey, privateKey, pairing.code, plainCode, TOKEN]) {
      expect(dump).not.toContain(secret);
    }
    expect(entries.filter((e) => e.actor === `device:${phone.deviceId}`).length).toBeGreaterThan(0);
    expect(entries.some((e) => e.action === "phone.device.paired")).toBe(true);
    const stored = r.core.runtime.db.prepare("SELECT * FROM paired_devices").all();
    expect(Object.keys(stored[0] as object).sort()).toEqual([
      "created_at",
      "id",
      "last_seen_at",
      "name",
      "public_key",
      "revoked_at",
    ]);
    expect(JSON.stringify(stored)).not.toContain(privateKey);
    expect(JSON.stringify(stored)).not.toContain(plainCode);
  });
});

/** Raw TCP clients that speak no TLS: what a scanner or a stalled phone looks like to the listener. */
const silentSockets: Socket[] = [];
afterEach(() => {
  for (const s of silentSockets.splice(0)) s.destroy();
});

async function silentClient(port: number): Promise<Socket> {
  const socket = netConnect({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  silentSockets.push(socket);
  await once(socket, "connect");
  return socket;
}

describe("socket limits", () => {
  it("drops a client that never finishes the TLS handshake, and others can still pair meanwhile", async () => {
    const r = await rig({ handshakeTimeoutMs: 50 });
    const on = await r.enable();
    const silent = await silentClient(on.port!);
    await once(silent, "close"); // the listener hung up on it; nothing real-time is awaited here
    const { done } = await r.pairedPhone();
    expect(done.json).toMatchObject({ status: "approved" });
  }, 3000);

  it("keeps a silent client from blocking a phone that is still within the handshake window", async () => {
    const r = await rig();
    const on = await r.enable();
    const silent = await silentClient(on.port!);
    const { done } = await r.pairedPhone();
    expect(done.json).toMatchObject({ status: "approved" });
    expect(silent.destroyed).toBe(false);
  }, 3000);

  it("caps concurrent connections per remote address", async () => {
    const r = await rig({ maxConnectionsPerAddress: 2 });
    const on = await r.enable();
    const first = await silentClient(on.port!);
    const second = await silentClient(on.port!);
    const third = await silentClient(on.port!);
    await once(third, "close");
    expect(first.destroyed).toBe(false);
    expect(second.destroyed).toBe(false);
  }, 3000);

  it("a stalled half-open socket does not delay disabling the link", async () => {
    const r = await rig();
    const on = await r.enable();
    const silent = await silentClient(on.port!);
    // A completed request proves the listener has accepted the silent socket before it.
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    await phone.pairStatus("pair_x");
    const closed = once(silent, "close");
    await r.core.runtime.phone.configure({ enabled: false });
    expect((await r.status()).listening).toBe(false);
    await closed;
  }, 3000);
});

const authRequest = (phone: FakePhone, nonce?: string): PhoneAuthRequest => {
  const headers = phone.headersFor("GET", "/phone/v1/whoami", "", nonce ? { nonce } : {});
  return {
    deviceId: headers["x-phoenix-device"],
    timestamp: headers["x-phoenix-timestamp"],
    nonce: headers["x-phoenix-nonce"],
    signature: headers["x-phoenix-signature"],
    method: "GET",
    target: "/phone/v1/whoami",
    body: Buffer.alloc(0),
    remote: "192.0.2.50",
  };
};

describe("a disabled link refuses everything", () => {
  it("rejects a previously valid signed request and a pairing after the link is turned off", async () => {
    const r = await rig();
    const { phone, pairing } = await r.pairedPhone();
    expect(r.core.runtime.phone.authenticate(authRequest(phone)).id).toBe(phone.deviceId);
    await r.core.runtime.phone.configure({ enabled: false });
    expect(() => r.core.runtime.phone.authenticate(authRequest(phone))).toThrow(/not listening/);
    expect(() => r.core.runtime.phone.pair(pairBody(pairing.code), "192.0.2.50")).toThrow(
      /not listening/,
    );
  });
});

describe("device-name check", () => {
  it("refuses format, separator and tag characters that make one name read as another", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const hidden = {
      "Arabic letter mark U+061C": "Ada\u061C phone",
      "line separator U+2028": "Ada\u2028phone",
      "paragraph separator U+2029": "Ada\u2029phone",
      "soft hyphen U+00AD": "Ada\u00ADphone",
      "tag character U+E0041": `Ada${String.fromCodePoint(0xe0041)}phone`,
    };
    for (const [label, name] of Object.entries(hidden)) {
      const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
      expect((await phone.pair(code, name)).status, label).toBe(400);
    }
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    expect((await phone.pair(code, "Ada's phone, 📱")).status).toBe(200);
  });
});

describe("network address choice", () => {
  const info = (address: string, internal = false, family = "IPv4"): NetworkInterfaceInfo =>
    family === "IPv4"
      ? {
          address,
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal,
          cidr: `${address}/24`,
        }
      : {
          address,
          netmask: "ffff::",
          family: "IPv6",
          mac: "00:00:00:00:00:00",
          internal,
          cidr: `${address}/64`,
          scopeid: 0,
        };

  it("offers only private LAN and CGNAT IPv4 addresses, never a public, loopback or link-local one", () => {
    const offered = lanAddressesFrom({
      en0: [info("192.168.1.20"), info("fe80::1", false, "IPv6"), info("169.254.3.4")],
      en1: [info("203.0.113.9"), info("8.8.8.8"), info("10.0.0.7"), info("172.16.0.1")],
      en2: [info("172.15.255.1"), info("172.31.255.1"), info("172.32.0.1")],
      utun: [info("100.64.0.5"), info("100.127.255.1"), info("100.128.0.1"), info("100.63.0.1")],
      lo0: [info("127.0.0.1", true), info("10.9.9.9", true)],
    });
    expect(offered).toEqual([
      "192.168.1.20",
      "10.0.0.7",
      "172.16.0.1",
      "172.31.255.1",
      "100.64.0.5",
      "100.127.255.1",
    ]);
  });

  it("stays off, saying why, when the chosen address is gone, and never opens on another interface", async () => {
    let addresses = ["127.0.0.1"];
    const r = await rig({ lanAddresses: () => addresses });
    // The user chose 10.1.1.1 earlier and left the link on; now only 127.0.0.1 exists on this machine.
    r.core.runtime.settings.set("phone.address", "10.1.1.1");
    r.core.runtime.settings.set("phone.enabled", true);
    await r.core.runtime.phone.start();
    expect(await r.status()).toMatchObject({
      enabled: true,
      listening: false,
      address: null,
      off_reason: "address_changed",
    });
    expect(r.core.runtime.settings.get("phone.address", null)).toBe("10.1.1.1"); // kept
    // Choosing an address that exists brings it back.
    addresses = ["127.0.0.1"];
    const back = await r.core.runtime.phone.configure({ address: "127.0.0.1" });
    expect(back).toMatchObject({ listening: true, address: "127.0.0.1", off_reason: null });
  });
});

describe("delete all phone data", () => {
  it("clears the phone settings and survives a failing certificate removal without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const r = await rig({
        removeIdentity: () => {
          throw new Error("disk is read-only");
        },
      });
      await r.pairedPhone();
      await r.core.runtime.phone.configure({
        address: "127.0.0.1",
        require_user_verification: false,
      });
      await r.core.api("POST", "/api/privacy/delete", { data: "phone", confirm: true });
      await r.core.runtime.phone.configure({}); // queues behind the shutdown deleteAll started
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      // The failure is reported, not swallowed, and the key/cert removal ran after the listener closed.
      expect(r.logs).toContainEqual(
        expect.objectContaining({ msg: "Phone data could not be fully removed" }),
      );
      expect(r.core.runtime.settings.get("phone.address", "unset")).toBe("unset");
      expect(r.core.runtime.settings.get("phone.require_user_verification", "unset")).toBe("unset");
      expect(await r.status()).toMatchObject({ enabled: false, listening: false, devices: 0 });
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("a pairing approved in the same tick as the data is deleted creates no device", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    const reply = await phone.pair(code, "Racer");
    const confirmation = (await r.status()).pending_pair!.confirmation_id!;
    // Approved and deleted synchronously: the approval has already resolved, but clearing the
    // pairing aborts its signal and the gateway refuses to authorize an aborted request.
    r.core.runtime.permissions.resolveConfirmation(confirmation, true, "user");
    r.core.runtime.phone.deleteAll();
    await r.core.runtime.phone.configure({});
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.core.runtime.phone.devices()).toEqual([]);
    expect(r.core.runtime.phone.pairProgress(reply.json.pair_id as string)).toEqual({
      status: "expired",
    });
  });

  it("cancelling a pairing in the same tick as its approval creates no device", async () => {
    const r = await rig();
    const on = await r.enable();
    const phone = new FakePhone("127.0.0.1", on.port!, on.fingerprint, () => r.clock.now());
    const { code } = (await r.core.api("POST", "/api/phone/pairing")).json;
    const reply = await phone.pair(code, "Racer");
    const confirmation = (await r.status()).pending_pair!.confirmation_id!;
    r.core.runtime.permissions.resolveConfirmation(confirmation, true, "user");
    r.core.runtime.phone.cancelPairing();
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.core.runtime.phone.devices()).toEqual([]);
    expect(r.core.runtime.phone.pairProgress(reply.json.pair_id as string)).toEqual({
      status: "expired",
    });
  });
});

describe("replay-nonce quota", () => {
  it("one device filling its quota is throttled alone; another device still gets in", async () => {
    const r = await rig();
    const { phone: busy } = await r.pairedPhone("Busy");
    const { phone: other } = await r.pairedPhone("Other");
    for (let i = 0; i < MAX_NONCES_PER_DEVICE; i++)
      r.core.runtime.phone.authenticate(authRequest(busy));
    expect(() => r.core.runtime.phone.authenticate(authRequest(busy))).toThrow(PhoneThrottledError);
    expect(r.core.runtime.phone.authenticate(authRequest(other)).id).toBe(other.deviceId);
  });
});
