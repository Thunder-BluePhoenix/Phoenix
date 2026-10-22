// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { generateKeyPairSync, sign } from "node:crypto";
import { MemorySecretStore } from "@phoenix/persistence";
import type { Envelope, RelayEntry, SyncTransport } from "@phoenix/sync";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalManifest, type ExtensionManifest } from "../src/browser-profiles";
import { startCore, type ApiCall, type ApiResponse, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** In-memory relay: records exactly what a real untrusted relay would hold. */
class Relay implements SyncTransport {
  readonly items = new Map<string, RelayEntry>();
  async list(): Promise<RelayEntry[]> {
    return [...this.items.values()];
  }
  async put(
    _namespace: string,
    envelope: Envelope,
    expected: string | null,
  ): Promise<"stored" | "conflict"> {
    const old = this.items.get(envelope.id);
    if ((old?.generation ?? null) !== expected) return "conflict";
    this.items.set(envelope.id, { envelope, generation: String(Number(old?.generation ?? 0) + 1) });
    return "stored";
  }
}

const signerKeys = generateKeyPairSync("ed25519");
const strangerKeys = generateKeyPairSync("ed25519");
const pem = (keys: typeof signerKeys) =>
  keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const ORIGIN = "https://example.test";

function extension(over: Partial<ExtensionManifest> = {}, keys = signerKeys, signer = "acme") {
  const manifest: ExtensionManifest = {
    id: "reader",
    version: "1.0.0",
    origins: [ORIGIN],
    permissions: ["pageAction", "contentScript"],
    contentScript: "document.title",
    ...over,
  };
  return {
    manifest,
    signer,
    signature: sign(null, Buffer.from(canonicalManifest(manifest)), keys.privateKey).toString(
      "base64",
    ),
  };
}

async function boot(relay = new Relay(), secrets = new MemorySecretStore()): Promise<TestCore> {
  const core = await startCore(
    {},
    {
      secrets,
      runtime: { syncTransport: () => relay, extensionSigners: { acme: pem(signerKeys) } },
    },
  );
  cleanups.push(() => core.runtime.stop());
  return core;
}

async function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

/** Runs a request that waits for the user, answers the prompt, and returns the response. */
async function answered(
  core: TestCore,
  approve: boolean,
  request: () => Promise<ApiResponse>,
): Promise<{ response: ApiResponse; summary: string }> {
  const pending = request();
  for (let i = 0; i < 5_000 && core.runtime.permissions.pendingConfirmations().length === 0; i++)
    await yieldToEventLoop();
  const confirmation = core.runtime.permissions.pendingConfirmations()[0]!;
  core.runtime.permissions.resolveConfirmation(confirmation.id, approve);
  return { response: await pending, summary: confirmation.summary };
}

const create = async (core: TestCore, name = "Work"): Promise<string> =>
  (await core.api("POST", "/api/browser/profiles", { name })).json.id;

const bookmark = { id: "docs", url: "https://docs.example.test/", title: "Docs" };

describe("browser profiles through the running Core", () => {
  it("is unavailable without an OS secret store, and every route needs the token", async () => {
    const bare = await startCore();
    cleanups.push(() => bare.runtime.stop());
    expect((await bare.api("GET", "/api/browser/profiles")).status).toBe(503);
    const core = await boot();
    expect((await fetch(`${core.base}/api/browser/profiles`)).status).toBe(401);
    expect((await core.api("GET", "/api/browser/profiles")).json).toEqual({ profiles: [] });
  });

  it("keeps profiles apart, never syncs by default, and a bad request is a 400 rather than a fault", async () => {
    const core = await boot();
    const work = await create(core, "Work");
    const personal = await create(core, "Personal");
    await core.api("POST", `/api/browser/profiles/${work}/bookmarks`, bookmark);
    const profiles = (await core.api("GET", "/api/browser/profiles")).json.profiles;
    expect(profiles).toHaveLength(2);
    const [a, b] = profiles;
    expect(a.partition).not.toBe(b.partition);
    expect(a).toMatchObject({ syncEnabled: false });
    expect(profiles.find((p: { id: string }) => p.id === work).bookmarks).toBe(1);
    expect(profiles.find((p: { id: string }) => p.id === personal).bookmarks).toBe(0);

    const bad = (r: ApiResponse) => r.status;
    expect(bad(await core.api("POST", "/api/browser/profiles", { name: "" }))).toBe(400);
    expect(bad(await core.api("POST", "/api/browser/profiles", {}))).toBe(400);
    expect(
      bad(
        await core.api("POST", `/api/browser/profiles/${work}/bookmarks`, {
          ...bookmark,
          url: "javascript:alert(1)",
        }),
      ),
    ).toBe(400);
    expect(bad(await core.api("GET", "/api/browser/profiles/nope"))).toBe(404);
    expect(bad(await core.api("GET", "/api/browser/profiles/..%2Fetc"))).toBe(400);
  });

  it("imports exported bookmark HTML, skipping unsafe links", async () => {
    const core = await boot();
    const id = await create(core);
    const html =
      '<DL><DT><A HREF="https://a.example.test/">A</A><DT><A HREF="javascript:alert(1)">bad</A>' +
      '<DT><A HREF="https://user:pw@c.example.test/">cred</A></DL>';
    const result = await core.api("POST", `/api/browser/profiles/${id}/bookmarks/import`, { html });
    expect(result.json).toEqual({ imported: 1, skipped: 2 });
  });

  it("stores credentials write-only: no route ever returns the value, and removing the profile deletes it", async () => {
    const secrets = new MemorySecretStore();
    const core = await boot(new Relay(), secrets);
    const id = await create(core);
    const value = `credential-${Math.random().toString(36).slice(2)}`;
    const put = await core.api("PUT", `/api/browser/profiles/${id}/credentials/login`, { value });
    expect(put.json).toEqual({ stored: true });
    expect(await secrets.get(`browser.profile.${id}.login`)).toBe(value);
    const everything = JSON.stringify([
      put.json,
      (await core.api("GET", "/api/browser/profiles")).json,
      (await core.api("GET", `/api/browser/profiles/${id}`)).json,
      core.runtime.permissions.audit.list({ limit: 200 }),
      (await core.api("GET", "/api/privacy")).json,
    ]);
    expect(everything).not.toContain(value);

    const removed = await core.api("DELETE", `/api/browser/profiles/${id}`);
    expect(removed.json).toMatchObject({ removed: true, purge_partition: expect.any(String) });
    expect(await secrets.get(`browser.profile.${id}.login`)).toBeUndefined();
  });

  it("syncs a profile between two devices end to end, only after both opt-ins, and stages remote changes", async () => {
    const relay = new Relay();
    const first = await boot(relay);
    const second = await boot(relay);
    const configured = (
      await first.api("POST", "/api/sync/configure", {
        endpoint: "https://relay.example",
        relay_token: "relay-test-value",
      })
    ).json;
    await second.api("POST", "/api/sync/configure", {
      endpoint: "https://relay.example",
      relay_token: "relay-test-value",
      recovery_key: configured.recovery_key,
    });

    const id = await create(first);
    await first.api("POST", `/api/browser/profiles/${id}/bookmarks`, bookmark);
    // Account sync is on but this profile was not opted in: publishing is refused, the relay is empty.
    expect((await first.api("POST", `/api/browser/profiles/${id}/publish`)).status).toBe(400);
    expect(relay.items.size).toBe(0);

    await first.api("PUT", `/api/browser/profiles/${id}/sync`, { enabled: true });
    expect((await first.api("POST", `/api/browser/profiles/${id}/publish`)).status).toBe(200);
    expect(relay.items.size).toBe(1);
    // The relay only holds a sealed envelope: no URL, title or name is readable on it.
    const onRelay = JSON.stringify([...relay.items.values()]);
    for (const readable of ["docs.example.test", "Docs", "Work"])
      expect(onRelay).not.toContain(readable);

    const pulled = await second.api("POST", "/api/browser/sync/pull");
    expect(pulled.json.remote).toEqual([{ id, name: "Work", revision: expect.any(String) }]);
    // Nothing local changed until the user adopts exactly that revision.
    expect((await second.api("GET", "/api/browser/profiles")).json.profiles).toEqual([]);
    const stale = await second.api("POST", `/api/browser/profiles/${id}/adopt`, { revision: "x" });
    expect(stale.status).toBe(400);
    const adopted = await second.api("POST", `/api/browser/profiles/${id}/adopt`, {
      revision: pulled.json.remote[0].revision,
    });
    expect(adopted.json).toMatchObject({ id, name: "Work", syncEnabled: true, bookmarks: 1 });
    expect(adopted.json.partition).not.toBe(
      (await first.api("GET", `/api/browser/profiles/${id}`)).json.partition,
    );
  });

  it("refuses sync actions while account sync is off", async () => {
    const core = await boot();
    const id = await create(core);
    await core.api("PUT", `/api/browser/profiles/${id}/sync`, { enabled: true });
    expect((await core.api("POST", `/api/browser/profiles/${id}/publish`)).status).toBe(400);
    expect((await core.api("POST", "/api/browser/sync/pull")).status).toBe(400);
  });
});

describe("browser extensions through the running Core", () => {
  it("installs only a correctly signed extension, unapproved, and approval asks the user", async () => {
    const core = await boot();
    const id = await create(core);
    const install = (body: unknown) =>
      core.api("POST", `/api/browser/profiles/${id}/extensions`, body);
    expect((await install(extension({}, strangerKeys, "acme"))).status).toBe(400);
    expect((await install(extension({}, signerKeys, "nobody"))).status).toBe(400);
    expect(
      (await install({ ...extension(), manifest: { ...extension().manifest, origins: ["*"] } }))
        .status,
    ).toBe(400);
    const installed = await install(extension());
    expect(installed.status).toBe(200);
    expect(installed.json.approved).toBe(false);

    const refused = await answered(core, false, () =>
      core.api("PUT", `/api/browser/profiles/${id}/extensions/reader/approval`, { approved: true }),
    );
    expect(refused.response.status).not.toBe(200);
    expect(refused.summary).toContain("reader 1.0.0");
    expect(refused.summary).toContain(ORIGIN);
    const still = (await core.api("GET", `/api/browser/profiles/${id}/extensions`)).json;
    expect(still.extensions[0].approved).toBe(false);

    const approved = await answered(core, true, () =>
      core.api("PUT", `/api/browser/profiles/${id}/extensions/reader/approval`, { approved: true }),
    );
    expect(approved.response.json.extensions[0].approved).toBe(true);
  });

  it("withdrawing approval and uninstalling never ask", async () => {
    const core = await boot();
    const id = await create(core);
    await core.api("POST", `/api/browser/profiles/${id}/extensions`, extension());
    await answered(core, true, () =>
      core.api("PUT", `/api/browser/profiles/${id}/extensions/reader/approval`, { approved: true }),
    );
    const off = await core.api("PUT", `/api/browser/profiles/${id}/extensions/reader/approval`, {
      approved: false,
    });
    expect(off.json.extensions[0].approved).toBe(false);
    expect(core.runtime.permissions.pendingConfirmations()).toEqual([]);
    const gone = await core.api("DELETE", `/api/browser/profiles/${id}/extensions/reader`);
    expect(gone.json).toEqual({ extensions: [] });
  });

  it("authorises an approved extension only for what it declared, and only while the gateway agrees", async () => {
    const core = await boot();
    const id = await create(core);
    await core.api("POST", `/api/browser/profiles/${id}/extensions`, extension());
    const service = core.runtime.browserProfiles;
    // Not approved: fails closed.
    expect(await service.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
    await answered(core, true, () =>
      core.api("PUT", `/api/browser/profiles/${id}/extensions/reader/approval`, { approved: true }),
    );
    // The gateway is asked for every operation, and a kill switch makes it say no.
    expect(await service.authorize(id, "reader", "pageAction", ORIGIN)).toBe(true);
    expect(await service.authorize(id, "reader", "pageAction", "https://other.test")).toBe(false);
    expect(await service.authorize(id, "reader", "pageAction", `${ORIGIN}/path`)).toBe(false);
    core.runtime.permissions.engageKillSwitch("test");
    expect(await service.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
  });

  it("is not trusted with a signer the API supplied: there is no route to add one", async () => {
    const core = await boot();
    const id = await create(core);
    const mine = generateKeyPairSync("ed25519");
    const forged = extension({}, mine, "mine");
    expect((await core.api("POST", `/api/browser/profiles/${id}/extensions`, forged)).status).toBe(
      400,
    );
    expect((await core.api("PUT", "/api/browser/signers", { mine: pem(mine) })).status).toBe(404);
  });
});
