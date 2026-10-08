// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/** Longest error message kept. Provider replies are untrusted and can be huge. */
export const MAX_ERROR_CHARS = 300;

export type ModelErrorKind =
  /** Could not connect, connection dropped, DNS failure. */
  | "network"
  /** The provider did not answer in time. */
  | "timeout"
  /** The caller aborted. Never retried, never falls back. */
  | "aborted"
  /** The provider answered with an HTTP error. */
  | "http"
  /** The provider rejected (or we lack) credentials. */
  | "auth"
  /** The reply was not what the API documents (bad JSON, wrong types, too large, truncated). */
  | "protocol"
  /** The provider cannot do this (for example embeddings on Anthropic). */
  | "unsupported"
  /** The request itself is unusable (empty embed input, ...). */
  | "invalid"
  /** The provider is configured in a way Phoenix refuses (non-loopback Ollama host). */
  | "config";

const CODE_BY_KIND: Record<ModelErrorKind, ErrorCode> = {
  network: ErrorCode.CAPABILITY_UNAVAILABLE,
  timeout: ErrorCode.OPERATION_TIMEOUT,
  aborted: ErrorCode.OPERATION_TIMEOUT,
  http: ErrorCode.CAPABILITY_UNAVAILABLE,
  auth: ErrorCode.CAPABILITY_UNAVAILABLE,
  protocol: ErrorCode.CAPABILITY_UNAVAILABLE,
  unsupported: ErrorCode.INVALID_REQUEST,
  invalid: ErrorCode.INVALID_REQUEST,
  config: ErrorCode.SECURITY_POLICY_BLOCKED,
};

export interface ModelErrorInit {
  status?: number;
  /** Whether repeating the identical call might succeed (network, 5xx, 429). */
  retryable?: boolean;
  retryAfterMs?: number;
}

/**
 * A failure of one provider call. Messages are written by this package and truncated; they never
 * contain request bodies, headers or credentials.
 */
export class ModelError extends PhoenixError {
  readonly kind: ModelErrorKind;
  readonly provider: string;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(kind: ModelErrorKind, provider: string, message: string, init: ModelErrorInit = {}) {
    super(CODE_BY_KIND[kind], message.slice(0, MAX_ERROR_CHARS));
    this.name = "ModelError";
    this.kind = kind;
    this.provider = provider;
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** The AI layer is switched off in settings. No provider was contacted. */
export class AiDisabledError extends PhoenixError {
  constructor() {
    super(ErrorCode.CAPABILITY_DISABLED, "AI is disabled in settings");
    this.name = "AiDisabledError";
  }
}

/** One provider try (or skip), kept so the UI can show what happened. */
export interface Attempt {
  provider: string;
  outcome: "answered" | "failed" | "skipped";
  /** Why it failed or was skipped. Safe to show to users. */
  reason?: string;
  /** Number of calls made to this provider (0 when skipped). */
  calls: number;
}

/** Nothing was allowed to run the task (privacy, missing grant, offline, ...). */
export class NoProviderError extends PhoenixError {
  readonly attempts: readonly Attempt[];
  constructor(attempts: readonly Attempt[]) {
    super(
      ErrorCode.CAPABILITY_UNAVAILABLE,
      "No AI provider is allowed and available for this request",
      attempts.map((a) => `${a.provider}: ${a.reason ?? a.outcome}`),
    );
    this.name = "NoProviderError";
    this.attempts = attempts;
  }
}

/** Every allowed provider was tried and failed. */
export class AllProvidersFailedError extends PhoenixError {
  readonly attempts: readonly Attempt[];
  constructor(attempts: readonly Attempt[]) {
    super(
      ErrorCode.CAPABILITY_UNAVAILABLE,
      "Every allowed AI provider failed",
      attempts.map((a) => `${a.provider}: ${a.reason ?? a.outcome}`),
    );
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}
