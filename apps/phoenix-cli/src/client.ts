// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { CoreError, UsageError } from "./errors";
import { isRecord, redact } from "./format";

export const DEFAULT_CORE_URL = "http://127.0.0.1:4870";

/** Core answers are small JSON documents; anything larger is not Core. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Validates the Core address. The session token is a bearer credential for the whole API, so it is
 * only ever sent over plain HTTP to the loopback interface, never to another host (ADR-0015).
 */
export function parseCoreUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError(`"${raw}" is not a valid Core URL`);
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new UsageError(
      "The Core URL must be http:// on 127.0.0.1, localhost or [::1]: the session token is never sent anywhere else",
    );
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new UsageError("The Core URL must not carry credentials, a query or a fragment");
  }
  return url.origin;
}

export interface CoreClientOptions {
  baseUrl: string;
  token: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  /** Extra headers on every request (the client label). */
  headers?: Record<string, string>;
}

export interface Reply {
  status: number;
  body: unknown;
}

/** A small typed wrapper over Core's loopback HTTP API. Knows nothing about particular routes. */
export class CoreClient {
  constructor(private readonly options: CoreClientOptions) {}

  /** One authenticated JSON request; resolves to the parsed body, rejects with a `CoreError`. */
  async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { baseUrl, token } = this.options;
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.options.fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...this.options.headers,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A redirect would carry the bearer token to wherever it points.
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new CoreError("unreachable", this.unreachable(err));
    }
    const parsed = await this.readBody(response);
    if (response.ok) return parsed;
    throw this.failure(response.status, parsed);
  }

  private unreachable(err: unknown): string {
    const text = redact(err instanceof Error ? err.message : String(err), this.options.token);
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    const detail = timedOut ? "timed out" : redact(cause || text, this.options.token);
    return `Cannot reach Phoenix Core at ${this.options.baseUrl} (${detail}). Is it running?`;
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await readCapped(response);
    if (text === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CoreError(
        "protocol",
        `Core answered ${response.status} with something that is not JSON`,
        response.status,
      );
    }
  }

  private failure(status: number, body: unknown): CoreError {
    const code = isRecord(body) && typeof body.code === "string" ? body.code : undefined;
    const message = redact(
      isRecord(body) && typeof body.message === "string" ? body.message : `HTTP ${status}`,
      this.options.token,
    );
    if (status === 401) {
      return new CoreError(
        "unauthenticated",
        "Core rejected the session token. Core issues a new one each start; is the token file from this run?",
        status,
        code,
      );
    }
    return new CoreError("rejected", message, status, code);
  }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new CoreError("protocol", "Core answered with an oversized body", response.status);
  }
  if (!response.body) return "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CoreError("protocol", "Core answered with an oversized body", response.status);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
