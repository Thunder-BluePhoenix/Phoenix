// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { ErrorCode, PROTOCOL_VERSION, type PhoenixEvent } from "@phoenix/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { WS_PROTOCOL } from "./security";
import type { CoreServices } from "./services";

export const CHANNELS = [
  "state.changed",
  "event.created",
  "task.updated",
  "capability.health",
  "notification.created",
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Messages the server sends. */
export type ServerMessage =
  | { type: "hello"; protocol: string; channels: readonly Channel[] }
  | { type: "subscribed"; channels: Channel[] }
  | { type: "message"; channel: Channel; data: unknown }
  | { type: "error"; code: string; message: string };

/** Messages a client may send. */
export interface SubscribeMessage {
  type: "subscribe";
  channels: Channel[];
  /** Replay durable events after this history seq on event.created (resume after reconnect). */
  since_seq?: number;
}

const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_REPLAY = 1000;

interface Client {
  ws: WebSocket;
  channels: Set<Channel>;
  alive: boolean;
}

export interface WebSocketMetrics {
  connections: number;
  totalConnections: number;
  reconnects: number;
  droppedSlowClients: number;
}

/** Fans core activity out to WebSocket clients on named channels. */
export class WebSocketHub {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  private readonly clients = new Set<Client>();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly pingTimer: NodeJS.Timeout;
  private readonly m = { totalConnections: 0, reconnects: 0, droppedSlowClients: 0 };

  constructor(private readonly s: CoreServices) {
    this.unsubscribe.push(
      s.state.onChange((snapshot) => this.broadcast("state.changed", snapshot)),
      s.state.onTasksChange((tasks) => this.broadcast("task.updated", { tasks })),
      s.bus.subscribe("api.websocket", "*", (event, info) => {
        if (!info.ephemeral) {
          this.broadcast("event.created", {
            seq: info.seq,
            event,
            description: s.state.describe(event),
          });
        }
        const channel = channelFor(event);
        if (channel) this.broadcast(channel, event);
      }),
    );
    this.pingTimer = setInterval(() => this.heartbeat(), 30_000);
    this.pingTimer.unref();
  }

  /** Completes an already-authenticated upgrade. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
  }

  metrics(): WebSocketMetrics {
    return { connections: this.clients.size, ...this.m };
  }

  close(): void {
    clearInterval(this.pingTimer);
    for (const u of this.unsubscribe) u();
    for (const c of this.clients) c.ws.close(1001, "Server shutting down");
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    const client: Client = { ws, channels: new Set(), alive: true };
    this.clients.add(client);
    this.m.totalConnections++;
    ws.on("pong", () => (client.alive = true));
    ws.on("close", () => this.clients.delete(client));
    ws.on("error", () => this.clients.delete(client));
    ws.on("message", (raw) => this.onMessage(client, raw.toString()));
    this.send(client, { type: "hello", protocol: PROTOCOL_VERSION, channels: CHANNELS });
  }

  private onMessage(client: Client, raw: string): void {
    let msg: SubscribeMessage;
    try {
      msg = JSON.parse(raw) as SubscribeMessage;
    } catch {
      return this.send(client, {
        type: "error",
        code: ErrorCode.INVALID_REQUEST,
        message: "Invalid JSON",
      });
    }
    if (msg?.type !== "subscribe" || !Array.isArray(msg.channels)) {
      return this.send(client, {
        type: "error",
        code: ErrorCode.INVALID_REQUEST,
        message: "Expected a subscribe message",
      });
    }
    const unknown = msg.channels.filter((c) => !(CHANNELS as readonly string[]).includes(c));
    if (unknown.length > 0) {
      return this.send(client, {
        type: "error",
        code: ErrorCode.INVALID_REQUEST,
        message: `Unknown channel(s): ${unknown.join(", ")}`,
      });
    }
    if (msg.since_seq !== undefined && (!Number.isInteger(msg.since_seq) || msg.since_seq < 0)) {
      return this.send(client, {
        type: "error",
        code: ErrorCode.INVALID_REQUEST,
        message: "since_seq must be a non-negative integer",
      });
    }

    for (const c of msg.channels) client.channels.add(c);
    this.send(client, { type: "subscribed", channels: [...client.channels] });

    // Send current state so the client never shows stale data.
    if (msg.channels.includes("state.changed")) {
      this.send(client, {
        type: "message",
        channel: "state.changed",
        data: this.s.state.snapshot(),
      });
    }
    if (msg.channels.includes("task.updated")) {
      this.send(client, {
        type: "message",
        channel: "task.updated",
        data: { tasks: this.s.state.tasks() },
      });
    }
    if (msg.channels.includes("event.created") && msg.since_seq !== undefined) {
      this.m.reconnects++;
      const missed = this.s.events.recent({ afterSeq: msg.since_seq, limit: MAX_REPLAY }).reverse();
      for (const { seq, event } of missed) {
        this.send(client, {
          type: "message",
          channel: "event.created",
          data: { seq, event, description: this.s.state.describe(event) },
        });
      }
    }
  }

  private broadcast(channel: Channel, data: unknown): void {
    for (const c of this.clients) {
      if (c.channels.has(channel)) this.send(c, { type: "message", channel, data });
    }
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.ws.readyState !== client.ws.OPEN) return;
    if (client.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      // A client that cannot keep up is dropped rather than slowing everyone down.
      this.m.droppedSlowClients++;
      client.ws.close(1013, "Client too slow");
      this.clients.delete(client);
      return;
    }
    client.ws.send(JSON.stringify(message));
  }

  private heartbeat(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}

function channelFor(event: PhoenixEvent): Channel | undefined {
  if (event.event_type.startsWith("capability.")) return "capability.health";
  if (event.event_type === "notification.created") return "notification.created";
  return undefined;
}
