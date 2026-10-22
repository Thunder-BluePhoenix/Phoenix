// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The security core of chat approvals. A chat button press is NOT authority by itself: a provider
// module has already proven the request came from the provider (its own signature scheme); this
// module then decides whether THIS person may decide THIS request, once:
//
//   1. the provider is switched on and the press came from the configured workspace;
//   2. the provider user id is on the owner's explicit allow-list (config);
//   3. the button token exists (server-side, random, single use), belongs to this provider and
//      channel, has not expired, and (for the confirm step) belongs to the same person;
//   4. the request is STILL pending, STILL switched on for chat, and its request_hash, which Core
//      computes (phone-link `requestHash`), still equals the hash the card was issued for;
//   5. only then is the host asked to decide, with the actor `chat:<provider>:<user>`.
//
// "Allow" never decides: it answers with a confirm step bound to the same hash and the same person.
// Tokens are held only as SHA-256 digests, only in memory, and never survive a restart.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chatAllowed, providerReady, type ChatConfig } from "./config";
import { cardView } from "./cards";
import type {
  ApprovalSnapshot,
  AuditSink,
  ChatApprovalHost,
  ChatAuditEntry,
  Interaction,
  PressOutcome,
  Provider,
  RefusalReason,
} from "./types";

type TokenKind = "allow" | "deny" | "confirm" | "cancel";

interface TokenRecord {
  kind: TokenKind;
  provider: Provider;
  channel: string;
  source: ApprovalSnapshot["source"];
  id: string;
  requestHash: string;
  expiresAt: number;
  /** Set on confirm/cancel tokens: only the person who pressed Allow may use them. */
  userId?: string;
}

export const MAX_TOKENS = 1000;
export const MAX_REPLAY_KEYS = 4096;
const AUDIT_ROWS_PER_MINUTE = 20;

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Remembers provider signatures so one captured, signed request is accepted once. Keys are kept for
 * the whole signature window plus a margin; a full table refuses new requests rather than forgetting
 * old ones (an attacker must not be able to flush a real signature out by flooding).
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly keepMs: number,
    private readonly max = MAX_REPLAY_KEYS,
  ) {}

  /** Returns false when the key was seen or the table is full. */
  claim(key: string, now: number): boolean {
    for (const [k, until] of this.seen) if (until < now) this.seen.delete(k);
    if (this.seen.has(key) || this.seen.size >= this.max) return false;
    this.seen.set(key, now + this.keepMs);
    return true;
  }
}

/** At most 20 audit rows a minute for refusals, so noise cannot fill the audit log. */
export class AuditThrottle {
  private windowStart = 0;
  private rows = 0;

  constructor(private readonly sink: AuditSink) {}

  record(now: number, entry: ChatAuditEntry): void {
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.rows = 0;
    }
    if (this.rows >= AUDIT_ROWS_PER_MINUTE) return;
    this.rows += 1;
    this.sink(entry);
  }
}

export interface BindingDeps {
  host: ChatApprovalHost;
  config: () => ChatConfig;
  now: () => number;
  audit: AuditSink;
}

export interface IssuedCard {
  allow: string;
  deny: string;
  expiresAt: number;
}

export class ApprovalBinding {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly throttle: AuditThrottle;

  constructor(private readonly d: BindingDeps) {
    this.throttle = new AuditThrottle(d.audit);
  }

  get size(): number {
    return this.tokens.size;
  }

  private mint(record: TokenRecord): string | undefined {
    this.purge();
    if (this.tokens.size >= MAX_TOKENS) return undefined;
    const token = randomBytes(16).toString("base64url");
    this.tokens.set(digest(token), record);
    return token;
  }

  private purge(): void {
    const now = this.d.now();
    for (const [key, record] of this.tokens) if (record.expiresAt <= now) this.tokens.delete(key);
  }

  /** Forgets every token of one request (all kinds), optionally only for one provider. */
  invalidate(source: string, id: string, provider?: Provider): void {
    for (const [key, r] of this.tokens) {
      if (r.source === source && r.id === id && (provider === undefined || r.provider === provider))
        this.tokens.delete(key);
    }
  }

  /**
   * Tokens for one card. Refuses (undefined) when the provider is not ready or the request's
   * project is not switched on for chat: this is the check that runs BEFORE a card is generated.
   */
  issueCard(provider: Provider, snapshot: ApprovalSnapshot): IssuedCard | undefined {
    const config = this.d.config();
    if (provider === "teams" || !providerReady(config, provider)) return undefined;
    if (!chatAllowed(config, snapshot)) return undefined;
    const now = this.d.now();
    const requestExpires = Date.parse(snapshot.expires_at);
    if (!Number.isFinite(requestExpires)) return undefined;
    const expiresAt = Math.min(now + config.ttlMs, requestExpires);
    if (expiresAt <= now) return undefined;
    const base = {
      provider,
      channel: config[provider].channel,
      source: snapshot.source,
      id: snapshot.id,
      requestHash: snapshot.request_hash,
      expiresAt,
    };
    const allow = this.mint({ ...base, kind: "allow" });
    const deny = this.mint({ ...base, kind: "deny" });
    if (allow === undefined || deny === undefined) {
      this.invalidate(snapshot.source, snapshot.id, provider);
      return undefined;
    }
    return { allow, deny, expiresAt };
  }

  private refuse(
    i: Interaction,
    reason: RefusalReason,
    record?: Pick<TokenRecord, "source" | "id">,
  ): PressOutcome {
    this.throttle.record(this.d.now(), {
      actor: `chat:${i.provider}:${i.userId}`,
      action: "chat.approval.refused",
      decision: "blocked",
      details: {
        provider: i.provider,
        reason,
        ...(record ? { id: record.id, source: record.source } : {}),
      },
    });
    return { kind: "refused", reason };
  }

  /**
   * Handles one authenticated press. The provider module must already have verified the provider's
   * signature and its replay window; nothing here trusts the interaction beyond that.
   */
  press(i: Interaction): PressOutcome {
    const config = this.d.config();
    if (!providerReady(config, i.provider) || i.provider === "teams")
      return this.refuse(i, "provider_off");
    const settings = config[i.provider];
    if (i.workspace !== settings.workspace) return this.refuse(i, "wrong_workspace");
    if (!settings.approvers.includes(i.userId)) return this.refuse(i, "unknown_user");

    const key = digest(i.token);
    const record = this.tokens.get(key);
    if (!record) return this.refuse(i, "unknown_token");
    if (record.provider !== i.provider) return this.refuse(i, "wrong_provider", record);
    if (record.channel !== i.channel) return this.refuse(i, "wrong_channel", record);
    if (record.userId !== undefined && record.userId !== i.userId)
      return this.refuse(i, "wrong_user", record);

    const now = this.d.now();
    if (record.expiresAt <= now) {
      this.tokens.delete(key);
      return this.refuse(i, "expired", record);
    }
    // Single use: gone before anything else can fail or throw.
    this.tokens.delete(key);

    const current = this.d.host
      .pending()
      .find((p) => p.source === record.source && p.id === record.id);
    if (!current) {
      this.invalidate(record.source, record.id);
      return this.refuse(i, "not_pending", record);
    }
    if (Date.parse(current.expires_at) <= now) {
      this.invalidate(record.source, record.id);
      return this.refuse(i, "expired", record);
    }
    if (!chatAllowed(config, current)) {
      this.invalidate(record.source, record.id);
      return this.refuse(i, "project_off", record);
    }
    if (!equalHex(current.request_hash, record.requestHash)) {
      this.invalidate(record.source, record.id);
      return this.refuse(i, "request_changed", record);
    }

    const view = cardView(current);
    const actor = `chat:${i.provider}:${i.userId}`;

    if (record.kind === "cancel") {
      this.invalidate(record.source, record.id, i.provider);
      this.throttle.record(now, {
        actor,
        action: "chat.approval.cancelled",
        decision: "info",
        details: { provider: i.provider, id: record.id, source: record.source },
      });
      return { kind: "cancelled", view };
    }

    if (record.kind === "allow") {
      const confirmRecord = {
        provider: i.provider,
        channel: record.channel,
        source: record.source,
        id: record.id,
        requestHash: record.requestHash,
        expiresAt: Math.min(record.expiresAt, now + config.ttlMs),
        userId: i.userId,
      };
      const confirmToken = this.mint({ ...confirmRecord, kind: "confirm" });
      const cancelToken = this.mint({ ...confirmRecord, kind: "cancel" });
      if (confirmToken === undefined || cancelToken === undefined) {
        this.invalidate(record.source, record.id, i.provider);
        return this.refuse(i, "host_refused", record);
      }
      this.throttle.record(now, {
        actor,
        action: "chat.approval.confirm_requested",
        decision: "info",
        details: { provider: i.provider, id: record.id, source: record.source },
      });
      return { kind: "confirm", view, confirmToken, cancelToken };
    }

    const decision = record.kind === "deny" ? "deny" : "approve";
    try {
      this.d.host.decide({
        source: record.source,
        id: record.id,
        decision,
        requestHash: record.requestHash,
        actor,
      });
    } catch {
      this.invalidate(record.source, record.id);
      return this.refuse(i, "host_refused", record);
    }
    this.invalidate(record.source, record.id);
    this.d.audit({
      actor,
      action: "chat.approval.decided",
      decision: decision === "approve" ? "allowed" : "denied",
      details: {
        provider: i.provider,
        id: record.id,
        source: record.source,
        tool: view.tool,
        decision,
        request_hash: record.requestHash,
      },
    });
    return { kind: "decided", decision, view };
  }
}
