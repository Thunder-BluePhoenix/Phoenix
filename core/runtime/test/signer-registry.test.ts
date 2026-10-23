// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Simulated evidence: every key is generated here at test time, the clock is a variable and the
// settings store is a map. No real signer, registry host or browser took part.
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { MemorySecretStore } from "@phoenix/persistence";
import { canonicalJson } from "@phoenix/workflows";
import { describe, expect, it } from "vitest";
import {
  BrowserProfileManager,
  canonicalManifest,
  manifestSha256,
  type ExtensionManifest,
  type SignedExtension,
} from "../src/browser-profiles";
import {
  MAX_REGISTRY_LIFETIME_MS,
  MAX_REGISTRY_REVOCATIONS,
  MAX_REGISTRY_SIGNERS,
  MAX_SIGNER_REGISTRY_BYTES,
  SignerRegistry,
  SignerRegistryError,
  type RegistryErrorCode,
  type SignerRegistryBody,
} from "../src/browser-profiles/signer-registry";

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

const ORIGIN = "https://example.test";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-03-01T00:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const rootKeys = generateKeyPairSync("ed25519");
const otherRootKeys = generateKeyPairSync("ed25519");
const acmeKeys = generateKeyPairSync("ed25519");
const pem = (key: KeyObject): string => key.export({ type: "spki", format: "pem" }).toString();
const ROOT_PEM = pem(rootKeys.publicKey);

function body(over: Partial<SignerRegistryBody> = {}): SignerRegistryBody {
  return {
    format_version: 1,
    sequence: 1,
    issued_at: iso(T0),
    expires_at: iso(T0 + 30 * DAY),
    signers: [
      {
        id: "acme",
        public_key: pem(acmeKeys.publicKey),
        valid_from: iso(T0 - DAY),
        status: "active",
      },
    ],
    revocations: [],
    ...over,
  };
}
function document(value: unknown, signer: KeyObject = rootKeys.privateKey): Buffer {
  return Buffer.from(
    JSON.stringify({
      registry: value,
      signature: sign(null, Buffer.from(canonicalJson(value)), signer).toString("base64url"),
    }),
  );
}
/** Signs a body as the root key would, no matter what is in it, so each refusal is the registry's. */
const signed = (over: Partial<SignerRegistryBody> = {}, signer?: KeyObject): Buffer =>
  document(body(over), signer);

function manifest(over: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "reader",
    version: "1.0.0",
    origins: [ORIGIN],
    permissions: ["pageAction"],
    ...over,
  };
}
function extension(
  m: ExtensionManifest = manifest(),
  signer = "acme",
  keys = acmeKeys,
): SignedExtension {
  return {
    manifest: m,
    signer,
    signature: sign(null, Buffer.from(canonicalManifest(m)), keys.privateKey).toString("base64"),
  };
}

function refusal(run: () => unknown): RegistryErrorCode {
  try {
    run();
  } catch (error) {
    if (error instanceof SignerRegistryError) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

function setup(now = { at: T0 }) {
  const settings = new Settings();
  const registry = new SignerRegistry({
    rootPublicKey: ROOT_PEM,
    store: settings,
    now: () => now.at,
  });
  return { settings, registry, now };
}

describe("signer registry document", () => {
  it("accepts a valid document and lists its signers", () => {
    const { registry } = setup();
    expect(registry.load(signed())).toEqual({ changed: true, sequence: 1 });
    expect(registry.status()).toMatchObject({
      loaded: true,
      sequence: 1,
      expired: false,
      signers: [{ id: "acme", status: "active" }],
      revocations: [],
    });
  });

  it("refuses a bad signature, a wrong root, and a tampered body", () => {
    const { registry } = setup();
    const good = JSON.parse(signed().toString());
    expect(
      refusal(() =>
        registry.load(Buffer.from(JSON.stringify({ ...good, signature: "A".repeat(86) }))),
      ),
    ).toBe("BAD_SIGNATURE");
    expect(
      refusal(() => registry.load(Buffer.from(JSON.stringify({ ...good, signature: "short" })))),
    ).toBe("BAD_SIGNATURE");
    expect(refusal(() => registry.load(signed({}, otherRootKeys.privateKey)))).toBe(
      "BAD_SIGNATURE",
    );
    const tampered = { ...good, registry: { ...good.registry, signers: [] } };
    expect(refusal(() => registry.load(Buffer.from(JSON.stringify(tampered))))).toBe(
      "BAD_SIGNATURE",
    );
    const resequenced = { ...good, registry: { ...good.registry, sequence: 99 } };
    expect(refusal(() => registry.load(Buffer.from(JSON.stringify(resequenced))))).toBe(
      "BAD_SIGNATURE",
    );
    expect(registry.status().loaded).toBe(false);
  });

  it("never takes the root from the document: a self-signed document with its own key is refused", () => {
    const { registry } = setup();
    const attacker = generateKeyPairSync("ed25519");
    const doc = body({
      signers: [
        {
          id: "evil",
          public_key: pem(attacker.publicKey),
          valid_from: iso(T0 - DAY),
          status: "active",
        },
      ],
    });
    expect(refusal(() => registry.load(document(doc, attacker.privateKey)))).toBe("BAD_SIGNATURE");
  });

  it("refuses a root that is not an Ed25519 public key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    for (const rootPublicKey of ["", "not a key", pem(rsa.publicKey)]) {
      expect(
        refusal(() => new SignerRegistry({ rootPublicKey, store: new Settings(), now: () => T0 })),
      ).toBe("INVALID_ROOT_KEY");
    }
  });

  it("refuses a rollback: a lower or equal sequence, but not the identical document again", () => {
    const { registry } = setup();
    registry.load(signed({ sequence: 5 }));
    expect(refusal(() => registry.load(signed({ sequence: 4 })))).toBe("ROLLBACK");
    expect(refusal(() => registry.load(signed({ sequence: 5, issued_at: iso(T0 + 1000) })))).toBe(
      "ROLLBACK",
    );
    expect(registry.status().sequence).toBe(5);
    expect(registry.load(signed({ sequence: 5 }))).toEqual({ changed: false, sequence: 5 });
    expect(registry.load(signed({ sequence: 6 }))).toEqual({ changed: true, sequence: 6 });
  });

  it("keeps the last accepted sequence across restarts, and a rolled-back signer stays refused", () => {
    const first = setup();
    first.registry.load(
      signed({
        sequence: 7,
        revocations: [
          { kind: "signer", target: "acme", revoked_at: iso(T0), reason: "key_compromise" },
        ],
      }),
    );
    const restarted = new SignerRegistry({
      rootPublicKey: ROOT_PEM,
      store: first.settings,
      now: () => T0,
    });
    expect(restarted.status().sequence).toBe(7);
    expect(restarted.resolve("acme", "0".repeat(64))).toEqual({
      trusted: false,
      reason: "signer_revoked",
    });
    // The older, un-revoking document is what an attacker would replay.
    expect(refusal(() => restarted.load(signed({ sequence: 6 })))).toBe("ROLLBACK");
  });

  it("does not trust a doctored stored document and does not reuse another root's sequence", () => {
    const first = setup();
    first.registry.load(signed({ sequence: 3 }));
    const forged = new Settings();
    const evil = generateKeyPairSync("ed25519");
    forged.set("browser.signer-registry.v1", {
      root: first.settings.get<{ root: string }>("browser.signer-registry.v1", { root: "" }).root,
      sequence: 1,
      document: document(body(), evil.privateKey).toString(),
    });
    const restarted = new SignerRegistry({ rootPublicKey: ROOT_PEM, store: forged, now: () => T0 });
    expect(restarted.status().loaded).toBe(false);
    expect(restarted.resolve("acme", "0".repeat(64))).toMatchObject({ reason: "registry_missing" });

    const otherRoot = new SignerRegistry({
      rootPublicKey: pem(otherRootKeys.publicKey),
      store: first.settings,
      now: () => T0,
    });
    expect(otherRoot.status().loaded).toBe(false);
    expect(otherRoot.load(signed({ sequence: 1 }, otherRootKeys.privateKey)).sequence).toBe(1);
  });

  it("refuses an expired document, a document issued in the future, and an over-long lifetime", () => {
    const { registry, now } = setup();
    expect(
      refusal(() =>
        registry.load(signed({ issued_at: iso(T0 - 40 * DAY), expires_at: iso(T0 - DAY) })),
      ),
    ).toBe("EXPIRED");
    now.at = T0 + 31 * DAY;
    expect(refusal(() => registry.load(signed()))).toBe("EXPIRED");
    now.at = T0 - 10 * 60 * 1000;
    expect(refusal(() => registry.load(signed()))).toBe("NOT_YET_VALID");
    now.at = T0;
    expect(
      refusal(() =>
        registry.load(signed({ expires_at: iso(T0 + MAX_REGISTRY_LIFETIME_MS + 1000) })),
      ),
    ).toBe("INVALID_FIELD");
    expect(refusal(() => registry.load(signed({ expires_at: iso(T0) })))).toBe("INVALID_FIELD");
  });

  it("refuses oversize, empty and malformed input", () => {
    const { registry } = setup();
    expect(refusal(() => registry.load(Buffer.alloc(MAX_SIGNER_REGISTRY_BYTES + 1, 32)))).toBe(
      "OVERSIZE",
    );
    expect(refusal(() => registry.load(Buffer.alloc(0)))).toBe("MALFORMED");
    expect(refusal(() => registry.load(Buffer.from("{")))).toBe("MALFORMED");
    expect(refusal(() => registry.load(Buffer.from("[]")))).toBe("MALFORMED");
    // A body that is valid JSON but past the byte cap is refused before it is parsed or verified.
    const many = body({
      revocations: Array.from({ length: MAX_REGISTRY_REVOCATIONS + 1 }, (_, n) => ({
        kind: "manifest" as const,
        target: n.toString(16).padStart(64, "0"),
        revoked_at: iso(T0),
        reason: "superseded" as const,
      })),
    });
    expect(refusal(() => registry.load(document(many)))).toBe("INVALID_FIELD");
    const tooManySigners = body({
      signers: Array.from({ length: MAX_REGISTRY_SIGNERS + 1 }, (_, n) => ({
        id: `s${n}`,
        public_key: pem(acmeKeys.publicKey),
        valid_from: iso(T0),
        status: "active" as const,
      })),
    });
    expect(refusal(() => registry.load(document(tooManySigners)))).toBe("INVALID_FIELD");
  });

  it("refuses unknown fields anywhere, signed or not", () => {
    const { registry } = setup();
    const withExtra = { ...body(), trust_everyone: true } as unknown as SignerRegistryBody;
    expect(refusal(() => registry.load(document(withExtra)))).toBe("UNKNOWN_FIELD");
    const signerExtra = body({
      signers: [{ ...body().signers[0]!, admin: true } as never],
    });
    expect(refusal(() => registry.load(document(signerExtra)))).toBe("UNKNOWN_FIELD");
    const revocationExtra = body({
      revocations: [
        {
          kind: "signer",
          target: "acme",
          revoked_at: iso(T0),
          reason: "superseded",
          note: "x",
        } as never,
      ],
    });
    expect(refusal(() => registry.load(document(revocationExtra)))).toBe("UNKNOWN_FIELD");
    const envelope = JSON.parse(signed().toString());
    expect(
      refusal(() => registry.load(Buffer.from(JSON.stringify({ ...envelope, key_id: "root" })))),
    ).toBe("UNKNOWN_FIELD");
    expect(
      refusal(() =>
        registry.load(
          Buffer.from(`{"registry":{"__proto__":{"x":1}},"signature":"${"A".repeat(86)}"}`),
        ),
      ),
    ).toBe("UNKNOWN_FIELD");
  });

  it("refuses duplicate ids, a bad reason, a bad hash, and a non-Ed25519 signer key", () => {
    const { registry } = setup();
    const signer = body().signers[0]!;
    expect(refusal(() => registry.load(signed({ signers: [signer, signer] })))).toBe(
      "DUPLICATE_ID",
    );
    const revoke = {
      kind: "signer" as const,
      target: "acme",
      revoked_at: iso(T0),
      reason: "superseded" as const,
    };
    expect(refusal(() => registry.load(signed({ revocations: [revoke, revoke] })))).toBe(
      "DUPLICATE_ID",
    );
    expect(
      refusal(() =>
        registry.load(signed({ revocations: [{ ...revoke, reason: "because" as never }] })),
      ),
    ).toBe("INVALID_FIELD");
    expect(
      refusal(() =>
        registry.load(signed({ revocations: [{ ...revoke, kind: "manifest", target: "abc" }] })),
      ),
    ).toBe("INVALID_FIELD");
    expect(
      refusal(() =>
        registry.load(signed({ revocations: [{ ...revoke, revoked_at: iso(T0 + DAY) }] })),
      ),
    ).toBe("INVALID_FIELD");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(
      refusal(() =>
        registry.load(signed({ signers: [{ ...signer, public_key: pem(rsa.publicKey) }] })),
      ),
    ).toBe("INVALID_FIELD");
    expect(
      refusal(() => registry.load(signed({ signers: [{ ...signer, public_key: "nope" }] }))),
    ).toBe("INVALID_FIELD");
    expect(refusal(() => registry.load(signed({ signers: [{ ...signer, id: "../x" }] })))).toBe(
      "INVALID_FIELD",
    );
    expect(refusal(() => registry.load(signed({ sequence: 0 })))).toBe("INVALID_FIELD");
    expect(refusal(() => registry.load(signed({ sequence: 1.5 })))).toBe("INVALID_FIELD");
  });

  it("a refused document leaves the current one in force; errors carry only the closed code", () => {
    const { registry } = setup();
    registry.load(signed({ sequence: 2 }));
    let thrown: unknown;
    try {
      registry.load(signed({ sequence: 1 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SignerRegistryError);
    expect((thrown as Error).message).toBe("Signer registry refused: ROLLBACK");
    expect(registry.resolve("acme", "0".repeat(64))).toMatchObject({ trusted: true });
  });
});

describe("signer trust decisions", () => {
  const hash = manifestSha256(manifest());

  it("trusts an active signer inside its validity window", () => {
    const { registry } = setup();
    registry.load(signed());
    expect(registry.resolve("acme", hash)).toEqual({
      trusted: true,
      publicKey: pem(acmeKeys.publicKey),
    });
  });

  it("refuses unknown, revoked, disabled, expired and not-yet-valid signers, and revoked hashes", () => {
    const { registry, now } = setup();
    const acme = body().signers[0]!;
    registry.load(
      signed({
        signers: [
          acme,
          { ...acme, id: "off", status: "disabled" },
          { ...acme, id: "old", expires_at: iso(T0 + DAY) },
          { ...acme, id: "future", valid_from: iso(T0 + 2 * DAY) },
          { ...acme, id: "bad" },
        ],
        revocations: [
          { kind: "signer", target: "bad", revoked_at: iso(T0), reason: "key_compromise" },
          {
            kind: "manifest",
            target: "f".repeat(64),
            revoked_at: iso(T0),
            reason: "malicious_extension",
          },
          { kind: "signer", target: "ghost", revoked_at: iso(T0), reason: "signer_retired" },
        ],
      }),
    );
    expect(registry.resolve("nobody", hash)).toEqual({ trusted: false, reason: "unknown_signer" });
    expect(registry.resolve("constructor", hash)).toEqual({
      trusted: false,
      reason: "unknown_signer",
    });
    expect(registry.resolve("../acme", hash)).toEqual({ trusted: false, reason: "unknown_signer" });
    expect(registry.resolve("bad", hash)).toEqual({ trusted: false, reason: "signer_revoked" });
    expect(registry.resolve("ghost", hash)).toEqual({ trusted: false, reason: "signer_revoked" });
    expect(registry.resolve("acme", "f".repeat(64))).toEqual({
      trusted: false,
      reason: "manifest_revoked",
    });
    expect(registry.resolve("off", hash)).toEqual({ trusted: false, reason: "signer_disabled" });
    expect(registry.resolve("future", hash)).toEqual({
      trusted: false,
      reason: "signer_not_yet_valid",
    });
    expect(registry.resolve("old", hash)).toMatchObject({ trusted: true });
    now.at = T0 + DAY;
    expect(registry.resolve("old", hash)).toEqual({ trusted: false, reason: "signer_expired" });
  });

  it("refuses everything with no document, and once the document itself has expired", () => {
    const { registry, now } = setup();
    expect(registry.resolve("acme", hash)).toEqual({ trusted: false, reason: "registry_missing" });
    registry.load(signed());
    now.at = T0 + 30 * DAY;
    expect(registry.resolve("acme", hash)).toEqual({ trusted: false, reason: "registry_expired" });
    expect(registry.status().expired).toBe(true);
  });
});

describe("extension verification consults the registry", () => {
  function manager(registry: SignerRegistry, settings = new Settings()) {
    return new BrowserProfileManager(
      settings as never,
      new MemorySecretStore(),
      undefined,
      registry,
      async () => true,
    );
  }

  it("installs and authorises a manifest from a trusted signer", async () => {
    const { registry } = setup();
    registry.load(signed());
    const m = manager(registry);
    const { id } = m.create("A");
    expect(m.install(id, extension())).toMatchObject({
      signer: "acme",
      approved: false,
      status: "trusted",
    });
    m.approve(id, "reader", true);
    expect(await m.authorize(id, "reader", "pageAction", ORIGIN)).toBe(true);
    expect(m.extensions(id)[0]).toMatchObject({ status: "trusted", approved: true });
  });

  it("refuses revoked, unknown, expired and disabled signers and revoked hashes at install", () => {
    const { registry, now } = setup();
    const acme = body().signers[0]!;
    registry.load(
      signed({
        signers: [
          acme,
          { ...acme, id: "bad" },
          { ...acme, id: "old", expires_at: iso(T0 + DAY) },
          { ...acme, id: "off", status: "disabled" },
        ],
        revocations: [
          { kind: "signer", target: "bad", revoked_at: iso(T0), reason: "key_compromise" },
          {
            kind: "manifest",
            target: manifestSha256(manifest({ id: "banned" })),
            revoked_at: iso(T0),
            reason: "vulnerability",
          },
        ],
      }),
    );
    now.at = T0 + 2 * DAY;
    registry.load(
      signed({
        sequence: 2,
        signers: [
          acme,
          { ...acme, id: "bad" },
          { ...acme, id: "old", expires_at: iso(T0 + DAY) },
          { ...acme, id: "off", status: "disabled" },
        ],
        revocations: [
          { kind: "signer", target: "bad", revoked_at: iso(T0), reason: "key_compromise" },
          {
            kind: "manifest",
            target: manifestSha256(manifest({ id: "banned" })),
            revoked_at: iso(T0),
            reason: "vulnerability",
          },
        ],
        issued_at: iso(T0 + 2 * DAY),
        expires_at: iso(T0 + 20 * DAY),
      }),
    );
    const m = manager(registry);
    const { id } = m.create("A");
    expect(() => m.install(id, extension(manifest(), "bad"))).toThrow(
      "Extension refused: signer_revoked",
    );
    expect(() => m.install(id, extension(manifest(), "old"))).toThrow(
      "Extension refused: signer_expired",
    );
    expect(() => m.install(id, extension(manifest(), "off"))).toThrow(
      "Extension refused: signer_disabled",
    );
    expect(() => m.install(id, extension(manifest({ id: "banned" })))).toThrow(
      "Extension refused: manifest_revoked",
    );
    expect(() => m.install(id, extension(manifest(), "nobody"))).toThrow(
      "Untrusted extension signer",
    );
    expect(m.extensions(id)).toEqual([]);
  });

  it("refuses a signature that does not verify under the registry's key for that signer", () => {
    const { registry } = setup();
    registry.load(signed());
    const m = manager(registry);
    const { id } = m.create("A");
    const stranger = generateKeyPairSync("ed25519");
    expect(() => m.install(id, extension(manifest(), "acme", stranger))).toThrow(
      "Invalid extension signature",
    );
  });

  it("refuses every install while no registry document is loaded or the loaded one has expired", () => {
    const { registry, now } = setup();
    const m = manager(registry);
    const { id } = m.create("A");
    expect(() => m.install(id, extension())).toThrow("Extension refused: registry_missing");
    registry.load(signed());
    expect(m.install(id, extension())).toMatchObject({ status: "trusted" });
    now.at = T0 + 31 * DAY;
    expect(() => m.install(id, extension())).toThrow("Extension refused: registry_expired");
  });

  it("retroactive revocation flips an installed, approved extension to revoked and it never runs", async () => {
    const { registry, settings } = setup();
    registry.load(signed());
    const m = manager(registry, settings);
    const { id } = m.create("A");
    m.install(id, extension());
    m.approve(id, "reader", true);
    expect(await m.authorize(id, "reader", "pageAction", ORIGIN)).toBe(true);

    registry.load(
      signed({
        sequence: 2,
        issued_at: iso(T0 + 1000),
        revocations: [
          { kind: "signer", target: "acme", revoked_at: iso(T0 + 1000), reason: "key_compromise" },
        ],
      }),
    );
    expect(m.extensions(id)[0]).toMatchObject({
      status: "revoked",
      reason: "signer_revoked",
      approved: false,
    });
    expect(await m.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
    expect(() => m.approve(id, "reader", true)).toThrow("Untrusted extension signer");
    // Withdrawing approval and removing it stay possible.
    m.approve(id, "reader", false);
    m.uninstall(id, "reader");
  });

  it("retroactive revocation of one manifest hash flips only that extension", async () => {
    const { registry } = setup();
    registry.load(signed());
    const m = manager(registry);
    const { id } = m.create("A");
    m.install(id, extension(manifest({ id: "one" })));
    m.install(id, extension(manifest({ id: "two" })));
    m.approve(id, "one", true);
    m.approve(id, "two", true);
    registry.load(
      signed({
        sequence: 2,
        issued_at: iso(T0 + 1000),
        revocations: [
          {
            kind: "manifest",
            target: manifestSha256(manifest({ id: "one" })),
            revoked_at: iso(T0 + 1000),
            reason: "malicious_extension",
          },
        ],
      }),
    );
    const views = Object.fromEntries(m.extensions(id).map((e) => [e.manifest.id, e]));
    expect(views.one).toMatchObject({
      status: "revoked",
      reason: "manifest_revoked",
      approved: false,
    });
    expect(views.two).toMatchObject({ status: "trusted", approved: true });
    expect(await m.authorize(id, "one", "pageAction", ORIGIN)).toBe(false);
    expect(await m.authorize(id, "two", "pageAction", ORIGIN)).toBe(true);
  });

  it("an installed extension stops running when the registry document expires, and on a restart without one", async () => {
    const { registry, settings, now } = setup();
    registry.load(signed());
    const m = manager(registry, settings);
    const { id } = m.create("A");
    m.install(id, extension());
    m.approve(id, "reader", true);
    now.at = T0 + 30 * DAY;
    expect(m.extensions(id)[0]).toMatchObject({ status: "untrusted", reason: "registry_expired" });
    expect(await m.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);

    const bare = new SignerRegistry({
      rootPublicKey: pem(otherRootKeys.publicKey),
      store: new Settings(),
    });
    const restarted = manager(bare, settings);
    expect(restarted.extensions(id)[0]).toMatchObject({
      status: "untrusted",
      reason: "registry_missing",
    });
    expect(await restarted.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
  });

  it("an extension that predates signature storage is never trusted", async () => {
    const { registry } = setup();
    registry.load(signed());
    const settings = new Settings();
    const m = manager(registry, settings);
    const { id } = m.create("A");
    const state = settings.get<{ extensions: Record<string, unknown[]> }>("browser.profiles.v1", {
      extensions: {},
    });
    state.extensions[id] = [{ manifest: manifest(), signer: "acme", approved: true }];
    settings.set("browser.profiles.v1", state);
    expect(m.extensions(id)[0]).toMatchObject({
      status: "untrusted",
      reason: "signature_missing",
      approved: false,
    });
    expect(await m.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
  });

  it("a signer key rotated in a later document invalidates what the old key signed", async () => {
    const { registry } = setup();
    registry.load(signed());
    const m = manager(registry);
    const { id } = m.create("A");
    m.install(id, extension());
    m.approve(id, "reader", true);
    const rotated = generateKeyPairSync("ed25519");
    registry.load(
      signed({
        sequence: 2,
        issued_at: iso(T0 + 1000),
        signers: [
          {
            id: "acme",
            public_key: pem(rotated.publicKey),
            valid_from: iso(T0 - DAY),
            status: "active",
          },
        ],
      }),
    );
    expect(m.extensions(id)[0]).toMatchObject({ status: "untrusted", reason: "signature_invalid" });
    expect(await m.authorize(id, "reader", "pageAction", ORIGIN)).toBe(false);
  });

  it("never exposes the signature, and logs nothing but ids and codes", () => {
    const { registry } = setup();
    registry.load(signed());
    const m = manager(registry);
    const { id } = m.create("A");
    const installed = m.install(id, extension());
    expect(Object.keys(installed).sort()).toEqual(["approved", "manifest", "signer", "status"]);
    expect(JSON.stringify(m.extensions(id))).not.toContain("signature");
  });
});
