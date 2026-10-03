// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type {
  ActiveTask,
  ConnectionStatus,
  Notification,
  PetState,
  PhoenixEvent,
  StoredEvent,
} from "./types";

export const WS_PROTOCOL = "phoenix.v1";
export const WS_TOKEN_PREFIX = "phoenix.token.";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  on(l: Listener<T>): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(v: T): void {
    for (const l of this.listeners) {
      try {
        l(v);
      } catch (err) {
        console.error("[phoenix] listener failed", err);
      }
    }
  }
}

export interface ClientOptions {
  token: string | null;
  /** Origin of Phoenix Core; defaults to the page's own origin. */
  baseUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
  minReconnectMs?: number;
  maxReconnectMs?: number;
}

/** Talks to Phoenix Core over HTTP and a self-healing WebSocket. */
export class PhoenixClient {
  readonly stateChanged = new Emitter<PetState>();
  readonly tasksChanged = new Emitter<ActiveTask[]>();
  readonly eventCreated = new Emitter<StoredEvent>();
  readonly statusChanged = new Emitter<ConnectionStatus>();
  readonly notificationCreated = new Emitter<Notification>();
  readonly capabilityChanged = new Emitter<PhoenixEvent>();

  private ws: WebSocket | null = null;
  private status_: ConnectionStatus = "connecting";
  private lastSeq: number | undefined;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly base: string;
  private readonly WS: typeof WebSocket;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: ClientOptions) {
    this.base =
      o.baseUrl ?? (typeof location !== "undefined" ? location.origin : "http://127.0.0.1:4870");
    this.WS = o.WebSocketImpl ?? WebSocket;
    this.fetchImpl = o.fetchImpl ?? ((...args) => fetch(...args));
  }

  get status(): ConnectionStatus {
    return this.status_;
  }

  connect(): void {
    this.closed = false;
    if (!this.o.token) return this.setStatus("unauthenticated");
    this.open();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        authorization: `Bearer ${this.o.token ?? ""}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new ApiError(
        res.status,
        json?.code ?? "UNKNOWN",
        json?.message ?? res.statusText,
        json?.details ?? [],
      );
    }
    return json as T;
  }

  private open(): void {
    this.setStatus("connecting");
    const url = this.base.replace(/^http/, "ws") + "/api/ws";
    let ws: WebSocket;
    try {
      ws = new this.WS(url, [WS_PROTOCOL, WS_TOKEN_PREFIX + this.o.token]);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(
        JSON.stringify({
          type: "subscribe",
          channels: [
            "state.changed",
            "task.updated",
            "event.created",
            "notification.created",
            "capability.health",
          ],
          ...(this.lastSeq !== undefined ? { since_seq: this.lastSeq } : {}),
        }),
      );
      this.setStatus("online");
    };
    ws.onmessage = (msg) => this.onMessage(String(msg.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private onMessage(raw: string): void {
    let msg: { type: string; channel?: string; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "message") return;
    switch (msg.channel) {
      case "state.changed":
        this.stateChanged.emit(msg.data as PetState);
        break;
      case "task.updated":
        this.tasksChanged.emit((msg.data as { tasks: ActiveTask[] }).tasks);
        break;
      case "event.created": {
        const stored = msg.data as StoredEvent;
        if (typeof stored.seq === "number") this.lastSeq = Math.max(this.lastSeq ?? 0, stored.seq);
        this.eventCreated.emit(stored);
        break;
      }
      case "notification.created": {
        const n = (msg.data as PhoenixEvent).payload?.notification as Notification | undefined;
        if (n) this.notificationCreated.emit(n);
        break;
      }
      case "capability.health":
        this.capabilityChanged.emit(msg.data as PhoenixEvent);
        break;
    }
  }

  private scheduleReconnect(): void {
    this.setStatus("offline");
    const min = this.o.minReconnectMs ?? 500;
    const max = this.o.maxReconnectMs ?? 10_000;
    const delay = Math.min(max, min * 2 ** this.attempt);
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closed) this.open();
    }, delay);
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.status_) return;
    this.status_ = s;
    this.statusChanged.emit(s);
  }
}

/** Reads the token core (or the Vite dev plugin) injected into index.html. */
export function readInjectedToken(doc: Document = document): string | null {
  return doc.querySelector<HTMLMetaElement>('meta[name="phoenix-token"]')?.content || null;
}
