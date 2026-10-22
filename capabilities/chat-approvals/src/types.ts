// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared types for chat approvals (Phase 86). Nothing here touches the network or Core: the
// Core-side hooks (host, audit, transport) are interfaces so tests and the runtime inject their own.

export const PROVIDERS = ["slack", "discord", "teams"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * One pending request exactly as Core sees it NOW. `request_hash` is computed by Core (the same
 * `requestHash()` the phone link uses over source, id, tool, preview_hash and expires_at); this
 * package never computes it, it only compares it. `title` is untrusted text.
 */
export interface ApprovalSnapshot {
  source: "confirmation" | "agent";
  id: string;
  tool: string;
  title: string;
  /** Agent approvals carry the project; Phoenix confirmations have none. */
  project?: string;
  request_hash: string;
  expires_at: string;
}

export interface DecideInput {
  source: "confirmation" | "agent";
  id: string;
  decision: "approve" | "deny";
  /** The hash Core reported a moment ago; the host re-checks it against the request as it is now. */
  requestHash: string;
  /** `chat:<provider>:<user>`; becomes the actor of the Core audit row. */
  actor: string;
}

/**
 * What Core gives this package. `decide` MUST resolve through the same audited path as the phone
 * link (PermissionGateway.resolveConfirmation / AgentApprovals.decide) and throw if the request is
 * gone, expired or its hash no longer matches.
 */
export interface ChatApprovalHost {
  pending(): ApprovalSnapshot[];
  decide(input: DecideInput): void;
}

export interface ChatAuditEntry {
  actor: string;
  action: string;
  decision: "allowed" | "denied" | "blocked" | "info";
  details: Record<string, unknown>;
}

export type AuditSink = (entry: ChatAuditEntry) => void;

export interface HttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/** Every outgoing call goes through this; tests inject a recording fake, nothing here opens a socket. */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** An inbound provider callback. `body` is the exact bytes received: signatures cover bytes. */
export interface RawRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: Buffer;
}

export interface ChatReply {
  status: number;
  json?: unknown;
}

export class SignatureError extends Error {
  constructor(
    readonly reason: "missing" | "malformed" | "stale" | "mismatch" | "too_large" | "replayed",
  ) {
    super(`Provider signature refused: ${reason}`);
    this.name = "SignatureError";
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** Largest provider callback body read at all (Slack and Discord interactions are far smaller). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Signed provider requests are accepted within this distance of Core's clock (Slack's own advice). */
export const SIGNATURE_WINDOW_MS = 5 * 60_000;

export type RefusalReason =
  | "provider_off"
  | "wrong_workspace"
  | "unknown_user"
  | "unknown_token"
  | "wrong_provider"
  | "wrong_channel"
  | "wrong_user"
  | "expired"
  | "not_pending"
  | "project_off"
  | "request_changed"
  | "host_refused";

/** The sanitized facts a card or confirm step may show. Never the preview, never the full command. */
export interface CardView {
  title: string;
  tool: string;
  project: string | undefined;
  expires: string;
}

export type PressOutcome =
  | { kind: "confirm"; view: CardView; confirmToken: string; cancelToken: string }
  | { kind: "decided"; decision: "approve" | "deny"; view: CardView }
  | { kind: "cancelled"; view: CardView }
  | { kind: "refused"; reason: RefusalReason };

/** A provider callback after the provider's own signature was verified and the body parsed. */
export interface Interaction {
  provider: Provider;
  /** Slack team id / Discord guild id the press came from; "" when the provider sent none. */
  workspace: string;
  userId: string;
  channel: string;
  token: string;
}
