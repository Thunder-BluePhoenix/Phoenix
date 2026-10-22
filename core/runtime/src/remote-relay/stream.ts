// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What every relay consumer shares: reading one server-sent-event stream, waiting out a reconnect,
// and validating the relay address. The relay is untrusted, so a frame is only ever parsed here;
// whoever consumes it decides whether it is authentic.
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const MIN_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 60_000;
/** One event larger than this ends the stream: the relay's own frame cap is 32 KiB. */
const MAX_EVENT_CHARS = 64 * 1024;

/** Tests make waits instant; production waits the backoff on a real timer. */
export type RelaySleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const defaultSleep: RelaySleep = (ms, signal) => {
  const done = Promise.withResolvers<void>();
  const timer = setTimeout(done.resolve, ms);
  timer.unref();
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      done.resolve();
    },
    { once: true },
  );
  return done.promise;
};

/** How a reconnecting consumer is told what its stream is doing. */
export interface ReconnectHooks {
  signal: AbortSignal;
  sleep: RelaySleep;
  /** True once the loop must not try again (for example the emergency stop). */
  halted(): boolean;
  /** Reads one stream to its end. */
  open(): Promise<void>;
  connected(on: boolean): void;
  failed(message: string): void;
}

/** Keeps one stream open: a clean end resets the backoff, a failure doubles it up to the cap. */
export async function keepStreamOpen(h: ReconnectHooks): Promise<void> {
  let backoff = MIN_BACKOFF_MS;
  while (!h.signal.aborted) {
    try {
      await h.open();
      backoff = MIN_BACKOFF_MS;
    } catch (error) {
      if (h.signal.aborted) break;
      h.failed(error instanceof Error ? error.message.slice(0, 120) : "stream failed");
    } finally {
      h.connected(false);
    }
    if (h.signal.aborted || h.halted()) break;
    await h.sleep(backoff, h.signal);
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
  }
}

/**
 * Opens `url` as an event stream and hands each `data:` line, parsed as JSON, to `onFrame` in
 * order. A frame that fails to parse or is refused by `onFrame` goes to `onError` and the stream
 * continues. Resolves when the stream ends; rejects when it cannot be opened or is too large.
 */
export async function readRelayStream(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
  onFrame: (frame: unknown) => void | Promise<void>,
  onError: (error: unknown) => void,
  onOpen?: () => void,
): Promise<void> {
  const response = await fetcher(url, { headers: { accept: "text/event-stream" }, signal });
  if (!response.ok || !response.body) throw new Error(`Relay stream failed (${response.status})`);
  onOpen?.();
  const decoder = new TextDecoder();
  let pending = "";
  const reader = response.body.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    pending += decoder.decode(chunk.value, { stream: true });
    if (pending.length > MAX_EVENT_CHARS) throw new Error("Relay event too large");
    let end: number;
    while ((end = pending.indexOf("\n\n")) >= 0) {
      const event = pending.slice(0, end).replace(/\r/g, "");
      pending = pending.slice(end + 2);
      const line = event.split("\n").find((row) => row.startsWith("data: "));
      if (!line) continue;
      try {
        await onFrame(JSON.parse(line.slice(6)));
      } catch (error) {
        onError(error);
      }
    }
  }
}

/** HTTPS only, plus plain http on loopback for a relay you run on this machine. */
export function relayUrl(input: unknown): string {
  const raw = input !== null && typeof input === "object" && "url" in input ? input.url : undefined;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300)
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"url" must be the relay address');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"url" must be a URL');
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "The relay must use HTTPS");
  if (url.username || url.password || url.search || url.hash)
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "The relay URL cannot carry credentials");
  return url.toString().replace(/\/$/, "");
}
