// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Read-only GitHub REST client: GET only, conditional requests (ETag), capped response size,
// request timeouts, and the rate-limit bookkeeping that decides how long to leave GitHub alone.
export const GITHUB_API = "https://api.github.com";

/** Largest response read. A page of 20 pull requests is ~400 KB; this is a ceiling, not a target. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
/** Largest job log downloaded; a longer one is skipped (the failed steps are the evidence). */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;
const MAX_ETAGS = 500;

/** Unauthenticated GitHub allows 60 requests/hour; stay under 50 (and 304s count there). */
export const UNAUTHENTICATED_MS_PER_CALL = 72_000;
const AUTH_BACKOFF_MS = 5 * 60_000;
const MAX_FAILURE_BACKOFF_MS = 5 * 60_000;
const MAX_RATE_LIMIT_WAIT_MS = 60 * 60_000;
const UNKNOWN_RESET_WAIT_MS = 5 * 60_000;
/** Leave this many requests unspent: below it we wait for the window to reset. */
const RATE_LIMIT_RESERVE = 5;

export interface RateLimitInfo {
  remaining?: number;
  /** When the rate-limit window resets (epoch ms). */
  resetAt?: number;
  /** Delay GitHub asked for with Retry-After. */
  retryAfterMs?: number;
}

/** auth = 401 (the token itself is bad); forbidden = 403 without rate-limit signs (missing permission). */
export type GithubFailureKind =
  "auth" | "forbidden" | "rate_limit" | "not_found" | "http" | "network" | "invalid";

export class GithubError extends Error {
  constructor(
    readonly kind: GithubFailureKind,
    message: string,
    readonly rate: RateLimitInfo = {},
  ) {
    super(message);
    this.name = "GithubError";
  }
}

function nonNegativeInt(value: string | null): number | undefined {
  if (value === null || !/^\d{1,12}$/.test(value)) return undefined;
  return Number(value);
}

/** Reads X-RateLimit-* and Retry-After. Missing or garbage headers are ignored. */
export function readRateLimit(headers: Headers): RateLimitInfo {
  const remaining = nonNegativeInt(headers.get("x-ratelimit-remaining"));
  const reset = nonNegativeInt(headers.get("x-ratelimit-reset"));
  const retry = nonNegativeInt(headers.get("retry-after"));
  return {
    ...(remaining !== undefined ? { remaining } : {}),
    ...(reset !== undefined ? { resetAt: reset * 1000 } : {}),
    ...(retry !== undefined ? { retryAfterMs: retry * 1000 } : {}),
  };
}

/** 429, or a 403 that GitHub says is about limits (no quota left, or Retry-After set). */
export function isRateLimited(status: number, rate: RateLimitInfo): boolean {
  return (
    status === 429 || (status === 403 && (rate.remaining === 0 || rate.retryAfterMs !== undefined))
  );
}

export interface DelayInput {
  intervalMs: number;
  authenticated: boolean;
  /** Requests the last cycle spent. */
  calls: number;
  /** Failed cycles in a row. */
  failures: number;
  /** The most recent kind of failure, if the last cycle failed. */
  failure?: GithubFailureKind;
  rate: RateLimitInfo;
  now: number;
}

/**
 * How long to wait before the next poll. Pure: the poller reports what happened, this decides.
 * Never shorter than the configured interval; longer when unauthenticated (60 requests/hour),
 * after errors (exponential), on 401 (the token will not fix itself), when the quota is nearly
 * spent (wait for the reset) and when GitHub said Retry-After.
 */
export function nextDelay(i: DelayInput): number {
  let delay = i.intervalMs;
  if (!i.authenticated) delay = Math.max(delay, i.calls * UNAUTHENTICATED_MS_PER_CALL);
  if (i.failures > 0) {
    delay = Math.max(delay, Math.min(i.intervalMs * 2 ** i.failures, MAX_FAILURE_BACKOFF_MS));
  }
  if (i.failure === "auth") delay = Math.max(delay, AUTH_BACKOFF_MS);
  if (i.rate.retryAfterMs !== undefined) {
    delay = Math.max(delay, Math.min(i.rate.retryAfterMs, MAX_RATE_LIMIT_WAIT_MS));
  }
  const exhausted =
    i.failure === "rate_limit" ||
    (i.rate.remaining !== undefined && i.rate.remaining <= RATE_LIMIT_RESERVE);
  if (exhausted) {
    const untilReset =
      i.rate.resetAt !== undefined ? i.rate.resetAt - i.now + 1000 : UNKNOWN_RESET_WAIT_MS;
    delay = Math.max(delay, Math.min(Math.max(untilReset, 0), MAX_RATE_LIMIT_WAIT_MS));
  }
  return delay;
}

/**
 * Reads a body but stops (and cancels the connection) once it passes `maxBytes`; the whole read
 * also has to finish within `timeoutMs`, so a body that drips one byte at a time is cut off.
 */
export async function readCapped(
  res: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new GithubError("invalid", "GitHub response is too large");
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
        throw new GithubError("invalid", "GitHub response is too large");
      }
      chunks.push(value);
    }
  } finally {
    deadline.removeEventListener("abort", onTimeout);
  }
  if (deadline.aborted) throw new GithubError("network", "GitHub response timed out");
  return Buffer.concat(chunks).toString("utf8");
}

export interface GithubClientOptions {
  baseUrl?: string;
  token?: string | undefined;
  maxBytes?: number;
  /** Largest job log downloaded (default 4 MiB). */
  maxLogBytes?: number;
  timeoutMs?: number;
  /** Aborts in-flight requests (the capability was disabled). */
  signal?: AbortSignal;
}

export interface GetResult<T> {
  /** The parsed response, or undefined when GitHub answered 304 Not Modified (nothing changed). */
  value: T | undefined;
  rate: RateLimitInfo;
}

export class GithubClient {
  /** Requests made, for the poller's rate bookkeeping. */
  calls = 0;
  /** Lowest quota and any Retry-After seen since the poller last reset it (once per cycle). */
  rate: RateLimitInfo = {};
  private readonly baseUrl: string;
  private readonly baseHost: string;
  private readonly maxBytes: number;
  private readonly maxLogBytes: number;
  private readonly timeoutMs: number;
  private readonly etags: Record<string, string> = {};

  constructor(private readonly options: GithubClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? GITHUB_API).replace(/\/$/, "");
    this.baseHost = URL.canParse(this.baseUrl) ? new URL(this.baseUrl).hostname : "";
    this.maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
    this.maxLogBytes = options.maxLogBytes ?? MAX_LOG_BYTES;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get authenticated(): boolean {
    return !!this.options.token;
  }

  /**
   * GET with If-None-Match. A 304 resolves with `value: undefined` and, when authenticated,
   * costs no rate limit. Any other non-2xx throws a GithubError whose message never contains
   * the token (nothing from the request is echoed into it). `parse` validates the JSON body and
   * throws if it is unusable; the ETag is only remembered once it has accepted the body, so a
   * response that could not be processed is fetched again instead of answered with a 304.
   */
  async get<T>(path: string, parse: (body: unknown) => T): Promise<GetResult<T>> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "phoenix-github-capability",
    };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    const etag = this.etags[path];
    if (etag) headers["if-none-match"] = etag;

    this.calls++;
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method: "GET",
        headers,
        redirect: "error",
        signal: this.options.signal
          ? AbortSignal.any([this.options.signal, AbortSignal.timeout(this.timeoutMs)])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new GithubError("network", "GitHub is unreachable");
    }
    const rate = readRateLimit(res.headers);
    // Keep the most constraining reading of the cycle: a later response must not hide a low quota.
    if (rate.remaining !== undefined && rate.remaining <= (this.rate.remaining ?? Infinity)) {
      this.rate = {
        ...this.rate,
        remaining: rate.remaining,
        ...(rate.resetAt !== undefined ? { resetAt: rate.resetAt } : {}),
      };
    }
    if (rate.retryAfterMs !== undefined)
      this.rate = { ...this.rate, retryAfterMs: rate.retryAfterMs };
    if (res.status === 304) {
      await res.body?.cancel();
      return { value: undefined, rate };
    }
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 401) {
        throw new GithubError(
          "auth",
          "GitHub rejected the token (401): check it is valid and not expired",
          rate,
        );
      }
      if (isRateLimited(res.status, rate)) {
        throw new GithubError("rate_limit", "GitHub rate limit reached", rate);
      }
      if (res.status === 404) {
        throw new GithubError(
          "not_found",
          "Not found (404): the repository does not exist or the token cannot see it",
          rate,
        );
      }
      if (res.status === 403) {
        throw new GithubError(
          "forbidden",
          "GitHub refused the request (403): the token lacks permission for this",
          rate,
        );
      }
      throw new GithubError("http", `GitHub answered HTTP ${res.status}`, rate);
    }
    let value: T;
    try {
      value = parse(JSON.parse(await readCapped(res, this.maxBytes, this.timeoutMs)));
    } catch (err) {
      if (err instanceof GithubError) throw new GithubError(err.kind, err.message, rate);
      throw new GithubError("invalid", "GitHub sent a response in an unexpected format", rate);
    }
    const fresh = res.headers.get("etag");
    if (fresh && fresh.length <= 200) {
      if (Object.keys(this.etags).length >= MAX_ETAGS)
        delete this.etags[Object.keys(this.etags)[0]!];
      this.etags[path] = fresh;
    }
    return { value, rate };
  }

  /**
   * GET of a job-log endpoint, which answers 302 to a short-lived signed URL on another host.
   * The API request carries the token; the redirect target is fetched WITHOUT any credentials
   * (the signature in its URL is the credential), over https only, no further redirects, and
   * under the same size and time caps as every other body. Returns the raw log text; throws
   * a GithubError (never containing the token or the signed URL) on any failure.
   */
  async getLog(path: string): Promise<string> {
    const signal = () =>
      this.options.signal
        ? AbortSignal.any([this.options.signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.timeout(this.timeoutMs);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "phoenix-github-capability",
    };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    this.calls++;
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: signal(),
      });
    } catch {
      throw new GithubError("network", "GitHub is unreachable");
    }
    if (res.status >= 300 && res.status < 400) {
      const target = this.blobUrl(res.headers.get("location"));
      await res.body?.cancel().catch(() => {});
      if (!target) throw new GithubError("invalid", "GitHub sent an unusable log location");
      try {
        res = await fetch(target, {
          method: "GET",
          headers: { "user-agent": "phoenix-github-capability" },
          redirect: "error",
          signal: signal(),
        });
      } catch {
        throw new GithubError("network", "The job log could not be downloaded");
      }
    }
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => {});
      throw new GithubError("http", `Job log request answered HTTP ${res.status}`);
    }
    return readCapped(res, this.maxLogBytes, this.timeoutMs);
  }

  /** An https URL, or plain http to loopback when the API itself is on loopback (tests, dev). */
  private blobUrl(location: string | null): string | undefined {
    if (!location || location.length > 4096) return undefined;
    let url: URL;
    try {
      url = new URL(location);
    } catch {
      return undefined;
    }
    if (url.username || url.password) return undefined;
    if (url.protocol === "https:") return url.href;
    return url.protocol === "http:" && LOOPBACK.test(url.hostname) && LOOPBACK.test(this.baseHost)
      ? url.href
      : undefined;
  }
}
