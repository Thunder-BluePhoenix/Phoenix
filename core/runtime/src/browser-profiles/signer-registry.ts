// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 96 browser-extension signer registry: who may sign extensions, and what has been revoked.
//
// The registry is one signed JSON document that the Core host supplies as bytes (a file it chose;
// nothing here touches the network). It is verified against a root public key pinned by the host,
// never against a key inside the document. Like the capability registry (docs/capabilities/
// registry.md) it is offline: distribution is "put a new signed file where the host reads it".
//
// Fail-closed rules: a document that is oversize, malformed, has unknown fields or duplicate ids,
// fails its signature, is not newer than the last accepted one (rollback), is expired, or is
// issued in the future is refused and the previous document stays in force. Once the accepted
// document passes its own `expires_at`, every extension is refused until a fresher one is loaded.
// Errors carry a closed code only, never document contents or key material.
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import type { SettingsStore } from "@phoenix/persistence";
import { canonicalJson } from "@phoenix/workflows";
import { isRecord } from "../mcp/guards";

export const MAX_SIGNER_REGISTRY_BYTES = 256 * 1024;
export const MAX_REGISTRY_SIGNERS = 200;
export const MAX_REGISTRY_REVOCATIONS = 1000;
/** A document may be valid for at most this long, so a stale one cannot stay in force for ever. */
export const MAX_REGISTRY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
/** How far ahead of this clock a document may claim to have been issued. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const STORE_KEY = "browser.signer-registry.v1";

export const SIGNER_STATUSES = ["active", "disabled"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];
export const REVOCATION_KINDS = ["signer", "manifest"] as const;
export type RevocationKind = (typeof REVOCATION_KINDS)[number];
export const REVOCATION_REASONS = [
  "key_compromise",
  "malicious_extension",
  "vulnerability",
  "superseded",
  "policy_violation",
  "signer_retired",
] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export interface RegistrySigner {
  id: string;
  /** Ed25519 public key, SPKI PEM. */
  public_key: string;
  valid_from: string;
  expires_at?: string;
  status: SignerStatus;
}
export interface RegistryRevocation {
  kind: RevocationKind;
  /** A signer id (kind `signer`) or the lowercase sha256 hex of `canonicalManifest` (`manifest`). */
  target: string;
  revoked_at: string;
  reason: RevocationReason;
}
export interface SignerRegistryBody {
  format_version: 1;
  /** Strictly increasing across accepted documents; a lower or equal one is refused. */
  sequence: number;
  issued_at: string;
  expires_at: string;
  signers: RegistrySigner[];
  revocations: RegistryRevocation[];
}
/** What the host distributes: the body and the root's Ed25519 signature over its canonical JSON. */
export interface SignerRegistryDocument {
  registry: SignerRegistryBody;
  /** base64url Ed25519 signature over `canonicalJson(registry)`. */
  signature: string;
}

export const REGISTRY_ERROR_CODES = [
  "INVALID_ROOT_KEY",
  "OVERSIZE",
  "MALFORMED",
  "UNKNOWN_FIELD",
  "INVALID_FIELD",
  "DUPLICATE_ID",
  "BAD_SIGNATURE",
  "ROLLBACK",
  "EXPIRED",
  "NOT_YET_VALID",
  "STORAGE",
] as const;
export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

/** The message is the closed code and nothing else: no ids, bytes, keys or parser detail. */
export class SignerRegistryError extends Error {
  constructor(readonly code: RegistryErrorCode) {
    super(`Signer registry refused: ${code}`);
    this.name = "SignerRegistryError";
  }
}

export const TRUST_REFUSALS = [
  "unknown_signer",
  "signer_revoked",
  "manifest_revoked",
  "signer_disabled",
  "signer_expired",
  "signer_not_yet_valid",
  "registry_missing",
  "registry_expired",
] as const;
export type TrustRefusal = (typeof TRUST_REFUSALS)[number];
export type TrustDecision =
  { trusted: true; publicKey: string } | { trusted: false; reason: TrustRefusal };

/** What the extension manager asks, at install and again on every later load or authorisation. */
export interface ExtensionTrust {
  resolve(signer: string, manifestSha256: string): TrustDecision;
}

/**
 * The older, static trust: a host-supplied signer map with no revocation and no expiry. Kept for
 * hosts that pin keys in their own configuration; the registry below is what adds revocation.
 */
export function pinnedSigners(signers: Readonly<Record<string, string>>): ExtensionTrust {
  return {
    resolve: (signer) =>
      SIGNER_ID.test(signer) && Object.hasOwn(signers, signer)
        ? { trusted: true, publicKey: signers[signer] as string }
        : { trusted: false, reason: "unknown_signer" },
  };
}

const SIGNER_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

const refuse = (code: RegistryErrorCode): never => {
  throw new SignerRegistryError(code);
};

/** Exactly these keys: every required one present, no key outside required and optional. */
function exactKeys(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) return refuse("MALFORMED");
  const keys = Object.keys(value);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key)))
    return refuse("UNKNOWN_FIELD");
  if (required.some((key) => !Object.hasOwn(value, key))) return refuse("INVALID_FIELD");
  return value;
}

function instant(value: unknown): number {
  if (typeof value !== "string" || !ISO.test(value)) return refuse("INVALID_FIELD");
  const at = Date.parse(value);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value) return refuse("INVALID_FIELD");
  return at;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : refuse("INVALID_FIELD");
}

function ed25519Pem(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    return refuse("INVALID_FIELD");
  try {
    const key = createPublicKey(value);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519")
      return refuse("INVALID_FIELD");
  } catch (error) {
    if (error instanceof SignerRegistryError) throw error;
    return refuse("INVALID_FIELD");
  }
  return value;
}

function parseSigner(raw: unknown): RegistrySigner {
  const value = exactKeys(raw, ["id", "public_key", "valid_from", "status"], ["expires_at"]);
  if (typeof value.id !== "string" || !SIGNER_ID.test(value.id)) return refuse("INVALID_FIELD");
  const from = instant(value.valid_from);
  const until = value.expires_at === undefined ? undefined : instant(value.expires_at);
  if (until !== undefined && until <= from) return refuse("INVALID_FIELD");
  return {
    id: value.id,
    public_key: ed25519Pem(value.public_key),
    valid_from: value.valid_from as string,
    ...(until === undefined ? {} : { expires_at: value.expires_at as string }),
    status: oneOf(value.status, SIGNER_STATUSES),
  };
}

function parseRevocation(raw: unknown, issuedAt: number): RegistryRevocation {
  const value = exactKeys(raw, ["kind", "target", "revoked_at", "reason"]);
  const kind = oneOf(value.kind, REVOCATION_KINDS);
  const target = value.target;
  if (typeof target !== "string") return refuse("INVALID_FIELD");
  if (kind === "signer" ? !SIGNER_ID.test(target) : !SHA256_HEX.test(target))
    return refuse("INVALID_FIELD");
  // A revocation cannot be dated after the document that carries it.
  if (instant(value.revoked_at) > issuedAt) return refuse("INVALID_FIELD");
  return {
    kind,
    target,
    revoked_at: value.revoked_at as string,
    reason: oneOf(value.reason, REVOCATION_REASONS),
  };
}

function parseBody(raw: unknown): SignerRegistryBody {
  const value = exactKeys(raw, [
    "format_version",
    "sequence",
    "issued_at",
    "expires_at",
    "signers",
    "revocations",
  ]);
  if (value.format_version !== 1) return refuse("INVALID_FIELD");
  if (
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1
  )
    return refuse("INVALID_FIELD");
  const issuedAt = instant(value.issued_at);
  const expiresAt = instant(value.expires_at);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_REGISTRY_LIFETIME_MS)
    return refuse("INVALID_FIELD");
  if (!Array.isArray(value.signers) || value.signers.length > MAX_REGISTRY_SIGNERS)
    return refuse("INVALID_FIELD");
  if (!Array.isArray(value.revocations) || value.revocations.length > MAX_REGISTRY_REVOCATIONS)
    return refuse("INVALID_FIELD");
  const signers = value.signers.map(parseSigner);
  if (new Set(signers.map((signer) => signer.id)).size !== signers.length)
    return refuse("DUPLICATE_ID");
  const revocations = value.revocations.map((item) => parseRevocation(item, issuedAt));
  if (new Set(revocations.map((item) => `${item.kind}:${item.target}`)).size !== revocations.length)
    return refuse("DUPLICATE_ID");
  return {
    format_version: 1,
    sequence: value.sequence,
    issued_at: value.issued_at as string,
    expires_at: value.expires_at as string,
    signers,
    revocations,
  };
}

interface Accepted {
  body: SignerRegistryBody;
  sha256: string;
  issuedAt: number;
  expiresAt: number;
  signers: Map<string, RegistrySigner>;
  revokedSigners: Set<string>;
  revokedManifests: Set<string>;
}

interface Stored {
  /** Fingerprint of the pinned root, so a rotated root does not inherit another root's sequence. */
  root: string;
  sequence: number;
  /** The accepted document, kept so revocation still applies after a restart. */
  document: string;
}

export interface SignerRegistryStatus {
  loaded: boolean;
  sequence: number | null;
  issued_at: string | null;
  expires_at: string | null;
  expired: boolean;
  signers: Array<{ id: string; status: SignerStatus }>;
  revocations: Array<Pick<RegistryRevocation, "kind" | "target" | "reason">>;
}

export interface SignerRegistryOptions {
  /** Root Ed25519 public key (SPKI PEM), pinned by whoever builds Core. Never read from a document. */
  rootPublicKey: string;
  /** Where the last accepted sequence and document persist (the settings store, like profiles). */
  store: Pick<SettingsStore, "get" | "set">;
  now?: () => number;
}

export class SignerRegistry implements ExtensionTrust {
  private readonly root: KeyObject;
  private readonly rootId: string;
  private readonly now: () => number;
  private current: Accepted | undefined;
  /** Highest sequence ever accepted for this root; survives even if the document cannot be re-read. */
  private floor = 0;

  constructor(private readonly options: SignerRegistryOptions) {
    this.now = options.now ?? Date.now;
    try {
      const key = createPublicKey(options.rootPublicKey);
      if (key.type !== "public" || key.asymmetricKeyType !== "ed25519")
        throw new SignerRegistryError("INVALID_ROOT_KEY");
      this.root = key;
      this.rootId = createHash("sha256")
        .update(key.export({ type: "spki", format: "der" }))
        .digest("hex");
    } catch {
      throw new SignerRegistryError("INVALID_ROOT_KEY");
    }
    this.restore();
  }

  private restore(): void {
    const stored = this.options.store.get<Stored | null>(STORE_KEY, null);
    if (
      !isRecord(stored) ||
      stored.root !== this.rootId ||
      typeof stored.document !== "string" ||
      typeof stored.sequence !== "number" ||
      !Number.isSafeInteger(stored.sequence)
    )
      return;
    this.floor = stored.sequence;
    try {
      // Re-verified against the pinned root: a doctored settings row cannot add a signer.
      this.current = this.verifyBytes(Buffer.from(stored.document, "utf8"));
    } catch {
      this.current = undefined;
    }
  }

  /** Parse and verify bytes against the pinned root. Does not look at the clock or the sequence. */
  private verifyBytes(bytes: Uint8Array): Accepted {
    if (bytes.byteLength === 0) return refuse("MALFORMED");
    if (bytes.byteLength > MAX_SIGNER_REGISTRY_BYTES) return refuse("OVERSIZE");
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return refuse("MALFORMED");
    }
    const envelope = exactKeys(parsed, ["registry", "signature"]);
    if (typeof envelope.signature !== "string" || !SIGNATURE.test(envelope.signature))
      return refuse("BAD_SIGNATURE");
    const body = parseBody(envelope.registry);
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(canonicalJson(body)),
        this.root,
        Buffer.from(envelope.signature, "base64url"),
      );
    } catch {
      // Treated as a bad signature.
    }
    if (!valid) return refuse("BAD_SIGNATURE");
    return {
      body,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      issuedAt: Date.parse(body.issued_at),
      expiresAt: Date.parse(body.expires_at),
      signers: new Map(body.signers.map((signer) => [signer.id, signer])),
      revokedSigners: new Set(
        body.revocations.filter((item) => item.kind === "signer").map((item) => item.target),
      ),
      revokedManifests: new Set(
        body.revocations.filter((item) => item.kind === "manifest").map((item) => item.target),
      ),
    };
  }

  /**
   * Verifies and activates a document. Refuses (and keeps the current one) on any failure. The same
   * accepted bytes supplied again are a no-op (`changed: false`), so a host may re-read its file on
   * every start; any other document whose sequence is not above the last accepted one is a rollback.
   */
  load(bytes: Uint8Array): { changed: boolean; sequence: number } {
    const accepted = this.verifyBytes(bytes);
    const now = this.now();
    if (accepted.issuedAt > now + MAX_CLOCK_SKEW_MS) return refuse("NOT_YET_VALID");
    if (now >= accepted.expiresAt) return refuse("EXPIRED");
    if (this.current?.sha256 === accepted.sha256)
      return { changed: false, sequence: accepted.body.sequence };
    if (accepted.body.sequence <= this.floor) return refuse("ROLLBACK");
    const stored: Stored = {
      root: this.rootId,
      sequence: accepted.body.sequence,
      document: Buffer.from(bytes).toString("utf8"),
    };
    try {
      this.options.store.set(STORE_KEY, stored);
    } catch {
      return refuse("STORAGE");
    }
    this.floor = accepted.body.sequence;
    this.current = accepted;
    return { changed: true, sequence: accepted.body.sequence };
  }

  resolve(signer: string, manifestSha256: string): TrustDecision {
    const current = this.current;
    if (!current) return { trusted: false, reason: "registry_missing" };
    const now = this.now();
    if (now >= current.expiresAt) return { trusted: false, reason: "registry_expired" };
    if (typeof signer !== "string" || !SIGNER_ID.test(signer))
      return { trusted: false, reason: "unknown_signer" };
    if (current.revokedSigners.has(signer)) return { trusted: false, reason: "signer_revoked" };
    if (current.revokedManifests.has(manifestSha256))
      return { trusted: false, reason: "manifest_revoked" };
    const entry = current.signers.get(signer);
    if (!entry) return { trusted: false, reason: "unknown_signer" };
    if (entry.status !== "active") return { trusted: false, reason: "signer_disabled" };
    if (now < Date.parse(entry.valid_from))
      return { trusted: false, reason: "signer_not_yet_valid" };
    if (entry.expires_at !== undefined && now >= Date.parse(entry.expires_at))
      return { trusted: false, reason: "signer_expired" };
    return { trusted: true, publicKey: entry.public_key };
  }

  status(): SignerRegistryStatus {
    const current = this.current;
    return {
      loaded: current !== undefined,
      sequence: current?.body.sequence ?? null,
      issued_at: current?.body.issued_at ?? null,
      expires_at: current?.body.expires_at ?? null,
      expired: current !== undefined && this.now() >= current.expiresAt,
      signers: (current?.body.signers ?? []).map(({ id, status }) => ({ id, status })),
      revocations: (current?.body.revocations ?? []).map(({ kind, target, reason }) => ({
        kind,
        target,
        reason,
      })),
    };
  }
}
