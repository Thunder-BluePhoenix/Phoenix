// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The only place this capability touches the network: global fetch with a timeout, no
// redirects (a redirect could carry an Authorization header elsewhere), and a hard cap on
// how much of a reply is read.
import { TrackerError, type HttpLimits } from "./types";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Longest wait a tracker can ask of us before we try again anyway. */
export const MAX_RETRY_AFTER_MS = 60 * 60_000;

export interface HttpResult {
  status: number;
  headers: Headers;
  body: string;
}

export interface HttpRequest {
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

/** Reads at most `maxBytes` of the reply; the fetch signal also bounds how long that takes. */
async function readCapped(res: Response, maxBytes: number, label: string): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new TrackerError("unavailable", `${label} reply is too large`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TrackerError("unavailable", `${label} reply is too large`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Issues one request. Throws TrackerError("unavailable") for anything below HTTP. */
export async function httpRequest(
  url: string,
  request: HttpRequest,
  limits: HttpLimits,
  signal: AbortSignal,
): Promise<HttpResult> {
  const label = new URL(url).host;
  const deadline = AbortSignal.timeout(limits.timeoutMs);
  try {
    const res = await fetch(url, {
      method: request.method ?? "GET",
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      redirect: "error",
      signal: AbortSignal.any([signal, deadline]),
    });
    const body = await readCapped(res, limits.maxBytes, label);
    return { status: res.status, headers: res.headers, body };
  } catch (err) {
    if (err instanceof TrackerError) throw err;
    if (deadline.aborted) throw new TrackerError("unavailable", `${label} did not answer in time`);
    if (signal.aborted) throw new TrackerError("unavailable", "Polling stopped");
    throw new TrackerError("unavailable", `${label} is unreachable`);
  }
}

/** Seconds in a Retry-After header, as milliseconds (capped), or undefined. */
export function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null || !/^\d{1,7}$/.test(raw.trim())) return undefined;
  return Math.min(Number(raw) * 1000, MAX_RETRY_AFTER_MS);
}

/** Maps a non-2xx reply onto a TrackerError. Provider-specific cases are handled before this. */
export function statusError(tracker: string, res: HttpResult): TrackerError {
  if (res.status === 401) {
    return new TrackerError("auth", `${tracker} rejected the credentials (401)`);
  }
  if (res.status === 403) {
    return new TrackerError("auth", `${tracker} refused access (403); check the token's scopes`);
  }
  if (res.status === 429) {
    return new TrackerError("rate_limit", `${tracker} rate limit reached`, retryAfterMs(res.headers));
  }
  return new TrackerError("unavailable", `${tracker} responded ${res.status}`);
}

const LOOPBACK: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

/**
 * Validates a configured API base URL. https only (credentials go in the headers), except
 * loopback so tests and local mocks work. Returns it without query, fragment or trailing slash.
 */
export function resolveBase(raw: string, what: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TrackerError("config", `${what} is not a valid URL`);
  }
  const loopback = LOOPBACK[url.hostname] === true;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TrackerError("config", `${what} must use https`);
  }
  if (url.username || url.password) {
    throw new TrackerError("config", `${what} must not contain credentials`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
