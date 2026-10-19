// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ServiceError, type ServiceFailureKind } from "./error";

/** Largest response read. A ceiling, not a target. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15_000;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;
const MAX_RETRY_AFTER_MS = 60 * 60_000;

/**
 * The base URL to call, or undefined when it is not allowed. Only https is accepted, plus plain
 * http to loopback (tests and local mocks). A URL with credentials in it is refused so a secret
 * can never ride in the address.
 */
export function safeBaseUrl(value: string): string | undefined {
  if (value.length > 2048 || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) return undefined;
  const ok = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.test(url.hostname));
  return ok ? value.replace(/\/+$/, "") : undefined;
}

/** One path segment, encoded, so an id from the remote can never change the shape of a request. */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Reads a body but stops (and cancels the connection) once it passes `maxBytes`; the whole read
 * must also finish within `timeoutMs`, so a body that drips one byte at a time is cut off.
 */
export async function readCapped(
  service: string,
  res: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new ServiceError(service, "invalid", `${service} response is too large`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const deadline = AbortSignal.timeout(timeoutMs);
  const onTimeout = () => void reader.cancel().catch(() => {});
  deadline.addEventListener("abort", onTimeout, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ServiceError(service, "invalid", `${service} response is too large`);
      }
      chunks.push(value);
    }
  } finally {
    deadline.removeEventListener("abort", onTimeout);
  }
  if (deadline.aborted) throw new ServiceError(service, "network", `${service} timed out`);
  return Buffer.concat(chunks).toString("utf8");
}

export interface ClientOptions {
  /** Name used in error messages, e.g. "Vercel". */
  service: string;
  /** Already checked with `safeBaseUrl`. */
  baseUrl: string;
  /** Builds the credential header(s) from the secret. The secret is sent only to `baseUrl`. */
  auth?: (secret: string) => Record<string, string>;
  /** Fixed headers such as an API version. */
  headers?: Record<string, string>;
  secret?: string | undefined;
  maxBytes?: number;
  timeoutMs?: number;
  /** Aborts in-flight requests (the capability was disabled). */
  signal?: AbortSignal;
}

function failure(service: string, status: number, retryAfter: number | undefined): ServiceError {
  const kinds: Record<number, [ServiceFailureKind, string]> = {
    401: ["auth", `${service} rejected the credential (401): check it is valid and not expired`],
    403: ["forbidden", `${service} refused the request (403): the credential lacks permission`],
    404: ["not_found", `Not found (404) at ${service}`],
    429: ["rate_limit", `${service} rate limit reached`],
  };
  const known = kinds[status];
  if (known) return new ServiceError(service, known[0], known[1], retryAfter);
  return new ServiceError(service, "http", `${service} answered HTTP ${status}`, retryAfter);
}

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (raw === null || !/^\d{1,9}$/.test(raw)) return undefined;
  return Math.min(Number(raw) * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * A client that can only GET. It has no method that sends a body, so code built on it cannot
 * change anything at the remote service, which is how read-only capabilities stay read-only.
 */
export class ReadOnlyClient {
  /** Requests made, for the poller's bookkeeping. */
  calls = 0;
  protected readonly baseUrl: string;
  protected readonly maxBytes: number;
  protected readonly timeoutMs: number;

  constructor(protected readonly options: ClientOptions) {
    this.baseUrl = options.baseUrl;
    this.maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get authenticated(): boolean {
    return !!this.options.secret;
  }

  /** GET `path` (must start with "/"), parse the JSON body with `parse`, which throws if unusable. */
  async get<T>(path: string, parse: (body: unknown) => T): Promise<T> {
    return this.request("GET", path, undefined, parse);
  }

  protected async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    parse: (body: unknown) => T,
  ): Promise<T> {
    const { service } = this.options;
    if (!path.startsWith("/")) throw new ServiceError(service, "invalid", "Invalid request path");
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "phoenix-capability",
      ...this.options.headers,
    };
    if (this.options.secret && this.options.auth) {
      Object.assign(headers, this.options.auth(this.options.secret));
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    this.calls++;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout,
      });
    } catch {
      throw new ServiceError(service, "network", `${service} is unreachable`);
    }
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => {});
      throw failure(service, res.status, retryAfterMs(res));
    }
    try {
      const text = await readCapped(service, res, this.maxBytes, this.timeoutMs);
      return parse(text === "" ? null : JSON.parse(text));
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(
        service,
        "invalid",
        `${service} sent a response in an unexpected format`,
      );
    }
  }
}

/** A client that can also POST, for the few approved actions (re-run, redeploy, pause). */
export class ServiceClient extends ReadOnlyClient {
  async post<T>(path: string, body: unknown, parse: (body: unknown) => T): Promise<T> {
    return this.request("POST", path, body ?? {}, parse);
  }
}
