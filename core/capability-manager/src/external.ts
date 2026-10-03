// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { HealthResult } from "./types";

export const CAPABILITY_TOKEN_HEADER = "x-phoenix-capability-token";

/** External capabilities must listen on loopback (ADR-0015). */
export function assertLoopbackEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "endpoint must be a URL");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      "External capabilities must listen on http://127.0.0.1 (loopback only)",
    );
  }
  return url;
}

/**
 * HTTP client Phoenix uses to talk to an external capability process.
 *
 * Contract (implemented by the SDK in Phase 13):
 *   GET  /health                  → { status, message? }
 *   POST /phoenix/lifecycle       { action: "enable" | "disable", config? }
 *   POST /commands/{name}         { input, operation_id } → { result }
 * Every request carries the capability token so the process can verify Phoenix.
 */
export class ExternalClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async health(timeoutMs: number): Promise<HealthResult> {
    const body = await this.request("GET", "/health", undefined, timeoutMs);
    const status = (body as { status?: string })?.status;
    if (status === "healthy" || status === "degraded" || status === "unhealthy") {
      const message = (body as { message?: unknown }).message;
      return { status, ...(typeof message === "string" ? { message } : {}) };
    }
    return { status: "unhealthy", message: "Malformed health response" };
  }

  lifecycle(action: "enable" | "disable", config: unknown, timeoutMs: number): Promise<unknown> {
    return this.request("POST", "/phoenix/lifecycle", { action, config }, timeoutMs);
  }

  async command(
    name: string,
    input: unknown,
    operationId: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const body = await this.request(
      "POST",
      `/commands/${encodeURIComponent(name)}`,
      { input, operation_id: operationId },
      timeoutMs,
    );
    return (body as { result?: unknown })?.result;
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.endpoint), {
        method,
        headers: {
          [CAPABILITY_TOKEN_HEADER]: this.token,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (err) {
      if ((err as Error).name === "TimeoutError")
        throw new PhoenixError(ErrorCode.OPERATION_TIMEOUT);
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Capability is unreachable");
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Capability returned invalid JSON");
    }
    if (!res.ok) {
      const message = (parsed as { message?: unknown })?.message;
      throw new PhoenixError(
        ErrorCode.CAPABILITY_UNAVAILABLE,
        typeof message === "string" ? message.slice(0, 300) : `Capability responded ${res.status}`,
      );
    }
    return parsed;
  }
}
