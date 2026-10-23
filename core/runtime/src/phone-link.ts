// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phone Link (Phase 71), Core side. Off by default. When the user turns it on, a SEPARATE HTTPS
// listener opens on ONE LAN address (never the loopback API port, never 0.0.0.0) with a
// self-signed certificate Phoenix made (phone-cert.ts) that the phone pins. A phone pairs once
// with a short-lived single-use code shown only in the desktop UI plus its own P-256 public key;
// a person confirms the pairing on the desktop through the generic confirmation mechanism. Every
// later request is signed by the device key (never the session token), is replay-protected, and
// approvals are bound to the exact request through a hash Core recomputes. Approving or denying goes
// through the SAME audited paths as the desktop (PermissionGateway.resolveConfirmation,
// AgentApprovals.decide) with the actor `device:<id>`. docs/phone-link.md is the protocol contract.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import {
  PhoneListener,
  PhoneThrottledError,
  type PhoneApi,
  type PhoneApprovalView,
  type PhoneAuthRequest,
  type PhoneDeviceApi,
  type PhoneDeviceView,
  type PhoneIdentity,
  type PhonePairProgress,
  type PhonePairingView,
  type PhoneStatusView,
} from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import { DeviceStore, type Database, type SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { canonicalJson } from "@phoenix/workflows";
import {
  HIDDEN_TEXT_CHARS,
  systemClock,
  type AgentApprovals,
  type ApprovalClock,
} from "./agent-approvals";
import { ensureTlsIdentity, removeTlsIdentity } from "./phone-cert";

/** Capability id the pairing confirmation is raised under. A phone can never answer it. */
export const PHONE_CAPABILITY = "phone-link";
export const DEFAULT_PHONE_PORT = 47821;
export const PAIRING_TTL_MS = 120_000;
/** Wrong codes one remote address may send while a code is live before that address is locked out. */
export const MAX_WRONG_CODES = 5;
/** Per-address lockout; also pairing's global pause once {@link MAX_WRONG_CODES_PER_CODE} is hit. */
export const LOCKOUT_MS = 300_000;
/**
 * Wrong guesses, from ALL addresses together, one live code survives. The next one destroys the
 * code and pauses pairing for {@link LOCKOUT_MS}. A bad request while NO code is live counts
 * for nothing (there is nothing to guess), so unauthenticated noise cannot kill a code or lock pairing.
 */
export const MAX_WRONG_CODES_PER_CODE = 20;
/** A signed request is accepted within this distance of Core's clock. */
export const CLOCK_WINDOW_MS = 60_000;
/** A nonce is remembered for two windows: a request signed at T is valid from T-60 s to T+60 s. */
export const NONCE_TTL_MS = 2 * CLOCK_WINDOW_MS;
export const MAX_NONCES = 4096;
/** One device can hold at most this many nonces, so 20 devices cannot fill {@link MAX_NONCES}. */
export const MAX_NONCES_PER_DEVICE = 200;
export const AUTH_FAILURES_PER_MINUTE = 10;
export const MAX_DEVICES = 20;
const MAX_NAME_CHARS = 64;
const MAX_PAIR_RESULTS = 16;
const MAX_FAILURE_KEYS = 1000;
const AUDIT_FAILURES_PER_MINUTE = 20;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
const STATEMENT_VERSION = "phoenix-phone-approval-v1";
const REQUEST_VERSION = "PHX1";
const KEY_ENABLED = "phone.enabled";
const KEY_VERIFY = "phone.require_user_verification";
const KEY_ADDRESS = "phone.address";
const KEY_PORT = "phone.port";

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE_ID = /^dev_[0-9a-f]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const sha256 = (...parts: (string | Buffer)[]): Buffer => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

/** SHA-256 as uppercase hex pairs joined by `:` (the shape `X509Certificate.fingerprint256` has). */
export function formatFingerprint(digest: Buffer): string {
  return digest.toString("hex").toUpperCase().match(/../g)!.join(":");
}

/** What a phone signs for one request (docs/phone-link.md §Request signing). */
export function signedRequestText(
  deviceId: string,
  method: string,
  target: string,
  timestamp: string,
  nonce: string,
  body: Buffer,
): string {
  return [
    REQUEST_VERSION,
    deviceId,
    method,
    target,
    timestamp,
    nonce,
    sha256(body).toString("hex"),
  ].join("\n");
}

/** The hash a decision is bound to (docs/phone-link.md §Approvals). */
export function requestHash(binding: {
  source: string;
  id: string;
  tool: string;
  preview_hash: string;
  expires_at: string;
}): string {
  return sha256(STATEMENT_VERSION, "\n", canonicalJson(binding)).toString("hex");
}

export const previewHash = (preview: Record<string, unknown>): string =>
  sha256(canonicalJson(preview)).toString("hex");

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("Body must be a JSON object");
  return value as Record<string, unknown>; // checked just above: non-null, non-array object
}

function deviceName(value: unknown): string {
  if (typeof value !== "string") throw invalid('"name" must be text');
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_NAME_CHARS || HIDDEN_TEXT_CHARS.test(name))
    throw invalid(`"name" must be 1-${MAX_NAME_CHARS} visible characters`);
  return name;
}

function deviceKey(value: unknown): { spki: Buffer; fingerprint: string } {
  if (typeof value !== "string" || value.length > 400 || !BASE64.test(value))
    throw invalid('"public_key" must be a base64 SPKI P-256 key');
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
      throw new Error("not P-256");
    const spki = key.export({ type: "spki", format: "der" });
    return { spki, fingerprint: formatFingerprint(sha256(spki)) };
  } catch {
    throw invalid('"public_key" must be a base64 SPKI P-256 key');
  }
}

const normaliseCode = (value: unknown): string =>
  typeof value === "string" ? value.toUpperCase().replace(/[\s-]/g, "") : "";

function newCode(): string {
  const raw = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of raw) code += CODE_ALPHABET[byte & 31];
  return code;
}

const groupCode = (code: string): string => code.match(/.{4}/g)!.join("-");

/** Sliding-window failure counter per key, bounded in size. */
class FailureLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private live(key: string, now: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  /** Seconds until a blocked key may try again; 0 when it may. */
  retryAfter(key: string, now: number): number {
    const kept = this.live(key, now);
    if (kept.length < this.limit) return 0;
    return Math.max(1, Math.ceil((kept[0]! + this.windowMs - now) / 1000));
  }

  record(key: string, now: number): void {
    if (this.hits.size >= MAX_FAILURE_KEYS && !this.hits.has(key)) {
      for (const k of [...this.hits.keys()]) this.live(k, now);
      if (this.hits.size >= MAX_FAILURE_KEYS) this.hits.delete(this.hits.keys().next().value!);
    }
    this.hits.set(key, [...this.live(key, now), now]);
  }

  clear(): void {
    this.hits.clear();
  }
}

export interface PhoneListenerHandle {
  listen(port: number): Promise<{ port: number }>;
  close(): Promise<void>;
}

/** Tests inject a clock, the LAN addresses and a port; production uses the defaults. */
export interface PhoneLinkTuning {
  clock?: ApprovalClock;
  /** Addresses the user may bind to. Default: this machine's private LAN IPv4 addresses ({@link lanAddressesFrom}). */
  lanAddresses?: () => string[];
  /** Ports Core itself uses (the loopback API, the MCP server): the phone link refuses to be set to one. */
  reservedPorts?: () => readonly number[];
  /** 0 = any free port (tests). Default {@link DEFAULT_PHONE_PORT}. */
  port?: number;
  /** Listener tuning (tests shorten these); see PhoneListenerOptions. */
  handshakeTimeoutMs?: number;
  maxConnectionsPerAddress?: number;
  /** Removes the TLS key and certificate (tests inject a failing one). Default {@link removeTlsIdentity}. */
  removeIdentity?: (dir: string) => void;
}

export interface PhoneLinkDeps extends PhoneLinkTuning {
  /** True inside the demo runtime: it never opens a socket on the network. */
  unavailable?: boolean;
  db: Database;
  settings: SettingsStore;
  bus: Pick<EventBus, "subscribe">;
  permissions: PermissionGateway;
  agentApprovals: Pick<AgentApprovals, "list" | "decide">;
  dataDir: string;
  logger: Logger;
}

interface ActiveCode {
  hash: Buffer;
  expiresAt: number;
}

interface PendingPair {
  id: string;
  name: string;
  spki: Buffer;
  keyFingerprint: string;
  requestedAt: number;
  expiresAt: number;
  confirmationId: string | null;
  abort: AbortController;
  cancelTimer: () => void;
}

interface Running {
  listener: PhoneListenerHandle;
  address: string;
  port: number;
  fingerprint: string;
}

const isPrivateLan = (address: string): boolean => {
  const [a = -1, b = -1] = address.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT / Tailscale
  );
};

/**
 * The addresses the listener may bind to: RFC 1918 (10/8, 172.16/12, 192.168/16) and 100.64/10
 * IPv4 only. A public address, loopback or link-local one is never offered, so the listener cannot
 * open on an interface that faces the internet.
 */
export function lanAddressesFrom(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): string[] {
  const out: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateLan(entry.address))
        out.push(entry.address);
    }
  }
  return out;
}

const defaultLanAddresses = (): string[] => lanAddressesFrom(networkInterfaces());

export class PhoneLink implements PhoneApi, PhoneDeviceApi {
  readonly devicesStore: DeviceStore;
  private readonly clock: ApprovalClock;
  private readonly lan: () => string[];
  private readonly port: number;
  private readonly tlsDir: string;
  private readonly logger: Logger;
  private readonly nonces = new Map<string, number>();
  private readonly pairResults = new Map<string, PhonePairProgress>();
  private readonly authFailures = new FailureLimiter(AUTH_FAILURES_PER_MINUTE, 60_000);
  private readonly auditBudget = new FailureLimiter(AUDIT_FAILURES_PER_MINUTE, 60_000);
  private code: ActiveCode | null = null;
  private pending: PendingPair | null = null;
  private readonly nonceCounts = new Map<string, number>();
  /** Wrong guesses made, from every address together, against the CURRENT live code. */
  private codeGuesses = 0;
  /** Pairing is paused until then because one live code took {@link MAX_WRONG_CODES_PER_CODE} guesses. */
  private lockedUntil = 0;
  private readonly reservedPorts: () => readonly number[];
  /** Wrong codes per remote address while a code was live; an address over the limit is locked out. */
  private readonly pairFailures = new FailureLimiter(MAX_WRONG_CODES, LOCKOUT_MS);
  private readonly removeIdentity: (dir: string) => void;
  private running: Running | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  constructor(private readonly d: PhoneLinkDeps) {
    this.devicesStore = new DeviceStore(d.db);
    this.clock = d.clock ?? systemClock;
    this.lan = d.lanAddresses ?? defaultLanAddresses;
    this.port = d.port ?? DEFAULT_PHONE_PORT;
    this.reservedPorts = d.reservedPorts ?? (() => []);
    this.removeIdentity = d.removeIdentity ?? removeTlsIdentity;
    this.tlsDir = join(d.dataDir, "phone");
    this.logger = d.logger;
    // Returned, so `bus.drain()` waits for the listener to be closed.
    this.unsubscribe = d.bus.subscribe("phone-link", "security.kill_switch.engaged", () =>
      this.shutDownForKillSwitch(),
    );
  }

  /** The port the listener binds to: the user's `phone.port`, else the built-in default. */
  private configuredPort(): number {
    return this.d.settings.get<number>(KEY_PORT, this.port);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Called once at Core start: reopens the listener only if the user left it enabled. */
  async start(): Promise<void> {
    if (!this.d.settings.get<boolean>(KEY_ENABLED, false)) return;
    if (this.d.permissions.isKillSwitchEngaged()) {
      this.d.settings.set(KEY_ENABLED, false);
      return;
    }
    try {
      await this.serialise(() => this.open());
    } catch (err) {
      this.logger.warn("Phone link could not start", { error: (err as Error).message });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.serialise(() => this.shut());
  }

  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async open(): Promise<void> {
    if (this.running || this.closed) return;
    if (this.d.unavailable)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "The phone link is not available in demo mode",
      );
    if (this.d.permissions.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");
    const addresses = this.lan();
    const chosen = this.d.settings.get<string | null>(KEY_ADDRESS, null);
    // The chosen interface is gone: the link stays OFF. It never falls back to another interface
    // (it could face a network the user did not pick); the setting stays so the UI can say why.
    if (chosen !== null && !addresses.includes(chosen))
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "The chosen network address is no longer available; choose an address again",
      );
    const address = chosen ?? addresses[0];
    if (address === undefined)
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        "No local network address was found; connect to a network first",
      );
    const identity = ensureTlsIdentity(this.tlsDir, address, this.clock.now());
    const listener = new PhoneListener({
      device: this,
      tls: { key: identity.key, cert: identity.cert },
      address,
      logger: this.logger,
      ...(this.d.handshakeTimeoutMs !== undefined
        ? { handshakeTimeoutMs: this.d.handshakeTimeoutMs }
        : {}),
      ...(this.d.maxConnectionsPerAddress !== undefined
        ? { maxConnectionsPerAddress: this.d.maxConnectionsPerAddress }
        : {}),
    });
    let bound: { port: number };
    try {
      bound = await listener.listen(this.configuredPort());
    } catch (err) {
      this.logger.warn("Phone link could not bind", { error: (err as Error).message });
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        `The phone link could not listen on ${address}`,
      );
    }
    this.running = { listener, address, port: bound.port, fingerprint: identity.fingerprint };
  }

  /** Closes the socket and forgets everything a session could rely on. */
  private async shut(): Promise<void> {
    const running = this.running;
    this.running = null;
    this.clearPairing();
    this.clearNonces();
    this.authFailures.clear();
    this.pairFailures.clear();
    if (running) await running.listener.close();
  }

  private clearNonces(): void {
    this.nonces.clear();
    this.nonceCounts.clear();
  }

  private dropNonce(key: string): void {
    if (!this.nonces.delete(key)) return;
    const deviceId = key.slice(0, key.indexOf("\n"));
    const left = (this.nonceCounts.get(deviceId) ?? 1) - 1;
    if (left <= 0) this.nonceCounts.delete(deviceId);
    else this.nonceCounts.set(deviceId, left);
  }

  private clearPairing(): void {
    this.code = null;
    if (this.pending) {
      this.pending.cancelTimer();
      this.pending.abort.abort();
    }
    this.pending = null;
  }

  private async shutDownForKillSwitch(): Promise<void> {
    await this.serialise(async () => {
      const wasEnabled = this.d.settings.get<boolean>(KEY_ENABLED, false);
      this.d.settings.set(KEY_ENABLED, false);
      await this.shut();
      if (wasEnabled || this.running !== null) {
        this.d.permissions.audit.record({
          actor: "core",
          action: "phone.listener.closed",
          decision: "info",
          details: { reason: "kill_switch" },
        });
      }
    });
  }

  // ── Desktop API (session token) ───────────────────────────────────────────

  status(): PhoneStatusView {
    const now = this.clock.now();
    const pending = this.pending;
    const addresses = this.lan();
    const chosen = this.d.settings.get<string | null>(KEY_ADDRESS, null);
    return {
      enabled: this.d.settings.get<boolean>(KEY_ENABLED, false),
      listening: this.running !== null,
      address: this.running?.address ?? null,
      port: this.running?.port ?? null,
      configured_port: this.configuredPort(),
      addresses,
      fingerprint: this.running?.fingerprint ?? null,
      require_user_verification: this.d.settings.get<boolean>(KEY_VERIFY, true),
      kill_switch: this.d.permissions.isKillSwitchEngaged(),
      pairing:
        this.code && this.code.expiresAt > now
          ? { expires_at: new Date(this.code.expiresAt).toISOString() }
          : null,
      pending_pair: pending
        ? {
            name: pending.name,
            key_fingerprint: pending.keyFingerprint,
            requested_at: new Date(pending.requestedAt).toISOString(),
            expires_at: new Date(pending.expiresAt).toISOString(),
            confirmation_id: pending.confirmationId,
          }
        : null,
      locked_out_until: this.lockedUntil > now ? new Date(this.lockedUntil).toISOString() : null,
      off_reason:
        this.running === null &&
        this.d.settings.get<boolean>(KEY_ENABLED, false) &&
        chosen !== null &&
        !addresses.includes(chosen)
          ? "address_changed"
          : null,
      devices: this.devicesStore.list().filter((x) => x.revokedAt === null).length,
    };
  }

  async configure(input: unknown): Promise<PhoneStatusView> {
    const body = plainObject(input);
    exactKeys(body, ["enabled", "require_user_verification", "address", "port"]);
    const { enabled, require_user_verification: verifyClaim, address, port } = body;
    if (enabled !== undefined && typeof enabled !== "boolean")
      throw invalid('"enabled" must be true or false');
    if (verifyClaim !== undefined && typeof verifyClaim !== "boolean")
      throw invalid('"require_user_verification" must be true or false');
    if (address !== undefined && address !== null) {
      if (typeof address !== "string" || !this.lan().includes(address))
        throw invalid('"address" must be one of this computer\'s local network addresses');
    }
    if (port !== undefined) {
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535)
        throw invalid('"port" must be a whole number from 1024 to 65535');
      if (this.reservedPorts().includes(port))
        throw invalid('"port" is already used by Phoenix itself; choose another');
    }
    await this.serialise(async () => {
      if (verifyClaim !== undefined) {
        this.d.settings.set(KEY_VERIFY, verifyClaim);
        this.d.permissions.audit.record({
          actor: "user",
          action: "phone.settings.changed",
          decision: "info",
          details: { require_user_verification: verifyClaim },
        });
      }
      let reopen = false;
      if (address !== undefined) {
        const changed = (address ?? null) !== this.d.settings.get<string | null>(KEY_ADDRESS, null);
        this.d.settings.set(KEY_ADDRESS, address);
        // A new address also brings back a link that went off because the old one vanished.
        reopen =
          changed && (this.running !== null || this.d.settings.get<boolean>(KEY_ENABLED, false));
        if (changed)
          this.d.permissions.audit.record({
            actor: "user",
            action: "phone.settings.changed",
            decision: "info",
            details: { address_changed: true },
          });
      }
      if (port !== undefined) {
        const changed = port !== this.configuredPort();
        this.d.settings.set(KEY_PORT, port);
        // Like a new address, a new port takes effect by reopening a link that is on (or tried to be).
        reopen =
          reopen ||
          (changed && (this.running !== null || this.d.settings.get<boolean>(KEY_ENABLED, false)));
        if (changed)
          this.d.permissions.audit.record({
            actor: "user",
            action: "phone.settings.changed",
            decision: "info",
            details: { port },
          });
      }
      if (enabled === false || reopen) {
        await this.shut();
        if (enabled === false) this.d.settings.set(KEY_ENABLED, false);
      }
      if (enabled === false) {
        this.d.permissions.audit.record({
          actor: "user",
          action: "phone.listener.disabled",
          decision: "info",
          details: {},
        });
      }
      if (enabled === true || (reopen && this.d.settings.get<boolean>(KEY_ENABLED, false))) {
        await this.open();
        this.d.settings.set(KEY_ENABLED, true);
        if (enabled === true)
          this.d.permissions.audit.record({
            actor: "user",
            action: "phone.listener.enabled",
            decision: "info",
            details: { address: this.running?.address, port: this.running?.port },
          });
      }
    });
    return this.status();
  }

  startPairing(): PhonePairingView {
    const running = this.running;
    if (!running)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "The phone link is not listening");
    if (this.pending)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "A pairing request is waiting for you");
    if (this.devicesStore.list().filter((x) => x.revokedAt === null).length >= MAX_DEVICES)
      throw invalid(`At most ${MAX_DEVICES} phones can be paired; revoke one first`);
    const now = this.clock.now();
    const code = newCode();
    this.code = { hash: sha256(code), expiresAt: now + PAIRING_TTL_MS };
    this.codeGuesses = 0;
    this.d.permissions.audit.record({
      actor: "user",
      action: "phone.pairing.started",
      decision: "info",
      details: { expires_at: new Date(now + PAIRING_TTL_MS).toISOString() },
    });
    const grouped = groupCode(code);
    const query = new URLSearchParams({
      host: running.address,
      port: String(running.port),
      code: grouped,
      fp: running.fingerprint,
    });
    return {
      code: grouped,
      expires_at: new Date(now + PAIRING_TTL_MS).toISOString(),
      fingerprint: running.fingerprint,
      address: running.address,
      port: running.port,
      uri: `phoenixphone://pair?${query.toString()}`,
    };
  }

  cancelPairing(): { cancelled: true } {
    const had = this.code !== null || this.pending !== null;
    this.clearPairing();
    if (had)
      this.d.permissions.audit.record({
        actor: "user",
        action: "phone.pairing.cancelled",
        decision: "info",
        details: {},
      });
    return { cancelled: true };
  }

  devices(): PhoneDeviceView[] {
    return this.devicesStore.list().map((x) => ({
      id: x.id,
      name: x.name,
      key_fingerprint: formatFingerprint(sha256(Buffer.from(x.publicKey, "base64"))),
      created_at: x.createdAt,
      last_seen_at: x.lastSeenAt,
      revoked_at: x.revokedAt,
    }));
  }

  revokeDevice(id: string): { id: string; revoked: true } {
    const iso = new Date(this.clock.now()).toISOString();
    if (!this.devicesStore.revoke(id, iso))
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Device not found");
    for (const key of [...this.nonces.keys()]) if (key.startsWith(`${id}\n`)) this.dropNonce(key);
    this.d.permissions.audit.record({
      actor: "user",
      action: "phone.device.revoked",
      decision: "info",
      details: { device_id: id },
    });
    return { id, revoked: true };
  }

  /**
   * "Delete all phone data". The devices go at once (every device request fails from this call on,
   * and a pairing in flight is withdrawn so it can never create a device afterwards); the listener
   * is then closed and the certificate removed in the background, in order. A failure there is
   * logged, never an unhandled rejection.
   */
  deleteAll(): { deleted: number } {
    this.clearPairing();
    this.pairResults.clear();
    this.d.settings.set(KEY_ENABLED, false);
    this.d.settings.delete(KEY_ADDRESS);
    this.d.settings.delete(KEY_PORT);
    this.d.settings.delete(KEY_VERIFY);
    const deleted = this.devicesStore.deleteAll();
    this.clearNonces();
    void this.serialise(async () => {
      try {
        await this.shut();
      } finally {
        this.removeIdentity(this.tlsDir);
      }
    }).catch((err: unknown) => {
      this.logger.warn("Phone data could not be fully removed", { error: (err as Error).message });
    });
    return { deleted };
  }

  // ── Pairing (LAN, unauthenticated; guarded by the single-use code) ────────

  pair(
    input: unknown,
    remote: string | undefined,
  ): {
    pair_id: string;
    status: "pending";
    expires_at: string;
  } {
    const now = this.clock.now();
    if (this.running === null)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "The phone link is not listening");
    if (this.lockedUntil > now)
      throw new PhoneThrottledError(
        "Pairing is locked after too many wrong codes",
        Math.ceil((this.lockedUntil - now) / 1000),
      );
    const wait = this.pairFailures.retryAfter(remote ?? "unknown", now);
    if (wait > 0)
      throw new PhoneThrottledError("Too many wrong pairing codes from this address", wait);
    const body = plainObject(input);
    exactKeys(body, ["code", "name", "public_key"]);
    if (!this.takeCode(normaliseCode(body.code), now, remote)) {
      throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "Pairing code invalid or expired");
    }
    // The code is spent from here on, whatever happens to the rest of the request.
    const name = deviceName(body.name);
    const key = deviceKey(body.public_key);
    const spkiBase64 = key.spki.toString("base64");
    if (this.devicesStore.list().some((x) => x.revokedAt === null && x.publicKey === spkiBase64))
      throw invalid("This device key is already paired");
    if (this.pending)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Another pairing request is waiting");

    const id = `pair_${randomBytes(16).toString("hex")}`;
    const abort = new AbortController();
    const expiresAt = now + PAIRING_TTL_MS;
    const pending: PendingPair = {
      id,
      name,
      spki: key.spki,
      keyFingerprint: key.fingerprint,
      requestedAt: now,
      expiresAt,
      confirmationId: null,
      abort,
      cancelTimer: this.clock.after(PAIRING_TTL_MS, () => abort.abort()),
    };
    this.pending = pending;
    const summary = `Pair phone "${name}"? Key fingerprint ${key.fingerprint}`;
    const outcome = this.d.permissions.authorize(
      {
        capabilityId: PHONE_CAPABILITY,
        command: "pair",
        permissions: [],
        sideEffect: "execute",
        summary,
      },
      abort.signal,
    );
    pending.confirmationId =
      this.d.permissions
        .pendingConfirmations()
        .find((c) => c.capabilityId === PHONE_CAPABILITY && c.summary === summary)?.id ?? null;
    this.d.permissions.audit.record({
      actor: "phone-link",
      action: "phone.pair.requested",
      decision: "pending",
      details: {
        pair_id_hash: sha256(id).toString("hex").slice(0, 12),
        key_fingerprint: key.fingerprint,
      },
    });
    void outcome.then(
      () => this.finishPair(pending, "approved"),
      (err: unknown) =>
        this.finishPair(
          pending,
          err instanceof PhoenixError &&
            (err.code === ErrorCode.PERMISSION_DENIED ||
              err.code === ErrorCode.SECURITY_POLICY_BLOCKED)
            ? "denied"
            : "expired",
        ),
    );
    return { pair_id: id, status: "pending", expires_at: new Date(expiresAt).toISOString() };
  }

  /**
   * Wrong codes are counted ONLY while a code is live, per remote address (that address is locked
   * out after {@link MAX_WRONG_CODES}) and together against the live code: its
   * {@link MAX_WRONG_CODES_PER_CODE}+1th wrong guess destroys it and pauses pairing for
   * {@link LOCKOUT_MS}. With no live code a request is refused and costs nothing: one address
   * spraying bad posts can neither kill the code the user is about to type nor lock other phones out.
   */
  private takeCode(given: string, now: number, remote: string | undefined): boolean {
    const active = this.code !== null && this.code.expiresAt > now ? this.code : null;
    if (active === null) {
      if (this.auditBudget.retryAfter("pair-no-code", now) === 0) {
        this.auditBudget.record("pair-no-code", now);
        this.d.permissions.audit.record({
          actor: "phone-link",
          action: "phone.pair.refused",
          decision: "denied",
          details: { reason: "no_active_code", remote_known: remote !== undefined },
        });
      }
      return false;
    }
    const ok = given.length === CODE_LENGTH && timingSafeEqual(sha256(given), active.hash);
    if (ok) {
      this.code = null; // single use
      this.codeGuesses = 0;
      return true;
    }
    this.codeGuesses++;
    this.pairFailures.record(remote ?? "unknown", now);
    this.d.permissions.audit.record({
      actor: "phone-link",
      action: "phone.pair.refused",
      decision: "denied",
      details: {
        reason: "bad_code",
        attempts: this.codeGuesses,
        remote_known: remote !== undefined,
      },
    });
    if (this.codeGuesses > MAX_WRONG_CODES_PER_CODE) {
      this.lockedUntil = now + LOCKOUT_MS;
      this.codeGuesses = 0;
      this.code = null; // the code that was being guessed at is dead
      this.d.permissions.audit.record({
        actor: "phone-link",
        action: "phone.pair.lockout",
        decision: "blocked",
        details: { until: new Date(this.lockedUntil).toISOString() },
      });
    }
    return false;
  }

  private finishPair(pending: PendingPair, outcome: "approved" | "denied" | "expired"): void {
    pending.cancelTimer();
    if (this.pending === pending) this.pending = null;
    let result: PhonePairProgress;
    if (outcome === "approved") {
      const now = new Date(this.clock.now()).toISOString();
      const device = {
        id: `dev_${randomBytes(6).toString("hex")}`,
        name: pending.name,
        publicKey: pending.spki.toString("base64"),
        createdAt: now,
        lastSeenAt: null,
        revokedAt: null,
      };
      this.devicesStore.create(device);
      this.d.permissions.audit.record({
        actor: "phone-link",
        action: "phone.device.paired",
        decision: "allowed",
        details: { device_id: device.id, key_fingerprint: pending.keyFingerprint },
      });
      result = { status: "approved", device_id: device.id };
    } else {
      this.d.permissions.audit.record({
        actor: "phone-link",
        action: `phone.pair.${outcome}`,
        decision: "denied",
        details: { key_fingerprint: pending.keyFingerprint },
      });
      result = { status: outcome };
    }
    this.pairResults.set(pending.id, result);
    while (this.pairResults.size > MAX_PAIR_RESULTS)
      this.pairResults.delete(this.pairResults.keys().next().value!);
  }

  pairProgress(pairId: string): PhonePairProgress {
    if (this.pending?.id === pairId)
      return { status: "pending", expires_at: new Date(this.pending.expiresAt).toISOString() };
    const done = this.pairResults.get(pairId);
    if (!done) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Pairing request not found");
    return done;
  }

  // ── Per-request device authentication ─────────────────────────────────────

  authenticate(req: PhoneAuthRequest): PhoneIdentity {
    const now = this.clock.now();
    const remote = req.remote ?? "unknown";
    const wait = this.authFailures.retryAfter(remote, now);
    if (wait > 0) throw new PhoneThrottledError("Too many failed requests", wait);
    if (this.running === null)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "The phone link is not listening");
    if (this.d.permissions.isKillSwitchEngaged())
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Emergency stop is engaged");

    const fail = (reason: string, deviceId: string | undefined, details: string[] = []): never => {
      this.authFailures.record(remote, now);
      if (this.auditBudget.retryAfter("audit", now) === 0) {
        this.auditBudget.record("audit", now);
        this.d.permissions.audit.record({
          actor: "phone-link",
          action: "phone.auth.failed",
          decision: "denied",
          details: {
            reason,
            ...(deviceId !== undefined && DEVICE_ID.test(deviceId) ? { device_id: deviceId } : {}),
          },
        });
      }
      throw new PhoenixError(ErrorCode.UNAUTHENTICATED, "Device authentication failed", details);
    };

    const { deviceId, timestamp, nonce, signature } = req;
    if (
      deviceId === undefined ||
      !DEVICE_ID.test(deviceId) ||
      timestamp === undefined ||
      !/^[0-9]{10,16}$/.test(timestamp) ||
      nonce === undefined ||
      !NONCE.test(nonce) ||
      signature === undefined ||
      signature.length > 200 ||
      !BASE64.test(signature)
    )
      return fail("malformed", deviceId);
    const device = this.devicesStore.get(deviceId);
    if (!device) return fail("unknown_device", deviceId);
    if (device.revokedAt !== null) return fail("revoked", deviceId);
    let valid = false;
    try {
      valid = verify(
        "sha256",
        Buffer.from(
          signedRequestText(deviceId, req.method, req.target, timestamp, nonce, req.body),
        ),
        createPublicKey({
          key: Buffer.from(device.publicKey, "base64"),
          format: "der",
          type: "spki",
        }),
        Buffer.from(signature, "base64"),
      );
    } catch {
      valid = false;
    }
    if (!valid) return fail("bad_signature", deviceId);
    if (Math.abs(now - Number(timestamp)) > CLOCK_WINDOW_MS)
      return fail("clock_skew", deviceId, ["clock_skew"]);

    const key = `${deviceId}\n${nonce}`;
    for (const [seen, expires] of this.nonces) {
      if (expires > now) break;
      this.dropNonce(seen);
    }
    if (this.nonces.has(key)) return fail("replayed", deviceId);
    // A device that fills its own quota is slowed alone; it cannot use up the shared table.
    if (
      this.nonces.size >= MAX_NONCES ||
      (this.nonceCounts.get(deviceId) ?? 0) >= MAX_NONCES_PER_DEVICE
    )
      throw new PhoneThrottledError("Too many requests", Math.ceil(NONCE_TTL_MS / 1000));
    this.nonces.set(key, now + NONCE_TTL_MS);
    this.nonceCounts.set(deviceId, (this.nonceCounts.get(deviceId) ?? 0) + 1);
    this.devicesStore.touch(deviceId, new Date(now).toISOString());
    return { id: device.id, name: device.name };
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  whoami(device: PhoneIdentity) {
    return {
      device_id: device.id,
      name: device.name,
      require_user_verification: this.d.settings.get<boolean>(KEY_VERIFY, true),
      server_time: new Date(this.clock.now()).toISOString(),
    };
  }

  /** Pending requests as the phone sees them. The phone's own pairing prompt is never listed. */
  private pendingViews(): PhoneApprovalView[] {
    const out: PhoneApprovalView[] = [];
    for (const c of this.d.permissions.pendingConfirmations()) {
      if (c.capabilityId === PHONE_CAPABILITY) continue;
      const tool = `${c.capabilityId}.${c.command}`;
      const preview: Record<string, unknown> = {
        summary: c.summary,
        side_effect: c.sideEffect,
        permissions: c.permissions,
        ...(c.details ? { details: c.details } : {}),
      };
      out.push(this.view("confirmation", c.id, tool, c.summary, preview, c.expiresAt));
    }
    for (const a of this.d.agentApprovals.list()) {
      if (a.kind !== "permission") continue; // a question needs an answer the phone cannot give
      const preview: Record<string, unknown> = {
        agent: a.agent,
        project: a.project,
        input_summary: a.input_summary,
      };
      const title =
        a.input_summary.command ?? a.input_summary.path ?? a.input_summary.description ?? a.tool;
      out.push(this.view("agent", a.id, a.tool, title, preview, a.expires_at));
    }
    return out;
  }

  private view(
    source: "confirmation" | "agent",
    id: string,
    tool: string,
    title: string,
    preview: Record<string, unknown>,
    expiresAt: string,
  ): PhoneApprovalView {
    const hash = previewHash(preview);
    return {
      source,
      id,
      tool,
      title: title.slice(0, 200),
      preview,
      preview_hash: hash,
      expires_at: expiresAt,
      request_hash: requestHash({ source, id, tool, preview_hash: hash, expires_at: expiresAt }),
    };
  }

  approvals(_device: PhoneIdentity): { approvals: PhoneApprovalView[] } {
    return { approvals: this.pendingViews() };
  }

  decide(
    device: PhoneIdentity,
    input: unknown,
  ): { id: string; source: "confirmation" | "agent"; decision: "approve" | "deny" } {
    const body = plainObject(input);
    exactKeys(body, ["id", "source", "decision", "request_hash", "user_verification"]);
    const { id, source, decision, request_hash: claimedHash, user_verification: verified } = body;
    if (typeof id !== "string" || id.length < 1 || id.length > 120)
      throw invalid('"id" is required');
    if (source !== "confirmation" && source !== "agent")
      throw invalid('"source" must be "confirmation" or "agent"');
    if (decision !== "approve" && decision !== "deny")
      throw invalid('"decision" must be "approve" or "deny"');
    if (typeof claimedHash !== "string" || !/^[0-9a-f]{64}$/.test(claimedHash))
      throw invalid('"request_hash" must be 64 hex characters');
    if (verified !== undefined && typeof verified !== "boolean")
      throw invalid('"user_verification" must be true or false');

    const refuse = (reason: string, code: ErrorCode, message: string): never => {
      this.d.permissions.audit.record({
        actor: `device:${device.id}`,
        action: "phone.approval.refused",
        decision: "denied",
        details: { id, source, decision, reason },
      });
      throw new PhoenixError(code, message);
    };

    const now = this.clock.now();
    const current = this.pendingViews().find((v) => v.source === source && v.id === id);
    if (!current)
      return refuse(
        "not_pending",
        ErrorCode.RESOURCE_NOT_FOUND,
        "That request is no longer pending",
      );
    if (Date.parse(current.expires_at) <= now)
      return refuse("expired", ErrorCode.OPERATION_TIMEOUT, "That request has expired");
    if (!equalHex(current.request_hash, claimedHash))
      return refuse(
        "request_changed",
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "The request is not what was shown on the phone",
      );
    const userVerified = verified === true;
    if (decision === "approve" && !userVerified && this.d.settings.get<boolean>(KEY_VERIFY, true))
      return refuse(
        "verification_required",
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Approving needs the phone to confirm it is you (biometric or passcode)",
      );

    const actor = `device:${device.id}`;
    if (source === "confirmation") {
      if (!this.d.permissions.resolveConfirmation(id, decision === "approve", actor))
        return refuse(
          "not_pending",
          ErrorCode.RESOURCE_NOT_FOUND,
          "That request is no longer pending",
        );
    } else {
      try {
        this.d.agentApprovals.decide(
          id,
          { behavior: decision === "approve" ? "allow" : "deny" },
          actor,
        );
      } catch (err) {
        if (err instanceof PhoenixError)
          return refuse("not_pending", err.code, "That request is no longer pending");
        throw err;
      }
    }
    this.d.permissions.audit.record({
      actor,
      action: "phone.approval.decided",
      decision: decision === "approve" ? "allowed" : "denied",
      details: {
        id,
        source,
        tool: current.tool,
        decision,
        user_verification: userVerified,
        request_hash: current.request_hash,
      },
    });
    return { id, source, decision };
  }
}
