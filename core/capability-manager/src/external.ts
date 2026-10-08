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

/** Largest reply Phoenix will read from a capability. Real replies are tiny; this is a ceiling. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Longest free-text message kept from a capability; it is shown in the UI and stored. */
const MAX_MESSAGE_CHARS = 300;

/**
 * Reads a response body but stops, and cancels the connection, once it passes `maxBytes`. Without
 * this a capability could answer with an endless body and Core would buffer all of it
 * (one 200 MB reply took Core from 129 MB to 987 MB), because the request timeout only covers
 * the headers. The whole read also has to finish within `timeoutMs` (a body that drips one byte
 * at a time is cut off).
 */
async function readCapped(res: Response, maxBytes: number, timeoutMs: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Capability reply is too large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const deadline = AbortSignal.timeout(timeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onTimeout = () => void reader.cancel().catch(() => {});
  deadline.addEventListener("abort", onTimeout, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Capability reply is too large");
      }
      chunks.push(value);
    }
  } finally {
    deadline.removeEventListener("abort", onTimeout);
  }
  if (deadline.aborted) throw new PhoenixError(ErrorCode.OPERATION_TIMEOUT);
  return Buffer.concat(chunks).toString("utf8");
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
      return {
        status,
        ...(typeof message === "string" ? { message: message.slice(0, MAX_MESSAGE_CHARS) } : {}),
      };
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
    let text: string;
    try {
      text = await readCapped(res, MAX_RESPONSE_BYTES, timeoutMs);
    } catch (err) {
      if (err instanceof PhoenixError) throw err;
      if ((err as Error).name === "TimeoutError")
        throw new PhoenixError(ErrorCode.OPERATION_TIMEOUT);
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "Capability is unreachable");
    }
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
        typeof message === "string"
          ? message.slice(0, MAX_MESSAGE_CHARS)
          : `Capability responded ${res.status}`,
      );
    }
    return parsed;
  }
}
