// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** auth = 401 (the credential is bad); forbidden = 403 without rate-limit signs (missing scope). */
export type ServiceFailureKind =
  "auth" | "forbidden" | "rate_limit" | "not_found" | "http" | "network" | "invalid";

/**
 * A failed call to a remote service. The message never contains the credential, the request URL
 * or any text the remote sent: those are untrusted and could carry a secret or an instruction.
 */
export class ServiceError extends Error {
  constructor(
    readonly service: string,
    readonly kind: ServiceFailureKind,
    message: string,
    /** Delay the service asked for with Retry-After, if any. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
