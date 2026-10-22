// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { generateKeyPairSync, sign } from "node:crypto";
import { MemorySecretStore } from "@phoenix/persistence";
import type { Envelope, RelayEntry, SyncTransport } from "@phoenix/sync";
import { describe, expect, it } from "vitest";
import {
  BrowserProfileManager,
  canonicalManifest,
  MAX_PROFILE_ENTRIES,
  parseBookmarkHtml,
  type EncryptedProfileSync,
  type ExtensionManifest,
  type PermissionDecision,
  type SignedExtension,
} from "../src/browser-profiles";
import { SyncRuntime } from "../src/sync";

class Settings {
  private readonly values = new Map<string, string>();
  get<T>(key: string, fallback: T): T {
    const raw = this.values.get(key);
    return raw === undefined ? fallback : (JSON.parse(raw) as T);
  }
  set(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }
  dump(): string {
    return JSON.stringify([...this.values]);
  }
}
/** In-memory relay: records exactly what a real untrusted relay would see. */
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
const otherKeys = generateKeyPairSync("ed25519");
const publicPem = (keys: typeof signerKeys): string =>
  keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const TRUSTED = { acme: publicPem(signerKeys) };
const ORIGIN = "https://example.test";

function manifest(over: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "reader",
    version: "1.0.0",
    origins: [ORIGIN],
    permissions: ["pageAction", "contentScript"],
    contentScript: "document.title",
    ...over,
  };
}
function signed(
  m: ExtensionManifest,
  keys: typeof signerKeys = signerKeys,
  signer = "acme",
): SignedExtension {
  return {
    manifest: m,
    signer,
    signature: sign(null, Buffer.from(canonicalManifest(m)), keys.privateKey).toString("base64"),
  };
}

interface Device {
  manager: BrowserProfileManager;
  settings: Settings;
  secrets: MemorySecretStore;
  sync: SyncRuntime;
  asked: Parameters<PermissionDecision>[0][];
}
/** Build a device; `answer` is the permission-gateway verdict for extension operations. */
async function device(
  relay: Relay,
  options: {
    recovery?: string;
    joinSync?: boolean;
    answer?: boolean;
    signers?: Record<string, string>;
  } = {},
): Promise<Device & { recovery: string | undefined }> {
  const settings = new Settings();
  const secrets = new MemorySecretStore();
  const sync = new SyncRuntime(settings as never, secrets, () => relay);
  let recovery = options.recovery;
  if (options.joinSync !== false) {
    const configured = await sync.configure({
      endpoint: "https://relay.example",
      relay_token: "relay-test-value",
      ...(recovery ? { recovery_key: recovery } : {}),
    });
    recovery ??= configured.recovery_key;
  }
  const asked: Device["asked"] = [];
  const decide: PermissionDecision = async (request) => {
    asked.push(request);
    return options.answer ?? true;
  };
  const adapter: EncryptedProfileSync = {
    status: () => sync.status(),
    upsert: (input) => sync.upsert(input),
    inspect: () => sync.inspect(),
    resolve: (id, scope, choice) => sync.resolve(id, scope, choice),
    sync: () => sync.sync(),
  };
  const manager = new BrowserProfileManager(
    settings as never,
    secrets,
    adapter,
    options.signers ?? TRUSTED,
    decide,
  );
  return { manager, settings, secrets, sync, asked, recovery };
}
const bm = (id: string, url = `https://${id}.example.test/`, title = id) => ({ id, url, title });

describe("profile isolation", () => {
  it("keeps bookmarks, history, partitions and extensions separate per profile", async () => {
    const { manager } = await device(new Relay());
    const work = manager.create("  Work ");
    const personal = manager.create("Personal");
    expect(work.name).toBe("Work");
    expect(work.partition).not.toBe(personal.partition);
    expect(work.id).not.toBe(personal.id);
    manager.addBookmark(work.id, bm("a"));
    manager.recordVisit(work.id, { ...bm("v"), visitedAt: 5 });
    manager.install(work.id, signed(manifest()));
    const [w, p] = manager.list();
    expect(w!.bookmarks).toHaveLength(1);
    expect(w!.history).toHaveLength(1);
    expect(p!.bookmarks).toEqual([]);
    expect(p!.history).toEqual([]);
    expect(manager.extensions(personal.id)).toEqual([]);
    expect(manager.extensions(work.id)).toHaveLength(1);
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const { manager } = await device(new Relay());
    const profile = manager.create("A");
    manager.list()[0]!.bookmarks.push(bm("x"));
    profile.name = "hacked";
    expect(manager.list()[0]).toMatchObject({ name: "A", bookmarks: [] });
  });

  it("rejects invalid names and unknown profiles", async () => {
    const { manager } = await device(new Relay());
    expect(() => manager.create("   ")).toThrow("Invalid profile name");
    expect(() => manager.create("x".repeat(81))).toThrow("Invalid profile name");
    expect(() => manager.addBookmark("nope", bm("a"))).toThrow("Unknown browser profile");
    expect(() => manager.extensions("nope")).toThrow("Unknown browser profile");
    expect(() => manager.setSync("nope", true)).toThrow("Unknown browser profile");
    await expect(manager.putCredential("nope", "k", "v")).rejects.toThrow(
      "Unknown browser profile",
    );
    await expect(manager.remove("nope")).rejects.toThrow("Unknown browser profile");
  });

  it("validates bookmark and visit data at the boundary", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://u:p@example.test/",
      "nope",
    ]) {
      expect(() => manager.addBookmark(id, bm("a", url))).toThrow("Invalid bookmark");
    }
    expect(() => manager.addBookmark(id, bm("bad id"))).toThrow("Invalid bookmark");
    expect(() => manager.addBookmark(id, bm("a", undefined, "t".repeat(513)))).toThrow(
      "Invalid bookmark",
    );
    expect(() => manager.recordVisit(id, { ...bm("v"), visitedAt: -1 })).toThrow("Invalid visit");
    expect(() => manager.recordVisit(id, { ...bm("v"), visitedAt: 1.5 })).toThrow("Invalid visit");
    expect(() => manager.recordVisit(id, bm("v") as never)).toThrow("Invalid visit");
    expect(manager.list()[0]).toMatchObject({ bookmarks: [], history: [] });
  });

  it("replaces a bookmark with the same id and bounds history to the newest entries", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    manager.addBookmark(id, bm("a", "https://one.example.test/"));
    manager.addBookmark(id, bm("a", "https://two.example.test/"));
    expect(manager.list()[0]!.bookmarks).toEqual([bm("a", "https://two.example.test/")]);
    for (let n = 0; n < 3; n += 1) manager.recordVisit(id, { ...bm(`v${n}`), visitedAt: n });
    expect(manager.list()[0]!.history.map((v) => v.id)).toEqual(["v0", "v1", "v2"]);
    expect(MAX_PROFILE_ENTRIES).toBe(10_000);
  });
});

describe("per-profile credentials", () => {
  it("namespaces credentials by profile and never writes them to settings", async () => {
    const { manager, settings, secrets } = await device(new Relay());
    const a = manager.create("A");
    const b = manager.create("B");
    await manager.putCredential(a.id, "login", "alpha-value");
    await manager.putCredential(b.id, "login", "beta-value");
    expect(await manager.getCredential(a.id, "login")).toBe("alpha-value");
    expect(await manager.getCredential(b.id, "login")).toBe("beta-value");
    expect(await secrets.get(`browser.profile.${a.id}.login`)).toBe("alpha-value");
    expect(settings.dump()).not.toContain("alpha-value");
    expect(settings.dump()).not.toContain("beta-value");
    await manager.deleteCredential(a.id, "login");
    expect(await manager.getCredential(a.id, "login")).toBeUndefined();
    expect(await manager.getCredential(b.id, "login")).toBe("beta-value");
  });

  it("rejects bad credential names and empty values", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    await expect(manager.putCredential(id, "../x", "v")).rejects.toThrow("Invalid credential");
    await expect(manager.putCredential(id, "ok", "")).rejects.toThrow("Invalid credential");
    await expect(manager.getCredential(id, "a.b")).rejects.toThrow("Invalid credential key");
  });

  it("removing a profile purges its credentials and extensions but not other profiles'", async () => {
    const { manager, secrets } = await device(new Relay());
    const a = manager.create("A");
    const b = manager.create("B");
    await manager.putCredential(a.id, "one", "v1");
    await manager.putCredential(a.id, "two", "v2");
    await manager.putCredential(b.id, "one", "keep");
    manager.install(a.id, signed(manifest()));
    await manager.remove(a.id);
    expect(await secrets.get(`browser.profile.${a.id}.one`)).toBeUndefined();
    expect(await secrets.get(`browser.profile.${a.id}.two`)).toBeUndefined();
    expect(await secrets.get(`browser.profile.${b.id}.one`)).toBe("keep");
    expect(manager.list().map((p) => p.id)).toEqual([b.id]);
    expect(() => manager.extensions(a.id)).toThrow("Unknown browser profile");
  });

  it("does not try to purge a credential twice after it was deleted explicitly", async () => {
    const { manager, secrets } = await device(new Relay());
    const { id } = manager.create("A");
    await manager.putCredential(id, "one", "v1");
    await manager.deleteCredential(id, "one");
    await secrets.set(`browser.profile.${id}.one`, "unrelated-later-write");
    await manager.remove(id);
    expect(await secrets.get(`browser.profile.${id}.one`)).toBe("unrelated-later-write");
  });
});

describe("bookmark import", () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><H3>Folder</H3>
<DL><p>
<DT><A HREF="https://news.example.test/a?x=1&amp;y=2" ADD_DATE="1">News &amp; <b>Views</b></A>
<DT><A HREF="https://news.example.test/a?x=1&amp;y=2">Duplicate</A>
<DT><A HREF="javascript:alert(1)">Script</A>
<DT><A HREF="file:///etc/passwd">File</A>
<DT><A HREF="https://user:pw@example.test/">Credentialed</A>
<DT><A HREF="http://plain.example.test/"></A>
<DT><A NAME="x">No href</A>
</DL><p>
</DL><p>`;

  it("keeps only safe http(s) links, decodes entities and de-duplicates", () => {
    const parsed = parseBookmarkHtml(html);
    expect(parsed.bookmarks.map((b) => [b.url, b.title])).toEqual([
      ["https://news.example.test/a?x=1&y=2", "News & Views"],
      ["http://plain.example.test/", "http://plain.example.test/"],
    ]);
    expect(parsed.skipped).toBe(4);
    expect(parseBookmarkHtml(html).bookmarks.map((b) => b.id)).toEqual(
      parsed.bookmarks.map((b) => b.id),
    );
  });

  it("imports into one profile only and merges by id on re-import", async () => {
    const { manager } = await device(new Relay());
    const a = manager.create("A");
    const b = manager.create("B");
    expect(manager.importBookmarkHtml(a.id, html)).toEqual({ imported: 2, skipped: 4 });
    expect(manager.importBookmarkHtml(a.id, html).imported).toBe(2);
    const [pa, pb] = manager.list();
    expect(pa!.bookmarks).toHaveLength(2);
    expect(pb!.bookmarks).toEqual([]);
    expect(b.bookmarks).toEqual([]);
  });

  it("rejects oversized or duplicate-id parsed imports without partial writes", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    expect(() => manager.importBookmarks(id, [bm("a"), bm("a")])).toThrow(
      "Duplicate bookmark identifiers",
    );
    expect(() => manager.importBookmarks(id, [bm("a"), bm("b", "javascript:1")])).toThrow(
      "Invalid bookmark",
    );
    expect(() => parseBookmarkHtml("x".repeat(2_000_001))).toThrow("Invalid bookmark import");
    expect(manager.list()[0]!.bookmarks).toEqual([]);
  });
});

describe("sync is off by default", () => {
  it("creates profiles with sync disabled and refuses to publish or preview", async () => {
    const relay = new Relay();
    const { manager } = await device(relay);
    const { id } = manager.create("A");
    manager.addBookmark(id, bm("secret-site", "https://private-bookmark.example.test/"));
    expect(manager.list()[0]!.syncEnabled).toBe(false);
    await expect(manager.publish(id)).rejects.toThrow("Encrypted sync is disabled");
    expect(() => manager.preview(id)).toThrow("Encrypted sync is disabled");
    expect(relay.items.size).toBe(0);
  });

  it("stays off when the account-level sync is not configured even if the profile opts in", async () => {
    const relay = new Relay();
    const { manager } = await device(relay, { joinSync: false });
    const { id } = manager.create("A");
    manager.setSync(id, true);
    await expect(manager.publish(id)).rejects.toThrow("Encrypted sync is disabled");
    expect(() => manager.remoteProfiles()).toThrow("Encrypted sync is disabled");
    expect(relay.items.size).toBe(0);
  });

  it("works without any sync adapter", async () => {
    const manager = new BrowserProfileManager(new Settings() as never, new MemorySecretStore());
    const { id } = manager.create("A");
    manager.setSync(id, true);
    await expect(manager.publish(id)).rejects.toThrow("Encrypted sync is disabled");
  });

  it("stops publishing after the profile opts out again", async () => {
    const relay = new Relay();
    const { manager } = await device(relay);
    const { id } = manager.create("A");
    manager.setSync(id, true);
    manager.setSync(id, false);
    await expect(manager.publish(id)).rejects.toThrow("Encrypted sync is disabled");
    expect(relay.items.size).toBe(0);
    expect(() => manager.setSync(id, "yes" as never)).toThrow("Invalid sync preference");
  });
});

describe("encrypted two-device round trip", () => {
  async function pair() {
    const relay = new Relay();
    const a = await device(relay);
    const b = await device(relay, { recovery: a.recovery });
    return { relay, a, b };
  }

  it("round-trips bookmarks and history end to end; the relay sees only ciphertext", async () => {
    const { relay, a, b } = await pair();
    const work = a.manager.create("Work");
    a.manager.setSync(work.id, true);
    a.manager.addBookmark(
      work.id,
      bm("docs", "https://docs-canary.example.test/guide", "Canary Guide"),
    );
    a.manager.recordVisit(work.id, {
      ...bm("hist", "https://history-canary.example.test/"),
      visitedAt: 42,
    });
    await a.manager.publish(work.id);

    expect(relay.items.size).toBe(1);
    const wire = JSON.stringify([...relay.items.values()]);
    for (const secret of [
      "docs-canary",
      "Canary Guide",
      "history-canary",
      "Work",
      work.partition,
    ]) {
      expect(wire).not.toContain(secret);
    }

    expect(b.manager.list()).toEqual([]);
    await b.manager.pull();
    const [remote] = b.manager.remoteProfiles();
    expect(remote).toMatchObject({ id: work.id, name: "Work" });
    const adopted = b.manager.adopt(work.id, remote!.revision);
    expect(adopted.bookmarks).toEqual([
      bm("docs", "https://docs-canary.example.test/guide", "Canary Guide"),
    ]);
    expect(adopted.history).toEqual([
      { ...bm("hist", "https://history-canary.example.test/"), visitedAt: 42 },
    ]);
    expect(adopted.syncEnabled).toBe(true);
    expect(adopted.partition).not.toBe(work.partition);
    expect(b.manager.remoteProfiles()).toEqual([]);
  });

  it("never syncs credentials, extensions or partition names", async () => {
    const { relay, a, b } = await pair();
    const { id, partition } = a.manager.create("Work");
    a.manager.setSync(id, true);
    await a.manager.putCredential(id, "login", "credential-canary");
    a.manager.install(id, signed(manifest({ id: "extension-canary" })));
    await a.manager.publish(id);
    const synced = JSON.stringify(a.sync.inspect().items);
    for (const text of [synced, JSON.stringify([...relay.items.values()])]) {
      expect(text).not.toContain("credential-canary");
      expect(text).not.toContain("extension-canary");
      expect(text).not.toContain(partition);
    }
    await b.manager.pull();
    const adopted = b.manager.adopt(id, b.manager.remoteProfiles()[0]!.revision);
    expect(await b.manager.getCredential(id, "login")).toBeUndefined();
    expect(b.manager.extensions(adopted.id)).toEqual([]);
  });

  it("a device with a different recovery key cannot read the synced profile", async () => {
    const relay = new Relay();
    const a = await device(relay);
    const stranger = await device(relay);
    const { id } = a.manager.create("Work");
    a.manager.setSync(id, true);
    await a.manager.publish(id);
    await expect(stranger.manager.pull()).rejects.toThrow();
    expect(stranger.manager.remoteProfiles()).toEqual([]);
  });

  it("stages a remote update: nothing changes until the exact revision is accepted", async () => {
    const { a, b } = await pair();
    const { id } = a.manager.create("Work");
    a.manager.setSync(id, true);
    a.manager.addBookmark(id, bm("one"));
    await a.manager.publish(id);
    await b.manager.pull();
    b.manager.adopt(id, b.manager.remoteProfiles()[0]!.revision);

    a.manager.addBookmark(id, bm("two"));
    await a.manager.publish(id);
    await b.manager.pull();
    expect(b.manager.list()[0]!.bookmarks.map((x) => x.id)).toEqual(["one"]);
    const staged = b.manager.preview(id)!;
    expect(isStagedConflict(staged.conflict)).toBe(true);
    expect(() => b.manager.accept(id, staged.revision)).toThrow("changed or is conflicted");
    expect(() => b.manager.accept(id, "stale-revision")).toThrow("changed or is conflicted");
    expect(b.manager.list()[0]!.bookmarks.map((x) => x.id)).toEqual(["one"]);

    const remoteRevision = (staged.conflict as { revision: string }).revision;
    b.manager.accept(id, remoteRevision);
    expect(b.manager.list()[0]!.bookmarks.map((x) => x.id)).toEqual(["one", "two"]);
    expect(b.manager.preview(id)!.conflict).toBeNull();
    expect(b.manager.preview(id)!.revision).toBe(remoteRevision);
  });

  it("round-trips in both directions", async () => {
    const { a, b } = await pair();
    const { id } = a.manager.create("Work");
    a.manager.setSync(id, true);
    await a.manager.publish(id);
    await b.manager.pull();
    b.manager.adopt(id, b.manager.remoteProfiles()[0]!.revision);
    b.manager.addBookmark(id, bm("from-b", "https://from-b.example.test/"));
    await b.manager.publish(id);
    await a.manager.pull();
    const conflict = a.manager.preview(id)!.conflict as { revision: string };
    a.manager.accept(id, conflict.revision);
    expect(a.manager.list()[0]!.bookmarks).toEqual([bm("from-b", "https://from-b.example.test/")]);
  });

  it("refuses to adopt a profile that already exists locally or an unknown one", async () => {
    const { a, b } = await pair();
    const { id } = a.manager.create("Work");
    a.manager.setSync(id, true);
    await a.manager.publish(id);
    await b.manager.pull();
    const revision = b.manager.remoteProfiles()[0]!.revision;
    expect(() => b.manager.adopt("missing", revision)).toThrow("No synced profile");
    expect(() => b.manager.adopt(id, "stale")).toThrow("changed or is conflicted");
    b.manager.adopt(id, revision);
    expect(() => b.manager.adopt(id, revision)).toThrow("Profile already exists");
  });

  it("rejects malicious synced content and applies nothing", async () => {
    const { a, b } = await pair();
    const { id } = b.manager.create("Local");
    b.manager.setSync(id, true);
    b.manager.addBookmark(id, bm("mine"));
    const payloads: unknown[] = [
      { id, name: "x", bookmarks: [bm("a", "javascript:alert(1)")], history: [] },
      { id, name: "x", bookmarks: [bm("a"), bm("a")], history: [] },
      { id, name: "x", bookmarks: [], history: [{ ...bm("v"), visitedAt: -3 }] },
      { id, name: "", bookmarks: [], history: [] },
      { id: "other", name: "x", bookmarks: [], history: [] },
      { id, name: "x", bookmarks: "nope", history: [] },
    ];
    for (const value of payloads) {
      const attacker = await device(new Relay(), { recovery: a.recovery });
      attacker.sync.upsert({ id: `browser:${id}`, scope: "owner", data_class: "context", value });
      const accepter = new BrowserProfileManager(
        b.settings as never,
        b.secrets,
        { ...adapterOf(b.sync), inspect: () => attacker.sync.inspect() },
        TRUSTED,
      );
      const revision = attacker.sync.inspect().items[0]!.revision;
      expect(() => accepter.accept(id, revision)).toThrow(/Invalid|Duplicate|changed/);
    }
    expect(b.manager.list()[0]!.bookmarks.map((x) => x.id)).toEqual(["mine"]);
  });
});

function isStagedConflict(value: unknown): boolean {
  return typeof value === "object" && value !== null && "revision" in value;
}
function adapterOf(sync: SyncRuntime): EncryptedProfileSync {
  return {
    status: () => sync.status(),
    upsert: (input) => sync.upsert(input),
    inspect: () => sync.inspect(),
    resolve: (id, scope, choice) => sync.resolve(id, scope, choice),
    sync: () => sync.sync(),
  };
}

describe("extensions need a trusted signature and explicit approval", () => {
  it("installs a correctly signed extension but unapproved, so it cannot act", async () => {
    const { manager, asked } = await device(new Relay());
    const { id } = manager.create("A");
    const installed = manager.install(id, signed(manifest()));
    expect(installed).toMatchObject({ approved: false, signer: "acme" });
    expect(await manager.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
    expect(asked).toEqual([]);
  });

  it("rejects unsigned, wrongly signed, tampered and untrusted-signer extensions", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    const good = signed(manifest());
    expect(() => manager.install(id, { ...good, signature: "" })).toThrow(
      "Invalid extension signature",
    );
    expect(() => manager.install(id, { ...good, signature: "!!!" })).toThrow(
      "Invalid extension signature",
    );
    expect(() => manager.install(id, signed(manifest(), otherKeys))).toThrow(
      "Invalid extension signature",
    );
    const tampered = { ...good, manifest: manifest({ origins: ["https://evil.test"] }) };
    expect(() => manager.install(id, tampered)).toThrow("Invalid extension signature");
    const escalated = { ...good, manifest: manifest({ contentScript: "steal()" }) };
    expect(() => manager.install(id, escalated)).toThrow("Invalid extension signature");
    expect(() => manager.install(id, signed(manifest(), signerKeys, "stranger"))).toThrow(
      "Untrusted extension signer",
    );
    for (const signer of ["constructor", "__proto__", "toString"]) {
      expect(() => manager.install(id, { ...good, signer })).toThrow("Untrusted extension signer");
    }
    expect(manager.extensions(id)).toEqual([]);
  });

  it("treats a malformed trusted key as an invalid signature, not a crash", async () => {
    const { manager } = await device(new Relay(), { signers: { acme: "not a key" } });
    const { id } = manager.create("A");
    expect(() => manager.install(id, signed(manifest()))).toThrow("Invalid extension signature");
  });

  it("rejects invalid manifests: wildcard or path origins, unknown fields, undeclared script permission", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    const cases: ExtensionManifest[] = [
      manifest({ origins: ["https://*.example.test"] }),
      manifest({ origins: ["https://example.test/path"] }),
      manifest({ origins: ["file:///"] }),
      manifest({ origins: [] }),
      manifest({ permissions: [] }),
      manifest({ permissions: ["pageAction", "network" as never] }),
      manifest({ permissions: ["pageAction"] }),
      manifest({ id: "bad id" }),
      manifest({ version: "latest" }),
      manifest({ contentScript: "x".repeat(100_001) }),
    ];
    for (const m of cases)
      expect(() => manager.install(id, signed(m))).toThrow("Invalid extension manifest");
    const extra = { ...signed(manifest()), manifest: { ...manifest(), runtime: "native" } };
    expect(() => manager.install(id, extra as never)).toThrow("Invalid extension manifest");
    expect(() => manager.install(id, null as never)).toThrow("Invalid extension manifest");
  });

  it("signature verification ignores manifest key order", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    const m = manifest();
    const reordered = {
      permissions: m.permissions,
      contentScript: m.contentScript,
      origins: m.origins,
      version: m.version,
      id: m.id,
    } as ExtensionManifest;
    expect(manager.install(id, { ...signed(m), manifest: reordered }).manifest.id).toBe("reader");
  });

  it("authorizes only approved, declared permissions on declared origins and defers to the gateway", async () => {
    const { manager, asked } = await device(new Relay());
    const { id } = manager.create("A");
    manager.install(
      id,
      signed(manifest({ permissions: ["pageAction"], contentScript: undefined })),
    );
    manager.approve(id, "reader", true);
    expect(await manager.authorize(id, "reader", "pageAction", ORIGIN)).toBe(true);
    expect(asked).toEqual([
      { profileId: id, extensionId: "reader", permission: "pageAction", origin: ORIGIN },
    ]);
    expect(await manager.authorize(id, "reader", "contentScript", ORIGIN)).toBe(false);
    expect(await manager.authorize(id, "reader", "pageAction", "https://other.test")).toBe(false);
    expect(await manager.authorize(id, "reader", "pageAction", `${ORIGIN}/page`)).toBe(false);
    expect(
      await manager.authorize(id, "reader", "pageAction", "https://example.test.evil.test"),
    ).toBe(false);
    expect(await manager.authorize(id, "missing", "pageAction", ORIGIN)).toBe(false);
    expect(asked).toHaveLength(1);
  });

  it("fails closed when the gateway denies or is not wired", async () => {
    const denied = await device(new Relay(), { answer: false });
    const a = denied.manager.create("A");
    denied.manager.install(a.id, signed(manifest()));
    denied.manager.approve(a.id, "reader", true);
    expect(await denied.manager.authorize(a.id, "reader", "pageAction", ORIGIN)).toBe(false);
    expect(denied.asked).toHaveLength(1);

    const noGateway = new BrowserProfileManager(
      new Settings() as never,
      new MemorySecretStore(),
      undefined,
      TRUSTED,
    );
    const b = noGateway.create("B");
    noGateway.install(b.id, signed(manifest()));
    noGateway.approve(b.id, "reader", true);
    expect(await noGateway.authorize(b.id, "reader", "pageAction", ORIGIN)).toBe(false);
  });

  it("approval can be revoked, and extensions do not cross profiles", async () => {
    const { manager } = await device(new Relay());
    const a = manager.create("A");
    const b = manager.create("B");
    manager.install(a.id, signed(manifest()));
    manager.approve(a.id, "reader", true);
    expect(await manager.authorize(a.id, "reader", "contentScript", ORIGIN)).toBe(true);
    expect(await manager.authorize(b.id, "reader", "contentScript", ORIGIN)).toBe(false);
    manager.approve(a.id, "reader", false);
    expect(await manager.authorize(a.id, "reader", "contentScript", ORIGIN)).toBe(false);
    expect(() => manager.approve(a.id, "ghost", true)).toThrow("Unknown extension");
    expect(() => manager.approve(a.id, "reader", "yes" as never)).toThrow(
      "Invalid extension approval",
    );
  });

  it("re-installing resets approval so a new version needs fresh consent", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    manager.install(id, signed(manifest()));
    manager.approve(id, "reader", true);
    manager.install(
      id,
      signed(manifest({ version: "2.0.0", origins: [ORIGIN, "https://more.test"] })),
    );
    const [only] = manager.extensions(id);
    expect(manager.extensions(id)).toHaveLength(1);
    expect(only).toMatchObject({ approved: false });
    expect(only!.manifest.version).toBe("2.0.0");
    expect(await manager.authorize(id, "reader", "pageAction", "https://more.test")).toBe(false);
  });

  it("revoking a signer's trust disables its already-approved extensions", async () => {
    const settings = new Settings();
    const secrets = new MemorySecretStore();
    const trusting = new BrowserProfileManager(
      settings as never,
      secrets,
      undefined,
      TRUSTED,
      async () => true,
    );
    const { id } = trusting.create("A");
    trusting.install(id, signed(manifest()));
    trusting.approve(id, "reader", true);
    expect(await trusting.authorize(id, "reader", "pageAction", ORIGIN)).toBe(true);
    const distrusting = new BrowserProfileManager(
      settings as never,
      secrets,
      undefined,
      {},
      async () => true,
    );
    expect(await distrusting.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
  });

  it("uninstalls an extension", async () => {
    const { manager } = await device(new Relay());
    const { id } = manager.create("A");
    manager.install(id, signed(manifest()));
    manager.uninstall(id, "reader");
    expect(manager.extensions(id)).toEqual([]);
    expect(() => manager.uninstall(id, "reader")).toThrow("Unknown extension");
  });
});
