// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import {
  PERMISSION_DESCRIPTIONS,
  validateManifest,
  type CapabilityManifest,
  type Permission,
} from "@phoenix/protocol";

/** Registry input is local and explicitly trusted; no network lookup or executable evaluation. */
export interface RegistryEntry {
  id: string;
  version: string;
  manifest: CapabilityManifest;
  permissions: Permission[];
  data_categories: string[];
  license: string;
  compatibility: { sdk: string; core: string; protocol: "1" };
  artifact: { file: string; sha256: string; size: number };
  security: { contact: string; advisory_url: string };
}
export interface RegistryIndex {
  format_version: 1;
  entries: RegistryEntry[];
}
export interface SignedIndex {
  index: RegistryIndex;
  key_id: string;
  signature: string;
}

/** Opaque result of signature and schema validation; never accept arbitrary JSON in preview. */
declare const verifiedIndex: unique symbol;
export type VerifiedRegistryIndex = Readonly<RegistryIndex> & { readonly [verifiedIndex]: true };
export interface RegistryVersions {
  sdk: string;
  core: string;
  protocol: "1";
}
export interface RegistryPreview {
  entry: RegistryEntry;
  permission_descriptions: Record<string, string>;
  data_categories: string[];
  license_policy: string;
  sandbox_status: "unavailable";
  installable: false;
}

const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const IDENTIFIER = /^[a-z][a-z0-9_-]{1,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const SAFE_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SPDX_ALLOWED: Readonly<Record<string, true>> = {
  "GPL-3.0-only": true,
  "GPL-3.0-or-later": true,
  "LGPL-3.0-only": true,
  "LGPL-3.0-or-later": true,
  MIT: true,
  "Apache-2.0": true,
  "BSD-2-Clause": true,
  "BSD-3-Clause": true,
  ISC: true,
};
const FIELDS = {
  envelope: ["index", "key_id", "signature"],
  index: ["format_version", "entries"],
  entry: [
    "id",
    "version",
    "manifest",
    "permissions",
    "data_categories",
    "license",
    "compatibility",
    "artifact",
    "security",
  ],
  compatibility: ["sdk", "core", "protocol"],
  artifact: ["file", "sha256", "size"],
  security: ["contact", "advisory_url"],
} as const;

export class RegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}
function reject(code: string, message: string): never {
  throw new RegistryError(code, message);
}
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    reject("INVALID_INDEX", `Invalid ${label}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 256): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    reject("INVALID_INDEX", `Invalid ${label}`);
  return value;
}
function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some(
      (v) => typeof v !== "string" || !v.length || v.length > 128 || /[\x00-\x1f\x7f]/.test(v),
    ) ||
    new Set(value).size !== value.length
  )
    reject("INVALID_INDEX", `Invalid ${label}`);
  return value;
}
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}
function compareVersion(actual: string, required: string): boolean {
  const a = VERSION.exec(actual);
  const b = VERSION.exec(required);
  if (!a || !b) return false;
  // Registry declares a minimum within the same major; never silently cross a breaking major.
  if (a[1] !== b[1]) return false;
  for (let i = 2; i <= 3; i++) {
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  }
  return !a[4] || (!!b[4] && a[4] === b[4]);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
function safeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_INDEX_BYTES) reject("INVALID_INDEX", "Index exceeds size limit");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return reject("INVALID_INDEX", "Corrupt index JSON");
  }
}

/** Signed metadata cannot smuggle parser-dependent prototype keys or unbounded nesting. */
function safeTree(value: unknown, depth = 0): void {
  if (depth > 32) reject("INVALID_INDEX", "Index nesting exceeds limit");
  if (Array.isArray(value)) {
    for (const item of value) safeTree(item, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        reject("INVALID_INDEX", "Unsafe metadata key");
      safeTree(child, depth + 1);
    }
  }
}
function validateEntry(value: unknown, versions: RegistryVersions): RegistryEntry {
  const e = record(value, FIELDS.entry, "entry");
  const id = text(e.id, "id");
  if (!IDENTIFIER.test(id)) reject("INVALID_INDEX", "Invalid capability id");
  const version = text(e.version, "version");
  if (!VERSION.test(version)) reject("INVALID_INDEX", "Invalid capability version");
  const result = validateManifest(e.manifest);
  if (!result.ok) reject("INVALID_MANIFEST", result.error.message);
  const manifest = result.manifest;
  if (manifest.id !== id || manifest.version !== version)
    reject("INVALID_MANIFEST", "Entry and manifest identity differ");
  const permissions = strings(e.permissions, "permissions");
  const dataCategories = strings(e.data_categories, "data categories");
  if (
    !Array.isArray(manifest.data_categories) ||
    !sameSet(dataCategories, manifest.data_categories) ||
    !sameSet(permissions, manifest.permissions)
  )
    reject("PERMISSION_MISMATCH", "Permission or data disclosure differs from manifest");
  const license = text(e.license, "license");
  if (license !== manifest.license) reject("INVALID_MANIFEST", "Licence differs from manifest");
  if (!Object.hasOwn(SPDX_ALLOWED, license))
    reject("FORBIDDEN_LICENSE", "Licence is not on the reviewed GPL-3.0 compatibility allowlist");
  const compatibility = record(e.compatibility, FIELDS.compatibility, "compatibility");
  for (const name of ["sdk", "core"] as const) {
    const min = text(compatibility[name], `${name} compatibility`);
    if (!VERSION.test(min)) reject("INVALID_INDEX", `Invalid ${name} version`);
    if (!compareVersion(versions[name], min))
      reject("INCOMPATIBLE_VERSION", `Requires ${name} ${min} (same major)`);
  }
  if (
    compatibility.protocol !== versions.protocol ||
    (manifest.compatibility?.protocol && manifest.compatibility.protocol !== versions.protocol)
  )
    reject("INCOMPATIBLE_VERSION", "Unsupported protocol major");
  const artifact = record(e.artifact, FIELDS.artifact, "artifact");
  const file = text(artifact.file, "artifact filename", 128);
  if (
    !SAFE_FILE.test(file) ||
    file === "." ||
    file === ".." ||
    file.startsWith(".") ||
    isAbsolute(file) ||
    basename(file) !== file
  )
    reject("INVALID_INDEX", "Unsafe artifact path");
  if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256))
    reject("INVALID_INDEX", "Invalid artifact digest");
  if (
    !Number.isSafeInteger(artifact.size) ||
    (artifact.size as number) < 1 ||
    (artifact.size as number) > MAX_ARTIFACT_BYTES
  )
    reject("INVALID_INDEX", "Invalid artifact size");
  const security = record(e.security, FIELDS.security, "security metadata");
  const contact = text(security.contact, "security contact");
  const advisory = text(security.advisory_url, "security advisory URL");
  if (
    !/^mailto:[^\s@]+@[^\s@]+$/.test(contact) ||
    !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(advisory)
  )
    reject("INVALID_INDEX", "Security contact must be mailto and advisory HTTPS");
  return e as unknown as RegistryEntry;
}

/** Prevent callers mutating a verified disclosure or artifact digest after signature checks. */
function freezeIndex(index: RegistryIndex): RegistryIndex {
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(index);
  return index;
}

/** Trust keys are provisioned by the host, not supplied by the index. Ed25519 only. */
export class RegistryService {
  private readonly keys: ReadonlyMap<string, KeyObject>;
  private readonly verified = new WeakSet<object>();
  constructor(
    trustedKeys: ReadonlyMap<string, string | KeyObject>,
    private readonly versions: RegistryVersions,
  ) {
    const keys = new Map<string, KeyObject>();
    for (const [id, key] of trustedKeys) {
      if (!IDENTIFIER.test(id)) reject("INVALID_TRUST", "Invalid trusted key id");
      const publicKey = typeof key === "string" ? createPublicKey(key) : key;
      if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519")
        reject("INVALID_TRUST", "Only Ed25519 public keys are accepted");
      keys.set(id, publicKey);
    }
    this.keys = keys;
  }

  loadIndex(bytes: Uint8Array): VerifiedRegistryIndex {
    const envelope = record(safeJson(bytes), FIELDS.envelope, "signed envelope");
    const keyId = text(envelope.key_id, "key id");
    const key = this.keys.get(keyId);
    if (!key) reject("UNTRUSTED_KEY", "Index signer is not trusted");
    const signature = text(envelope.signature, "signature", 128);
    if (!/^[A-Za-z0-9_-]{86}$/.test(signature))
      reject("INVALID_SIGNATURE", "Malformed Ed25519 signature");
    const index = record(envelope.index, FIELDS.index, "index");
    if (index.format_version !== 1 || !Array.isArray(index.entries) || index.entries.length > 1000)
      reject("INVALID_INDEX", "Unsupported index format");
    // Structural resource guard precedes recursive canonicalization; manifest validation follows signature verification.
    safeTree(index);
    if (!verify(null, Buffer.from(canonical(index)), key, Buffer.from(signature, "base64url")))
      reject("INVALID_SIGNATURE", "Index signature mismatch");
    const seen = new Set<string>();
    for (const value of index.entries) {
      const entry = validateEntry(value, this.versions);
      const identity = `${entry.id}@${entry.version}`;
      if (seen.has(identity)) reject("INVALID_INDEX", "Duplicate capability version");
      seen.add(identity);
    }
    const frozen = freezeIndex(index as unknown as RegistryIndex);
    this.verified.add(frozen);
    return frozen as VerifiedRegistryIndex;
  }

  preview(index: VerifiedRegistryIndex, id: string, version: string): RegistryPreview {
    if (!this.verified.has(index))
      reject("UNTRUSTED_INDEX", "Index was not verified by this registry service");
    const entry = index.entries.find((e) => e.id === id && e.version === version);
    if (!entry) reject("NOT_FOUND", "Capability version not in trusted index");
    return {
      entry,
      permission_descriptions: Object.fromEntries(
        entry.permissions.map((p) => [p, PERMISSION_DESCRIPTIONS[p]]),
      ),
      data_categories: [...entry.data_categories],
      license_policy:
        "Reviewed SPDX allowlist compatible with Phoenix GPL-3.0; redistribution still requires independent legal review.",
      sandbox_status: "unavailable",
      installable: false,
    };
  }

  /** Only verifies local artifact integrity. It does NOT load, evaluate, extract or install code. */
  async verifyLocalArtifact(
    index: VerifiedRegistryIndex,
    id: string,
    version: string,
    trustedDirectory: string,
  ): Promise<void> {
    const { entry } = this.preview(index, id, version);
    const directory = await realpath(trustedDirectory);
    const file = join(directory, entry.artifact.file);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== entry.artifact.size || stat.size > MAX_ARTIFACT_BYTES)
        reject("ARTIFACT_MISMATCH", "Artifact type or size differs");
      const hash = createHash("sha256");
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      if (hash.digest("hex") !== entry.artifact.sha256)
        reject("ARTIFACT_MISMATCH", "Artifact checksum differs");
    } finally {
      await handle.close();
    }
  }

  /** Unsandboxed Node execution is not isolation; third-party installation is deliberately refused. */
  install(): never {
    return reject(
      "SANDBOX_UNAVAILABLE",
      "Third-party executable installation requires an audited OS sandbox",
    );
  }
}
