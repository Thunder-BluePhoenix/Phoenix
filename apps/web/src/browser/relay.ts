// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 95: the chrome page is the only window allowed to call `page_snapshot` / `page_action`.
// While Core is online it long-polls Core for one browsing-assistant request at a time, runs it
// through the shell and posts the outcome back. This module never renders anything and never logs:
// a request may carry text the user approved to be typed, and a snapshot carries a whole page.
import { useEffect } from "react";
import type { PhoenixClient } from "../core/client";
import { useConnection } from "../core/context";
import {
  PAGE_ACTION_KINDS,
  type BrowserShell,
  type PageActionKind,
  type PageActionRequest,
} from "./shell";

export const RELAY_NEXT_PATH = "/api/browser/relay/next?wait=20000";
export const relayResultPath = (id: string) =>
  `/api/browser/relay/${encodeURIComponent(id)}/result`;

/** Backoff after an error: 1 s, doubling to 15 s. A good round trip resets it. */
export const RELAY_BACKOFF_START_MS = 1000;
export const RELAY_BACKOFF_MAX_MS = 15_000;
/** Core accepts 16 MiB for a result; stay under it. */
export const RELAY_MAX_BODY_BYTES = 14 * 1024 * 1024;

const MAX_ID = 128;
const MAX_SELECTOR = 512;
const MAX_TEXT = 4096;
const MAX_URL = 2048;

export type RelayRequest =
  | { id: string; kind: "snapshot" }
  | {
      id: string;
      kind: "click" | "download" | "submit";
      expectedUrl: string;
      selector: string;
    }
  | { id: string; kind: "type"; expectedUrl: string; selector: string; text: string }
  | { id: string; kind: "navigate"; expectedUrl: string; destination: string };

export type RelayBody =
  | { ok: true; snapshot: { url: string; title: string; html: string; truncated: boolean } }
  | { ok: true; url: string }
  | { ok: false; reason: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function str(value: unknown, key: string, max: number, controls: boolean): string | null {
  const v = value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
  if (typeof v !== "string" || v.length > max) return null;
  if (controls && CONTROL.test(v)) return null;
  return v;
}

/** The id of a request when it is usable for the answer, else null (nothing can be posted then). */
export function relayRequestId(value: unknown): string | null {
  const id = str(value, "id", MAX_ID, true);
  return id !== null && id !== "" ? id : null;
}

/** A strictly validated request, or null for anything unknown, extra, missing or too long. */
export function parseRelayRequest(value: unknown): RelayRequest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const id = relayRequestId(value);
  const kind = Reflect.get(value, "kind");
  if (id === null || typeof kind !== "string") return null;
  const keys = Object.keys(value).sort().join(",");
  if (kind === "snapshot") return keys === "id,kind" ? { id, kind } : null;
  if (!(PAGE_ACTION_KINDS as readonly string[]).includes(kind)) return null;
  const expectedUrl = str(value, "expectedUrl", MAX_URL, true);
  if (expectedUrl === null || expectedUrl === "") return null;
  if (kind === "navigate") {
    const destination = str(value, "destination", MAX_URL, true);
    if (destination === null || destination === "") return null;
    return keys === "destination,expectedUrl,id,kind"
      ? { id, kind: "navigate", expectedUrl, destination }
      : null;
  }
  const selector = str(value, "selector", MAX_SELECTOR, true);
  if (selector === null || selector === "") return null;
  if (kind === "type") {
    const text = str(value, "text", MAX_TEXT, false);
    if (text === null) return null;
    return keys === "expectedUrl,id,kind,selector,text"
      ? { id, kind: "type", expectedUrl, selector, text }
      : null;
  }
  return keys === "expectedUrl,id,kind,selector"
    ? { id, kind: kind as "click" | "download" | "submit", expectedUrl, selector }
    : null;
}

const FAILED: RelayBody = { ok: false, reason: "failed" };

function actionOf(request: Exclude<RelayRequest, { kind: "snapshot" }>): PageActionRequest {
  const kind: PageActionKind = request.kind;
  switch (request.kind) {
    case "navigate":
      return { kind, destination: request.destination, expectedUrl: request.expectedUrl };
    case "type":
      return {
        kind,
        selector: request.selector,
        text: request.text,
        expectedUrl: request.expectedUrl,
      };
    default:
      return { kind, selector: request.selector, expectedUrl: request.expectedUrl };
  }
}

/** Runs one validated request through the shell and maps the answer onto the result body. */
export async function executeRelayRequest(
  shell: BrowserShell,
  request: RelayRequest,
): Promise<RelayBody> {
  try {
    if (request.kind === "snapshot") {
      const r = await shell.pageSnapshot();
      if (!r.ok) return { ok: false, reason: r.reason };
      const { url, title, html, truncated } = r;
      return { ok: true, snapshot: { url, title, html, truncated } };
    }
    const r = await shell.pageAction(actionOf(request));
    return r.ok ? { ok: true, url: r.url } : { ok: false, reason: r.reason };
  } catch {
    return FAILED;
  }
}

/** A body that would not fit in Core's limit is replaced by a refusal the assistant can read. */
export function boundBody(body: RelayBody): RelayBody {
  const json = JSON.stringify(body);
  // UTF-8 is at most 3 bytes per UTF-16 unit, so only a big string needs its bytes counted.
  const bytes =
    json.length * 3 <= RELAY_MAX_BODY_BYTES
      ? json.length
      : new TextEncoder().encode(json).byteLength;
  return bytes > RELAY_MAX_BODY_BYTES ? { ok: false, reason: "too_large" } : body;
}

export interface RelayLoopOptions {
  client: Pick<PhoenixClient, "request">;
  shell: BrowserShell;
  signal: AbortSignal;
  /** Resolves after `ms`, or early when the signal aborts. Tests pass a manual one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) {
    resolve();
    return promise;
  }
  const done = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", done);
    resolve();
  };
  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done);
  return promise;
}

const ABORTED = Symbol("aborted");

/** Settles with `promise`, or with ABORTED as soon as the signal aborts (the promise is then ignored). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  const out = Promise.withResolvers<T | typeof ABORTED>();
  if (signal.aborted) {
    out.resolve(ABORTED);
    return out.promise;
  }
  const onAbort = () => out.resolve(ABORTED);
  signal.addEventListener("abort", onAbort, { once: true });
  promise.then(out.resolve, out.reject).finally(() => signal.removeEventListener("abort", onAbort));
  return out.promise;
}

/**
 * Polls, executes and answers one request at a time until aborted. Never throws and never logs;
 * errors only slow the loop down. After an abort nothing more is executed or posted.
 */
export async function runRelayLoop({
  client,
  shell,
  signal,
  sleep = realSleep,
}: RelayLoopOptions): Promise<void> {
  let backoff = RELAY_BACKOFF_START_MS;
  const fail = async () => {
    await sleep(backoff, signal);
    backoff = Math.min(backoff * 2, RELAY_BACKOFF_MAX_MS);
  };
  while (!signal.aborted) {
    try {
      const next = await untilAborted(
        client.request<{ request?: unknown }>("GET", RELAY_NEXT_PATH),
        signal,
      );
      if (next === ABORTED || signal.aborted) return;
      const raw = next === undefined || next === null ? null : next.request;
      if (raw === null || raw === undefined) {
        backoff = RELAY_BACKOFF_START_MS;
        continue;
      }
      const id = relayRequestId(raw);
      if (id === null) {
        await fail();
        continue;
      }
      const request = parseRelayRequest(raw);
      const body = request ? boundBody(await executeRelayRequest(shell, request)) : FAILED;
      if (signal.aborted) return;
      await client.request("POST", relayResultPath(id), body);
      backoff = RELAY_BACKOFF_START_MS;
    } catch {
      if (signal.aborted) return;
      await fail();
    }
  }
}

/** Runs the relay for as long as a shell exists and Core is online (chrome page only). */
export function useBrowserRelay(client: PhoenixClient, shell: BrowserShell | null): void {
  const online = useConnection() === "online";
  useEffect(() => {
    if (!shell || !online) return;
    const controller = new AbortController();
    void runRelayLoop({ client, shell, signal: controller.signal });
    return () => controller.abort();
  }, [client, shell, online]);
}
