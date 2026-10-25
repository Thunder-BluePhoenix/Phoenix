// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The queue between Core and the Phoenix browser's CHROME page (Phase 95). Core cannot call a Tauri
// command; the chrome page long-polls `GET /api/browser/relay/next`, runs each request through the
// chrome-window-only commands `page_snapshot` / `page_action`, and posts the outcome back. Nothing
// here reaches a content window, and no web page can poll or answer: the routes need the session token.

/** One thing Core asks the chrome page to do on the ACTIVE tab. */
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

type Body<T> = T extends unknown ? Omit<T, "id"> : never;
export type RelayRequestBody = Body<RelayRequest>;

export interface PageSnapshotBody {
  url: string;
  title: string;
  html: string;
  truncated: boolean;
}

export type RelayOutcome =
  { ok: true; snapshot?: PageSnapshotBody; url?: string } | { ok: false; reason: string };

export type RelayErrorKind = "not_attached" | "busy" | "timeout" | "cancelled" | "refused";

export class RelayError extends Error {
  override name = "RelayError";
  constructor(
    readonly kind: RelayErrorKind,
    message: string,
    /** True when the chrome page already took the request: an action may have happened. */
    readonly dispatched = false,
  ) {
    super(message);
  }
}

/** Longest page the relay accepts, in UTF-16 characters (the Rust command cuts at the same size). */
export const MAX_SNAPSHOT_CHARS = 4 * 1024 * 1024;
export const MAX_RELAY_URL_CHARS = 2048;
export const MAX_RELAY_TITLE_CHARS = 300;
const REASON = /^[a-z][a-z0-9_]{0,39}$/;

export interface BrowserRelayOptions {
  now?: () => number;
  /** How long a request may wait for an answer before it is dropped. Default 25 s. */
  requestTimeoutMs?: number;
  /** The chrome page counts as attached this long after its last poll. Default 40 s. */
  attachedTtlMs?: number;
  /** Requests that may wait in the queue. Default 4. */
  maxQueue?: number;
}

interface Pending {
  request: RelayRequest;
  settle: (outcome: RelayOutcome) => void;
  fail: (error: RelayError) => void;
  handedOut: boolean;
  timer: NodeJS.Timeout;
}

let counter = 0;

/** Long-poll relay with one consumer (the chrome page). In memory only; nothing is persisted. */
export class BrowserRelay {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly maxQueue: number;
  private readonly pending = new Map<string, Pending>();
  private readonly queue: string[] = [];
  private waiter: { resolve: (r: RelayRequest | null) => void; timer: NodeJS.Timeout } | undefined;
  private lastPoll = Number.NEGATIVE_INFINITY;

  constructor(options: BrowserRelayOptions = {}) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.requestTimeoutMs ?? 25_000;
    this.ttlMs = options.attachedTtlMs ?? 40_000;
    this.maxQueue = options.maxQueue ?? 4;
  }

  /** True while a Phoenix browser chrome page is polling. */
  attached(): boolean {
    return this.waiter !== undefined || this.now() - this.lastPoll < this.ttlMs;
  }

  /** Queues one request and resolves with the chrome page's answer. */
  request(body: RelayRequestBody, signal?: AbortSignal): Promise<RelayOutcome> {
    if (signal?.aborted) return Promise.reject(new RelayError("cancelled", "Cancelled"));
    if (!this.attached())
      return Promise.reject(
        new RelayError("not_attached", "The Phoenix browser window is not open."),
      );
    if (this.queue.length >= this.maxQueue)
      return Promise.reject(new RelayError("busy", "The browser is busy."));
    const id = `rq_${this.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const request = { ...body, id } as RelayRequest;
    return new Promise<RelayOutcome>((resolve, reject) => {
      const done = () => {
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        const at = this.queue.indexOf(id);
        if (at >= 0) this.queue.splice(at, 1);
      };
      const entry: Pending = {
        request,
        handedOut: false,
        settle: (outcome) => {
          done();
          resolve(outcome);
        },
        fail: (error) => {
          done();
          reject(error);
        },
        timer: setTimeout(
          () =>
            entry.fail(
              new RelayError(
                "timeout",
                "The browser did not answer in time.",
                entry.handedOut && request.kind !== "snapshot",
              ),
            ),
          this.timeoutMs,
        ),
      };
      entry.timer.unref();
      const onAbort = () =>
        entry.fail(
          new RelayError("cancelled", "Cancelled", entry.handedOut && request.kind !== "snapshot"),
        );
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, entry);
      this.queue.push(id);
      this.flush();
    });
  }

  /** The chrome page's long poll. A newer poll replaces an older one (which answers `null`). */
  next(waitMs: number, signal?: AbortSignal): Promise<RelayRequest | null> {
    this.lastPoll = this.now();
    this.waiter?.resolve(null);
    const ready = this.takeNext();
    if (ready) return Promise.resolve(ready);
    const wait = Math.max(0, Math.min(25_000, Math.floor(waitMs)));
    if (wait === 0 || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = (value: RelayRequest | null) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (this.waiter?.resolve === finish) this.waiter = undefined;
        this.lastPoll = this.now();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), wait);
      timer.unref();
      const onAbort = () => finish(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiter = { resolve: finish, timer };
    });
  }

  /** The chrome page's answer. False when the request is unknown, expired or already answered. */
  complete(id: string, body: unknown): boolean {
    const entry = this.pending.get(id);
    if (!entry?.handedOut) return false;
    entry.settle(parseOutcome(entry.request.kind, body));
    return true;
  }

  /** Drops everything (shutdown): waiting callers are told it was cancelled. */
  close(): void {
    this.waiter?.resolve(null);
    for (const entry of [...this.pending.values()])
      entry.fail(new RelayError("cancelled", "Phoenix is shutting down", entry.handedOut));
  }

  private takeNext(): RelayRequest | null {
    const id = this.queue.shift();
    const entry = id === undefined ? undefined : this.pending.get(id);
    if (!entry) return null;
    entry.handedOut = true;
    return entry.request;
  }

  private flush(): void {
    const waiter = this.waiter;
    if (!waiter) return;
    const next = this.takeNext();
    if (next) waiter.resolve(next);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const FAILED: RelayOutcome = { ok: false, reason: "failed" };

/** Anything that is not exactly the shape for this kind becomes a plain `failed`. */
export function parseOutcome(kind: RelayRequest["kind"], body: unknown): RelayOutcome {
  if (!isRecord(body)) return FAILED;
  if (body.ok === false) {
    return {
      ok: false,
      reason: typeof body.reason === "string" && REASON.test(body.reason) ? body.reason : "failed",
    };
  }
  if (body.ok !== true) return FAILED;
  if (kind === "snapshot") {
    const s = body.snapshot;
    if (
      !isRecord(s) ||
      typeof s.url !== "string" ||
      typeof s.title !== "string" ||
      typeof s.html !== "string" ||
      typeof s.truncated !== "boolean" ||
      s.url.length > MAX_RELAY_URL_CHARS ||
      s.html.length > MAX_SNAPSHOT_CHARS
    )
      return FAILED;
    return {
      ok: true,
      snapshot: {
        url: s.url,
        title: s.title.slice(0, MAX_RELAY_TITLE_CHARS),
        html: s.html,
        truncated: s.truncated,
      },
    };
  }
  if (typeof body.url !== "string" || body.url.length > MAX_RELAY_URL_CHARS) return FAILED;
  return { ok: true, url: body.url };
}
