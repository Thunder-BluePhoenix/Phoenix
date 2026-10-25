// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "@phoenix/workflows";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalManifest, type ExtensionManifest } from "../src/browser-profiles";
import {
  MAX_PENDING_PURGES,
  ProfilePurgeQueue,
  PURGE_QUEUE_KEY,
} from "../src/browser-profiles/purges";
import { startCore, type ApiResponse, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const signerKeys = generateKeyPairSync("ed25519");
const rootKeys = generateKeyPairSync("ed25519");
const pem = (keys: typeof signerKeys) =>
  keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const ORIGIN = "https://example.test";
const SCRIPT = "document.title /* unique-script-text */";

function extension(over: Partial<ExtensionManifest> = {}) {
  const manifest: ExtensionManifest = {
    id: "reader",
    version: "1.0.0",
    origins: [ORIGIN],
    permissions: ["pageAction", "contentScript"],
    contentScript: SCRIPT,
    ...over,
  };
  return {
    manifest,
    signer: "acme",
    signature: sign(null, Buffer.from(canonicalManifest(manifest)), signerKeys.privateKey).toString(
      "base64",
    ),
  };
}

async function boot(extra: Record<string, unknown> = {}): Promise<TestCore> {
  const core = await startCore(
    {},
    {
      secrets: new MemorySecretStore(),
      runtime: { extensionSigners: { acme: pem(signerKeys) }, ...extra },
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

async function answered(core: TestCore, request: () => Promise<ApiResponse>) {
  const pending = request();
  for (let i = 0; i < 5_000 && core.runtime.permissions.pendingConfirmations().length === 0; i++)
    await yieldToEventLoop();
  core.runtime.permissions.resolveConfirmation(
    core.runtime.permissions.pendingConfirmations()[0]!.id,
    true,
  );
  return pending;
}

const create = async (core: TestCore, name = "Work"): Promise<string> =>
  (await core.api("POST", "/api/browser/profiles", { name })).json.id;

/** Installs `ext` into `profile` and approves it (the user's prompt is answered yes). */
async function installApproved(core: TestCore, profile: string, ext = extension()) {
  expect((await core.api("POST", `/api/browser/profiles/${profile}/extensions`, ext)).status).toBe(
    200,
  );
  await answered(core, () =>
    core.api("PUT", `/api/browser/profiles/${profile}/extensions/${ext.manifest.id}/approval`, {
      approved: true,
    }),
  );
}

const scriptsUrl = (profile: string, origin: string) =>
  `/api/browser/profiles/${profile}/content-scripts/${encodeURIComponent(origin)}`;

class MapSettings {
  readonly map = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T {
    return this.map.has(key) ? (this.map.get(key) as T) : fallback;
  }
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
}

describe("ProfilePurgeQueue", () => {
  it("persists, deduplicates, validates and is idempotent", () => {
    const settings = new MapSettings();
    const queue = new ProfilePurgeQueue(settings);
    queue.add("a");
    queue.add("b");
    queue.add("a");
    expect(new ProfilePurgeQueue(settings).list()).toEqual(["a", "b"]);
    expect(queue.has("b")).toBe(true);
    expect(() => queue.add("../x")).toThrow();
    expect(() => queue.add("")).toThrow();
    queue.done("a");
    queue.done("a");
    queue.done("never-there");
    expect(queue.list()).toEqual(["b"]);
    expect(queue.has("a")).toBe(false);
  });

  it("reads a corrupt stored value as empty and never throws", () => {
    const settings = new MapSettings();
    const queue = new ProfilePurgeQueue(settings);
    for (const corrupt of ["nope", 7, { a: 1 }, null]) {
      settings.set(PURGE_QUEUE_KEY, corrupt);
      expect(queue.list()).toEqual([]);
    }
    settings.set(PURGE_QUEUE_KEY, ["ok", 3, "bad id", "../x", "ok", "fine"]);
    expect(queue.list()).toEqual(["ok", "fine"]);
    const broken = new ProfilePurgeQueue({
      get() {
        throw new SyntaxError("bad json");
      },
      set() {},
    });
    expect(broken.list()).toEqual([]);
    expect(() => broken.done("x")).not.toThrow();
  });

  it("is bounded: the newest entry is kept and the oldest dropped", () => {
    const settings = new MapSettings();
    const queue = new ProfilePurgeQueue(settings);
    for (let i = 0; i < MAX_PENDING_PURGES + 3; i++) queue.add(`p${i}`);
    const list = queue.list();
    expect(list).toHaveLength(MAX_PENDING_PURGES);
    expect(list.at(-1)).toBe(`p${MAX_PENDING_PURGES + 2}`);
    expect(list).not.toContain("p0");
  });
});

describe("pending web-data purges through the running Core", () => {
  it("removing a profile queues a purge that the done route clears, idempotently", async () => {
    const core = await boot();
    const id = await create(core);
    const removed = await core.api("DELETE", `/api/browser/profiles/${id}`);
    expect(removed.json).toMatchObject({
      removed: true,
      purge_partition: expect.any(String),
      purge: { profile_id: id, status: "pending" },
    });
    expect((await core.api("GET", "/api/browser/profile-purges")).json).toEqual({ pending: [id] });

    const done = await core.api("POST", `/api/browser/profile-purges/${id}/done`);
    expect(done.json).toEqual({ pending: [] });
    expect((await core.api("POST", `/api/browser/profile-purges/${id}/done`)).json).toEqual({
      pending: [],
    });
    expect((await core.api("GET", "/api/browser/profile-purges")).json).toEqual({ pending: [] });
  });

  it("does not queue a purge when the profile does not exist, and rejects bad ids", async () => {
    const core = await boot();
    expect((await core.api("DELETE", "/api/browser/profiles/ghost")).status).toBe(404);
    expect((await core.api("GET", "/api/browser/profile-purges")).json).toEqual({ pending: [] });
    for (const bad of ["a%20b", "..%2Fx", "x".repeat(81)])
      expect((await core.api("POST", `/api/browser/profile-purges/${bad}/done`)).status).toBe(400);
  });

  it("needs the session token", async () => {
    const core = await boot();
    const response = await fetch(`${core.base}/api/browser/profile-purges`);
    expect(response.status).toBe(401);
  });

  it("refuses to adopt the id 'private' or an id that is still being purged", async () => {
    const core = await boot();
    const service = core.runtime.browserProfiles;
    expect(() => service.adopt("private", { revision: "x" })).toThrow("Invalid profile id");
    const id = await create(core);
    await core.api("DELETE", `/api/browser/profiles/${id}`);
    expect(() => service.adopt(id, { revision: "x" })).toThrow(
      "Profile web data is still being deleted",
    );
    const viaRoute = await core.api("POST", `/api/browser/profiles/${id}/adopt`, { revision: "x" });
    expect(viaRoute.status).toBe(400);
    expect(JSON.stringify(viaRoute.json)).toContain("still being deleted");
    await core.api("POST", `/api/browser/profile-purges/${id}/done`);
    // Once acknowledged the id is no longer special; the next refusal is the ordinary stale one.
    expect(() => service.adopt(id, { revision: "x" })).not.toThrow(/still being deleted/);
  });
});

describe("content scripts through the running Core", () => {
  it("serves nothing for an unapproved extension, then the script for the exact https origin", async () => {
    const core = await boot();
    const id = await create(core);
    await core.api("POST", `/api/browser/profiles/${id}/extensions`, extension());
    expect((await core.api("GET", scriptsUrl(id, ORIGIN))).json).toEqual({ scripts: [] });

    await answered(core, () =>
      core.api("PUT", `/api/browser/profiles/${id}/extensions/reader/approval`, { approved: true }),
    );
    const served = await core.api("GET", scriptsUrl(id, ORIGIN));
    expect(served.status).toBe(200);
    expect(served.json).toEqual({
      scripts: [{ extension: "reader", version: "1.0.0", origins: [ORIGIN], script: SCRIPT }],
    });
  });

  it("serves nothing for another origin, a subdomain, another port or an http scheme", async () => {
    const core = await boot();
    const id = await create(core);
    await installApproved(core, id);
    for (const other of [
      "https://other.test",
      "https://www.example.test",
      "https://example.test:8443",
      "https://sub.example.test",
    ])
      expect((await core.api("GET", scriptsUrl(id, other))).json).toEqual({ scripts: [] });
    // http is not an origin Core serves scripts for at all, even if an extension declared it.
    expect((await core.api("GET", scriptsUrl(id, "http://example.test"))).status).toBe(400);
    for (const bad of ["not-an-origin", "https://example.test/path", "https://*.example.test"])
      expect((await core.api("GET", scriptsUrl(id, bad))).status).toBe(400);
    expect((await core.api("GET", `/api/browser/profiles/${id}/content-scripts/%zz`)).status).toBe(
      400,
    );
  });

  it("does not serve an http-declared extension on http, and answers 404 for an unknown profile", async () => {
    const core = await boot();
    const id = await create(core);
    await installApproved(core, id, extension({ origins: ["http://plain.test"] }));
    expect((await core.api("GET", scriptsUrl(id, "http://plain.test"))).status).toBe(400);
    expect((await core.api("GET", scriptsUrl("ghost", ORIGIN))).status).toBe(404);
  });

  it("serves nothing for an extension without the contentScript permission", async () => {
    const core = await boot();
    const id = await create(core);
    await installApproved(
      core,
      id,
      extension({ permissions: ["pageAction"], contentScript: undefined }),
    );
    expect((await core.api("GET", scriptsUrl(id, ORIGIN))).json).toEqual({ scripts: [] });
  });

  it("serves nothing while the permission gateway denies (kill switch)", async () => {
    const core = await boot();
    const id = await create(core);
    await installApproved(core, id);
    expect((await core.api("GET", scriptsUrl(id, ORIGIN))).json.scripts).toHaveLength(1);
    core.runtime.permissions.engageKillSwitch("test");
    expect((await core.api("GET", scriptsUrl(id, ORIGIN))).json).toEqual({ scripts: [] });
  });

  it("serves nothing once the signer is revoked, and never lists script text in the extension list", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "phoenix-signers-")), "signers.json");
    const stamp = (ms: number) => new Date(ms).toISOString();
    const write = (sequence: number, revoked: boolean) => {
      const now = Date.now();
      const registry = {
        format_version: 1,
        sequence,
        issued_at: stamp(now - 60_000),
        expires_at: stamp(now + 24 * 3_600_000),
        signers: [
          {
            id: "acme",
            public_key: pem(signerKeys),
            valid_from: stamp(now - 3_600_000),
            status: "active",
          },
        ],
        revocations: revoked
          ? [
              {
                kind: "signer",
                target: "acme",
                revoked_at: stamp(now - 60_000),
                reason: "key_compromise",
              },
            ]
          : [],
      };
      const signature = sign(null, Buffer.from(canonicalJson(registry)), rootKeys.privateKey);
      writeFileSync(file, JSON.stringify({ registry, signature: signature.toString("base64url") }));
    };
    write(1, false);
    const core = await startCore(
      {},
      {
        secrets: new MemorySecretStore(),
        runtime: { extensionSignerRegistry: { rootPublicKey: pem(rootKeys), registryFile: file } },
      },
    );
    cleanups.push(() => core.runtime.stop());
    const id = await create(core);
    await installApproved(core, id);
    const served = await core.api("GET", scriptsUrl(id, ORIGIN));
    expect(served.json.scripts).toHaveLength(1);

    const list = await core.api("GET", `/api/browser/profiles/${id}/extensions`);
    expect(JSON.stringify(list.json)).not.toContain("unique-script-text");
    expect(
      JSON.stringify((await core.api("GET", `/api/browser/profiles/${id}`)).json),
    ).not.toContain("unique-script-text");

    write(2, true);
    await core.runtime.browserProfiles.loadSignerRegistry();
    expect((await core.api("GET", scriptsUrl(id, ORIGIN))).json).toEqual({ scripts: [] });
  });

  it("serves at most eight scripts", async () => {
    const core = await boot();
    const id = await create(core);
    for (let i = 0; i < 10; i++) await installApproved(core, id, extension({ id: `ext-${i}` }));
    const served = await core.api("GET", scriptsUrl(id, ORIGIN));
    expect(served.json.scripts).toHaveLength(8);
  });

  it("needs the session token", async () => {
    const core = await boot();
    const id = await create(core);
    const response = await fetch(`${core.base}${scriptsUrl(id, ORIGIN)}`);
    expect(response.status).toBe(401);
  });
});
