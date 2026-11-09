// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The recording consent channel (Phase 65), Core side. Mechanism (1) of the owner decision: the
// desktop shell starts Core as a CHILD process and hands it a per-launch secret over the child's
// stdin pipe (never argv, never the environment, never a file, never a log). Only a holder of that
// secret can read pending consents and answer them. The session token cannot: Core's other
// routes use the token, and any process of the same OS user can read it, so a token-authenticated
// answer would let an agent grant its own recording consent.
//
// What this module holds:
//   * the secret, as a SHA-256 digest only (the raw bytes are zeroed right after hashing);
//   * at most one PENDING consent (what, who asked, a cleaned title, expiry, single-use nonce);
//   * a rate limiter for the two routes and an audit row per request/answer/expiry (no secret,
//     no full nonce, no text but the cleaned title length).
//
// The channel is `available` only while a shell has talked to Core with the secret recently
// (the "live shell link"). Without the secret (the `pnpm dev:core` workflow) it never is, and
// the notetaker keeps refusing every start with CONSENT_CHANNEL_UNAVAILABLE.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import type { NotetakerConsentApi, PendingConsentView } from "@phoenix/api";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/** First token of the one line the shell writes to Core's stdin. */
export const CONSENT_SECRET_PREFIX = ["PHOENIX", "CONSENT", "V1"].join("-");
/** The announcement (environment, no secret in it): "the secret is on stdin". */
export const MANAGED_ENV = "PHOENIX_MANAGED_CORE";
export const MANAGED_ENV_VALUE = "stdin";

const SECRET_HEX = /^[0-9a-f]{64}$/;
export const WHAT_NOTETAKER_RECORD = "notetaker.record";

export interface ConsentChannelOptions {
  /** 64 lowercase hex characters. Hashed on arrival; this string is the caller's to drop. */
  secret: string;
  now?: () => number;
  /** How long a pending consent can be answered. Default 60 s. */
  ttlMs?: number;
  /** How long after the shell's last authenticated call the link counts as live. Default 10 s. */
  linkTtlMs?: number;
  /** Failed authentications allowed per window before everything is refused. Default 5 / 60 s. */
  maxFailures?: number;
  /** Authenticated calls allowed per window (the shell polls every 2 s). Default 120 / 60 s. */
  maxCalls?: number;
  windowMs?: number;
  nonce?: () => string;
  audit: (
    action: string,
    decision: "allowed" | "denied" | "info",
    details: Record<string, unknown>,
  ) => void;
}

interface Pending {
  nonce: string;
  what: string;
  title: string | null;
  expiresAt: number;
  settle: (granted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Printable, single-line, at most 80 characters; anything else is dropped. */
export function cleanConsentTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = Array.from(title)
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return (
        cp >= 0x20 &&
        cp !== 0x7f &&
        !(cp >= 0x80 && cp <= 0x9f) &&
        !(cp >= 0x200b && cp <= 0x200f) &&
        !(cp >= 0x202a && cp <= 0x202e) &&
        !(cp >= 0x2066 && cp <= 0x2069) &&
        cp !== 0xfeff
      );
    })
    .slice(0, 80)
    .join("")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export class ConsentChannel implements NotetakerConsentApi {
  readonly kind = "desktop-shell-dialog";
  private readonly digest: Buffer;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly linkTtlMs: number;
  private readonly maxFailures: number;
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly newNonce: () => string;
  private pending: Pending | null = null;
  private gone = false;
  private lastShellContact = Number.NEGATIVE_INFINITY;
  private failures: number[] = [];
  private calls: number[] = [];

  constructor(private readonly o: ConsentChannelOptions) {
    if (!SECRET_HEX.test(o.secret)) throw new Error("The consent secret is not 64 hex characters");
    this.digest = sha256(o.secret);
    this.now = o.now ?? Date.now;
    this.ttlMs = o.ttlMs ?? 60_000;
    this.linkTtlMs = o.linkTtlMs ?? 10_000;
    this.maxFailures = o.maxFailures ?? 5;
    this.maxCalls = o.maxCalls ?? 120;
    this.windowMs = o.windowMs ?? 60_000;
    this.newNonce = o.nonce ?? (() => randomBytes(24).toString("base64url"));
  }

  /** True while a shell that holds the secret has called Core recently and its pipe is open. */
  available(): boolean {
    return !this.gone && this.now() - this.lastShellContact <= this.linkTtlMs;
  }

  /** The shell's end of the stdin pipe closed: the link is dead for good and any waiting consent is "no". */
  shellGone(): void {
    this.gone = true;
    this.finish("close", false);
  }

  /** Ends any pending consent as "no" (shutdown). */
  close(): void {
    this.finish("close", false);
  }

  private recent(list: number[]): number[] {
    const cutoff = this.now() - this.windowMs;
    while (list.length > 0 && list[0]! <= cutoff) list.shift();
    return list;
  }

  /**
   * Checks the presented secret in constant time. Throws a PhoenixError: 401 for a wrong or
   * missing secret (the session token is just another wrong secret), 403 when rate limited.
   */
  private authenticate(presented: string | undefined): void {
    const failures = this.recent(this.failures);
    const calls = this.recent(this.calls);
    if (failures.length >= this.maxFailures || calls.length >= this.maxCalls)
      throw new PhoenixError(
        ErrorCode.SECURITY_POLICY_BLOCKED,
        "Too many consent requests; wait a minute",
      );
    const ok =
      typeof presented === "string" &&
      presented.length <= 128 &&
      timingSafeEqual(sha256(presented), this.digest);
    if (!ok) {
      failures.push(this.now());
      this.o.audit("notetaker.consent.rejected", "denied", { reason: "bad_secret" });
      throw new PhoenixError(ErrorCode.UNAUTHENTICATED, "Not the consent secret");
    }
    calls.push(this.now());
    this.lastShellContact = this.now();
  }

  /** What the shell shows. Reading it is also the shell's heartbeat. */
  list(presented: string | undefined): PendingConsentView[] {
    this.authenticate(presented);
    this.expireIfDue();
    const p = this.pending;
    if (!p) return [];
    return [
      {
        nonce: p.nonce,
        what: p.what,
        requested_by: "session-api",
        title: p.title,
        expires_at: new Date(p.expiresAt).toISOString(),
      },
    ];
  }

  /** The shell's answer. A nonce works once; anything else is the same 404. */
  answer(presented: string | undefined, nonce: unknown, decision: unknown): "granted" | "denied" {
    this.authenticate(presented);
    if (decision !== "granted" && decision !== "denied")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "`decision` must be granted or denied");
    this.expireIfDue();
    const p = this.pending;
    const known =
      p !== null &&
      typeof nonce === "string" &&
      nonce.length === p.nonce.length &&
      timingSafeEqual(Buffer.from(nonce), Buffer.from(p.nonce));
    if (!known) {
      this.o.audit("notetaker.consent.rejected", "denied", { reason: "unknown_nonce" });
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "No such pending consent");
    }
    this.finish(decision, decision === "granted");
    return decision;
  }

  private expireIfDue(): void {
    if (this.pending && this.now() >= this.pending.expiresAt) this.finish("expired", false);
  }

  private finish(outcome: "granted" | "denied" | "expired" | "close", granted: boolean): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    this.o.audit(
      `notetaker.consent.${outcome === "close" ? "expired" : outcome}`,
      granted ? "allowed" : outcome === "denied" ? "denied" : "info",
      { what: p.what, nonce_id: sha256(p.nonce).toString("hex").slice(0, 12) },
    );
    p.settle(granted);
  }

  /**
   * The NotetakerConsentChannel face: opens one pending consent and resolves with the person's
   * answer. Anything but a granted answer inside the expiry is false.
   */
  confirm(info: { title: string | null }): Promise<boolean> {
    if (!this.available())
      throw new PhoenixError(
        ErrorCode.CONSENT_CHANNEL_UNAVAILABLE,
        "The desktop app is not connected to confirm this recording",
      );
    this.expireIfDue();
    if (this.pending)
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "A confirmation is already waiting");
    const nonce = this.newNonce();
    const title = cleanConsentTitle(info.title);
    const { promise, resolve: settle } = Promise.withResolvers<boolean>();
    const timer = setTimeout(() => this.expireIfDue(), this.ttlMs + 5);
    timer.unref();
    this.pending = {
      nonce,
      what: WHAT_NOTETAKER_RECORD,
      title,
      expiresAt: this.now() + this.ttlMs,
      settle,
      timer,
    };
    this.o.audit("notetaker.consent.requested", "info", {
      what: WHAT_NOTETAKER_RECORD,
      requested_by: "session-api",
      title_chars: title?.length ?? 0,
      nonce_id: sha256(nonce).toString("hex").slice(0, 12),
    });
    return promise;
  }
}

/**
 * Reads the one line `PHOENIX-CONSENT-V1 <64 hex>` the shell writes to Core's stdin. Returns the
 * secret, or null when the line is missing, late, malformed, or the stream is a terminal (a
 * person typing at `pnpm dev:core` is not a shell). The caller passes the stream, so tests inject
 * their own. Reads no more than 256 bytes; the stream is left open (the caller watches for close).
 */
export function readConsentSecret(
  input: Readable & { isTTY?: boolean },
  timeoutMs = 5_000,
): Promise<string | null> {
  if (input.isTTY) return Promise.resolve(null);
  const { promise, resolve } = Promise.withResolvers<string | null>();
  let buffered = "";
  let done = false;
  const finish = (value: string | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    input.off("data", onData);
    input.off("end", onEnd);
    input.off("error", onEnd);
    resolve(value);
  };
  const onData = (chunk: Buffer | string) => {
    buffered += chunk.toString("utf8");
    if (buffered.length > 256) return finish(null);
    const eol = buffered.indexOf("\n");
    if (eol < 0) return;
    const [prefix, secret, ...rest] = buffered.slice(0, eol).trim().split(" ");
    finish(
      prefix === CONSENT_SECRET_PREFIX && rest.length === 0 && SECRET_HEX.test(secret ?? "")
        ? secret!
        : null,
    );
  };
  const onEnd = () => finish(null);
  const timer = setTimeout(() => finish(null), timeoutMs);
  timer.unref();
  input.on("data", onData);
  input.once("end", onEnd);
  input.once("error", onEnd);
  return promise;
}
