// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Shared plumbing for the provider adapters: a fetch wrapper that maps every failure to a
// ModelError, size-capped body readers, and line / SSE parsers. Provider replies are hostile
// input: every limit here is a ceiling, not an expectation.
import { redact } from "@phoenix/logging";
import { MAX_ERROR_CHARS, ModelError } from "./errors";

/** The slice of `fetch` the adapters use. Tests inject a fake. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Largest non-streaming reply read (embeddings of many inputs are the big case). */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** Largest streamed reply read in total. */
export const MAX_STREAM_BYTES = 16 * 1024 * 1024;
/** Longest single NDJSON / SSE line. One token per line is tiny; this is a ceiling. */
export const MAX_LINE_CHARS = 1024 * 1024;
/** How much of an HTTP error body is read to build a message. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;
/** Longest wait honoured from a Retry-After header. */
export const MAX_RETRY_AFTER_MS = 30_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON.parse that returns an object or undefined (never throws, never returns arrays/scalars). */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Removes every occurrence of each secret, then redacts anything that looks like a secret. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret.length > 0) out = out.split(secret).join("[REDACTED]");
  const redacted = redact(out);
  return (typeof redacted === "string" ? redacted : "").slice(0, MAX_ERROR_CHARS);
}

export interface ScopeLimits {
  /** Whole-call deadline. */
  totalMs: number;
  /** Maximum wait for the next network chunk (streams). */
  idleMs?: number;
}

/**
 * One call's cancellation: the caller's signal, a total deadline and an optional idle deadline.
 * The idle timer only runs while we wait on the network (see `pause`), so a slow consumer of a
 * stream is never mistaken for a stalled provider.
 */
export interface CallScope {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  callerAborted(): boolean;
  /** Start (or restart) the idle timer. */
  touch(): void;
  /** Stop the idle timer while the consumer works on what it received. */
  pause(): void;
  dispose(): void;
}

export function createScope(callerSignal: AbortSignal | undefined, limits: ScopeLimits): CallScope {
  const controller = new AbortController();
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  const total = setTimeout(expire, limits.totalMs);
  let idle: NodeJS.Timeout | undefined;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const scope: CallScope = {
    signal: controller.signal,
    timedOut: () => timedOut,
    callerAborted: () => callerSignal?.aborted === true,
    touch() {
      if (limits.idleMs === undefined) return;
      clearTimeout(idle);
      idle = setTimeout(expire, limits.idleMs);
    },
    pause() {
      clearTimeout(idle);
    },
    dispose() {
      clearTimeout(total);
      clearTimeout(idle);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
  scope.touch();
  return scope;
}

/** Maps "the call stopped" to the right error: the caller aborted, we timed out, or the network failed. */
export function stoppedError(scope: CallScope, provider: string): ModelError {
  if (scope.callerAborted())
    return new ModelError("aborted", provider, "The request was cancelled");
  if (scope.timedOut()) {
    return new ModelError("timeout", provider, `${provider} did not answer in time`, {
      retryable: true,
    });
  }
  return new ModelError("network", provider, `Could not reach ${provider}`, { retryable: true });
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/** Pulls a short message out of `{error: "..."}` or `{error: {message: "..."}}` bodies. */
function errorMessageOf(body: Record<string, unknown> | undefined): string | undefined {
  if (!body) return undefined;
  const direct = str(body.error);
  if (direct !== undefined) return direct;
  if (isRecord(body.error)) return str(body.error.message) ?? str(body.error.type);
  return undefined;
}

/** Builds the error for a non-2xx reply. 401/403 are auth, 429 and 5xx are retryable. */
export function httpError(
  provider: string,
  status: number,
  bodyText: string,
  retryAfter: string | null,
  secrets: readonly string[],
): ModelError {
  const detail = errorMessageOf(parseJsonObject(bodyText));
  const suffix = detail === undefined ? "" : `: ${scrub(detail, secrets)}`;
  if (status === 401 || status === 403) {
    return new ModelError(
      "auth",
      provider,
      `${provider} rejected the credentials (HTTP ${status})`,
      {
        status,
      },
    );
  }
  return new ModelError("http", provider, `${provider} replied HTTP ${status}${suffix}`, {
    status,
    retryable: status === 429 || status >= 500,
    retryAfterMs: parseRetryAfter(retryAfter),
  });
}

interface ChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}
interface Chunk {
  done: boolean;
  value: Uint8Array;
}

/** One read from a body. A read that fails because the call was stopped becomes the right error. */
async function readChunk(reader: ChunkReader, scope: CallScope, provider: string): Promise<Chunk> {
  try {
    const step = await reader.read();
    return { done: step.done, value: step.value ?? new Uint8Array(0) };
  } catch {
    throw stoppedError(scope, provider);
  }
}

/** Reads at most `maxBytes` of text; cancels the connection past that. */
export async function readCappedText(
  res: Response,
  provider: string,
  scope: CallScope,
  maxBytes: number,
): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ModelError("protocol", provider, `${provider} reply is too large`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  scope.signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const step = await readChunk(reader, scope, provider);
      if (scope.signal.aborted) throw stoppedError(scope, provider);
      if (step.done) break;
      size += step.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ModelError("protocol", provider, `${provider} reply is too large`);
      }
      chunks.push(step.value);
    }
  } finally {
    scope.signal.removeEventListener("abort", cancel);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface SendInit {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Strings that must never appear in an error message (API keys). */
  secrets?: readonly string[];
}

/**
 * Sends one request. Any failure becomes a ModelError with a message written here: raw errors
 * from fetch are dropped because they can echo URLs or header values. Redirects are errors: a
 * redirect could carry credentials to another host.
 */
export async function send(
  fetchFn: FetchLike,
  provider: string,
  url: string,
  init: SendInit,
  scope: CallScope,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: scope.signal,
      redirect: "error",
    });
  } catch {
    throw stoppedError(scope, provider);
  }
  if (res.ok) return res;
  const bodyText = await readCappedText(res, provider, scope, MAX_ERROR_BODY_BYTES).catch(
    (err: unknown) => {
      if (err instanceof ModelError && err.kind === "aborted") throw err;
      return "";
    },
  );
  throw httpError(
    provider,
    res.status,
    bodyText,
    res.headers.get("retry-after"),
    init.secrets ?? [],
  );
}

/**
 * Splits a response body into lines. Tolerates lines split across network chunks and `\r\n`.
 * Stops reading (cancels the connection) when the consumer stops iterating, the caller aborts
 * or a deadline passes.
 */
export async function* readLines(
  res: Response,
  provider: string,
  scope: CallScope,
  maxBytes = MAX_STREAM_BYTES,
): AsyncGenerator<string> {
  if (!res.body) throw new ModelError("protocol", provider, `${provider} sent an empty body`);
  const reader = res.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  scope.signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let total = 0;
  try {
    for (;;) {
      scope.touch();
      const step = await readChunk(reader, scope, provider);
      scope.pause();
      if (scope.signal.aborted) throw stoppedError(scope, provider);
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes)
        throw new ModelError("protocol", provider, `${provider} reply is too large`);
      buffer += decoder.decode(step.value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        yield line;
      }
      if (buffer.length > MAX_LINE_CHARS) {
        throw new ModelError("protocol", provider, `${provider} sent an over-long line`);
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, "");
  } finally {
    scope.signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
  }
}

export interface SseEvent {
  event: string | undefined;
  data: string;
}

/** Groups lines into Server-Sent Events (`event:` / `data:` fields, blank line ends an event). */
export async function* readSse(lines: AsyncIterable<string>): AsyncGenerator<SseEvent> {
  let event: string | undefined;
  let data: string[] = [];
  for await (const line of lines) {
    if (line === "") {
      if (data.length > 0) yield { event, data: data.join("\n") };
      event = undefined;
      data = [];
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length > 0) yield { event, data: data.join("\n") };
}
