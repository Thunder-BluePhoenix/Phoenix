// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EventBus } from "@phoenix/event-bus";
import type { AuditLog } from "@phoenix/permissions";
import type { SecretStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, createEvent } from "@phoenix/protocol";
import { DedupeWindow } from "./dedupe";
import type { TeamClock } from "./kinds";
import { RateLimiter } from "./rate-limit";
import {
  WEBHOOK_SOURCE_ID,
  isAllowedWebhookType,
  parseAllowedTypes,
  parseWebhookPayload,
} from "./webhook-schema";

export const WEBHOOK_SETTINGS_KEY = "team-webhooks.config";
export const WEBHOOK_SECRET_PREFIX = "team-webhook.";
/** A delivery's timestamp must be within this distance of Core's clock, either side. */
export const WEBHOOK_WINDOW_SECONDS = 5 * 60;
export const MAX_WEBHOOK_SOURCES = 16;
/** The shortest secret the verifier will use; a shorter stored value is treated as a fault. */
export const MIN_SECRET_LENGTH = 32;
export const WEBHOOK_PATH_PREFIX = "/api/webhooks/in/";

const GENERIC_AUTH_FAILURE = "Webhook authentication failed";
const TIMESTAMP = /^[0-9]{10}$/;
const SIGNATURE = /^v1=[0-9a-f]{64}$/;

export interface WebhookSourceConfig {
  eventTypes: string[];
  enabled: boolean;
  createdAt: string;
}

interface WebhookConfig {
  /** Master switch. Off by default; with it off no delivery is verified, let alone published. */
  enabled: boolean;
  sources: Record<string, WebhookSourceConfig>;
}

export interface WebhookSourceView {
  id: string;
  /** Where the sender POSTs. The secret is never part of a view. */
  path: string;
  eventTypes: string[];
  enabled: boolean;
  createdAt: string;
  lastAcceptedAt: string | null;
}

export interface WebhookStatus {
  enabled: boolean;
  sources: WebhookSourceView[];
}

/** The only time a secret leaves Core: the response to creating or rotating a source. */
export interface WebhookSourceSecret {
  source: WebhookSourceView;
  secret: string;
}

export interface WebhookDependencies {
  settings: { get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void };
  /** Per-source secrets live here (the OS credential store), never in settings. */
  secrets: SecretStore;
  bus: Pick<EventBus, "publish">;
  audit: Pick<AuditLog, "record">;
  clock: TeamClock;
  /** Attempts before authentication, per source (all unknown ids share one bucket). */
  preAuthLimit?: RateLimiter;
  /** Authenticated deliveries per source. */
  sourceLimit?: RateLimiter;
}

export interface WebhookRequest {
  sourceId: string;
  timestamp: string | undefined;
  signature: string | undefined;
  /** The raw bytes the signature covers. */
  body: Buffer;
}

export type WebhookOutcome =
  { ok: true; eventId: string; seq: number | null } | { ok: false; retryAfterMs: number };

/** `v1=` + hex HMAC-SHA256 over `<unix seconds>.<raw body>`. Senders (and tests) use this. */
export function signWebhook(
  secret: string,
  timestampSeconds: number | string,
  body: Buffer,
): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestampSeconds}.`);
  mac.update(body);
  return `v1=${mac.digest("hex")}`;
}

/** Constant-time comparison of two signatures of public, equal length. */
function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

const fail = (): PhoenixError => new PhoenixError(ErrorCode.UNAUTHENTICATED, GENERIC_AUTH_FAILURE);

const notFound = (id: string): PhoenixError =>
  new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `No webhook source "${id}"`);

function parseConfig(raw: unknown): WebhookConfig {
  const config: WebhookConfig = { enabled: false, sources: {} };
  if (raw === null || typeof raw !== "object") return config;
  const record = raw as Record<string, unknown>;
  config.enabled = record.enabled === true;
  const sources = record.sources;
  if (sources === null || typeof sources !== "object") return config;
  for (const [id, value] of Object.entries(sources)) {
    if (!WEBHOOK_SOURCE_ID.test(id) || value === null || typeof value !== "object") continue;
    const source = value as Record<string, unknown>;
    const types = Array.isArray(source.eventTypes)
      ? source.eventTypes.filter(isAllowedWebhookType)
      : [];
    config.sources[id] = {
      eventTypes: types,
      // A stored source that does not say it is enabled stays disabled.
      enabled: source.enabled === true,
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    };
  }
  return config;
}

/**
 * Incoming webhooks: one URL and one secret per source turn another tool's POST into a Phoenix
 * event. Authentication is a per-source HMAC over the timestamp and the exact body; the session
 * token is deliberately not involved. Every refusal answers the same 401 so the response cannot
 * be used to find out which sources exist, are disabled, or have a different secret; the audit log
 * records the real reason.
 */
export class TeamWebhooks {
  private config: WebhookConfig;
  private readonly dedupe = new DedupeWindow(WEBHOOK_WINDOW_SECONDS * 2 * 1000);
  private readonly preAuth: RateLimiter;
  private readonly perSource: RateLimiter;
  private readonly auditLimit = new RateLimiter(5, 6);
  private readonly suppressed = new Map<string, number>();
  private readonly lastAccepted = new Map<string, number>();
  /** Bumped before any source or master-switch mutation; accepted deliveries verify it after awaits. */
  private generation = 0;

  constructor(private readonly d: WebhookDependencies) {
    this.config = parseConfig(d.settings.get<unknown>(WEBHOOK_SETTINGS_KEY, null));
    this.preAuth = d.preAuthLimit ?? new RateLimiter(60, 120);
    this.perSource = d.sourceLimit ?? new RateLimiter(10, 30);
  }

  status(): WebhookStatus {
    return {
      enabled: this.config.enabled,
      sources: Object.keys(this.config.sources)
        .sort()
        .map((id) => this.view(id)),
    };
  }

  setEnabled(enabled: boolean): WebhookStatus {
    this.generation++;
    this.config = { ...this.config, enabled };
    this.persist();
    this.record("team.webhook.master", "info", { enabled });
    return this.status();
  }

  async createSource(id: unknown, eventTypes: unknown): Promise<WebhookSourceSecret> {
    if (typeof id !== "string" || !WEBHOOK_SOURCE_ID.test(id))
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "Source id must be 3-32 characters: a-z, 0-9, - or _, starting with a letter",
      );
    const types = parseAllowedTypes(eventTypes);
    if (this.config.sources[id]) throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Source exists");
    if (Object.keys(this.config.sources).length >= MAX_WEBHOOK_SOURCES)
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `At most ${MAX_WEBHOOK_SOURCES} webhook sources`,
      );
    const secret = randomBytes(32).toString("base64url");
    await this.d.secrets.set(WEBHOOK_SECRET_PREFIX + id, secret);
    this.generation++;
    const previous = this.config;
    this.config = {
      ...previous,
      sources: {
        ...previous.sources,
        [id]: {
          eventTypes: types,
          enabled: true,
          createdAt: new Date(this.d.clock.now()).toISOString(),
        },
      },
    };
    try {
      this.persist();
    } catch (error) {
      this.config = previous;
      await this.d.secrets.delete(WEBHOOK_SECRET_PREFIX + id);
      throw error;
    }
    this.record("team.webhook.source.created", "allowed", { source: id, eventTypes: types });
    return { source: this.view(id), secret };
  }

  /** Replaces the secret; the old one stops working immediately. */
  async rotateSecret(id: string): Promise<WebhookSourceSecret> {
    if (!this.config.sources[id]) throw notFound(id);
    const secret = randomBytes(32).toString("base64url");
    this.generation++;
    await this.d.secrets.set(WEBHOOK_SECRET_PREFIX + id, secret);
    this.record("team.webhook.source.rotated", "allowed", { source: id });
    return { source: this.view(id), secret };
  }

  setSourceEnabled(id: string, enabled: boolean): WebhookStatus {
    this.generation++;
    const source = this.config.sources[id];
    if (!source) throw notFound(id);
    this.config = {
      ...this.config,
      sources: { ...this.config.sources, [id]: { ...source, enabled } },
    };
    this.persist();
    this.record("team.webhook.source.toggled", "info", { source: id, enabled });
    return this.status();
  }

  /** Revocation: the source is unusable the moment it is removed, then its secret is deleted. */
  async revoke(id: string): Promise<WebhookStatus> {
    this.generation++;
    if (!this.config.sources[id]) throw notFound(id);
    const rest = { ...this.config.sources };
    delete rest[id];
    this.config = { ...this.config, sources: rest };
    this.persist();
    this.dedupe.forget(id);
    this.perSource.forget(id);
    this.lastAccepted.delete(id);
    await this.d.secrets.delete(WEBHOOK_SECRET_PREFIX + id);
    this.record("team.webhook.source.revoked", "allowed", { source: id });
    return this.status();
  }

  /**
   * Verifies and publishes one delivery. Throws a PhoenixError for every refusal except rate
   * limiting, which is returned so the route can set `Retry-After`.
   */
  async accept(request: WebhookRequest): Promise<WebhookOutcome> {
    const now = this.d.clock.now();
    const sourceId = request.sourceId;
    const known = WEBHOOK_SOURCE_ID.test(sourceId) ? this.config.sources[sourceId] : undefined;
    const auditKey = known ? sourceId : "unknown";

    if (!this.config.enabled) return this.refuse(auditKey, "webhooks_disabled");
    if (!known) return this.refuse(auditKey, "unknown_source");
    if (!known.enabled) return this.refuse(auditKey, "source_disabled");

    // A request that cannot possibly be signed is charged to one bounded shared bucket, so a flood
    // of junk is throttled. A well-formed one is always verified and never charged here: the public
    // source id is not a credential, so strangers must not be able to spend a real source's budget.
    const { timestamp, signature } = request;
    const malformed =
      timestamp === undefined ||
      !TIMESTAMP.test(timestamp) ||
      signature === undefined ||
      !SIGNATURE.test(signature) ||
      Math.abs(now / 1000 - Number(timestamp)) > WEBHOOK_WINDOW_SECONDS;
    if (malformed) {
      const gate = this.preAuth.take("unauthenticated", now);
      if (!gate.ok) {
        this.audit(auditKey, "blocked", "rate_limited_pre_auth");
        return { ok: false, retryAfterMs: gate.retryAfterMs };
      }
      return this.refuse(auditKey, "malformed_or_outside_replay_window");
    }
    const generation = this.generation;
    const secret = await this.d.secrets.get(WEBHOOK_SECRET_PREFIX + sourceId);
    if (secret === undefined || secret.length < MIN_SECRET_LENGTH)
      return this.refuse(auditKey, "no_secret");
    // Disable, revoke and rotation take effect before this in-flight secret read can publish.
    const current = this.config.sources[sourceId];
    if (
      generation !== this.generation ||
      !this.config.enabled ||
      current !== known ||
      !current.enabled
    )
      return this.refuse(auditKey, "source_changed");
    if (!signaturesMatch(signWebhook(secret, timestamp, request.body), signature))
      return this.refuse(auditKey, "bad_signature");

    // Authenticated from here on: errors may now be specific.
    const limit = this.perSource.take(sourceId, now);
    if (!limit.ok) {
      this.audit(sourceId, "blocked", "rate_limited");
      return { ok: false, retryAfterMs: limit.retryAfterMs };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body.toString("utf8"));
    } catch {
      this.audit(sourceId, "denied", "invalid_json");
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Body is not valid JSON");
    }
    let payload;
    try {
      payload = parseWebhookPayload(parsed);
    } catch (error) {
      this.audit(sourceId, "denied", "invalid_payload");
      throw error;
    }
    if (!known.eventTypes.includes(payload.event_type)) {
      this.audit(sourceId, "denied", "type_not_allowed");
      throw new PhoenixError(
        ErrorCode.PERMISSION_DENIED,
        "This source is not allowed to send that event type",
      );
    }

    const claim = this.dedupe.claim(sourceId, payload.event_id, now);
    if (claim === "duplicate") {
      this.audit(sourceId, "denied", "duplicate_event");
      throw new PhoenixError(ErrorCode.EVENT_DUPLICATE);
    }
    if (claim === "full") {
      // Refusing is the safe answer: evicting an id still inside the replay window would allow a replay.
      this.audit(sourceId, "blocked", "dedupe_capacity");
      return { ok: false, retryAfterMs: WEBHOOK_WINDOW_SECONDS * 1000 };
    }
    // Namespaced by source, hashed: one source cannot collide with, or pre-empt, another's ids.
    const eventId = `evt_wh_${createHash("sha256")
      .update(`${sourceId}\n${payload.event_id}`)
      .digest("hex")
      .slice(0, 40)}`;
    const result = this.d.bus.publish(
      createEvent(
        {
          event_id: eventId,
          event_type: payload.event_type,
          source: `webhook-${sourceId}`,
          severity: payload.severity ?? "info",
          ...(payload.subject !== undefined ? { subject: payload.subject } : {}),
          data_classification: "internal",
          metadata: { untrusted: true },
          provenance: { kind: "incoming_webhook", source_id: sourceId },
          payload: {
            ...(payload.message !== undefined ? { message: payload.message } : {}),
            ...(payload.data !== undefined ? { data: payload.data } : {}),
          },
        },
        () => new Date(now),
      ),
    );
    if (!result.ok) {
      this.dedupe.release(sourceId, payload.event_id);
      this.audit(sourceId, "blocked", `rejected_${result.error.code.toLowerCase()}`);
      throw result.error;
    }
    this.lastAccepted.set(sourceId, now);
    this.record("team.webhook.accepted", "allowed", {
      source: sourceId,
      event_type: payload.event_type,
    });
    return { ok: true, eventId, seq: result.seq };
  }

  private refuse(auditKey: string, reason: string): never {
    this.audit(auditKey, "denied", reason);
    throw fail();
  }

  /** Rate-limited so an unauthenticated flood cannot fill the audit log; the count is kept. */
  private audit(key: string, decision: "denied" | "blocked", reason: string): void {
    const now = this.d.clock.now();
    if (!this.auditLimit.take(key, now).ok) {
      this.suppressed.set(key, (this.suppressed.get(key) ?? 0) + 1);
      return;
    }
    const suppressed = this.suppressed.get(key);
    this.suppressed.delete(key);
    this.record("team.webhook.refused", decision, {
      source: key,
      reason,
      ...(suppressed ? { suppressed } : {}),
    });
  }

  private record(
    action: string,
    decision: "allowed" | "denied" | "blocked" | "info",
    details: Record<string, unknown>,
  ): void {
    this.d.audit.record({
      actor: "team-webhooks",
      action,
      capabilityId: "team-status",
      decision,
      details,
    });
  }

  private view(id: string): WebhookSourceView {
    const source = this.config.sources[id]!;
    const last = this.lastAccepted.get(id);
    return {
      id,
      path: WEBHOOK_PATH_PREFIX + id,
      eventTypes: [...source.eventTypes],
      enabled: source.enabled,
      createdAt: source.createdAt,
      lastAcceptedAt: last === undefined ? null : new Date(last).toISOString(),
    };
  }

  private persist(): void {
    this.d.settings.set(WEBHOOK_SETTINGS_KEY, this.config);
  }
}
