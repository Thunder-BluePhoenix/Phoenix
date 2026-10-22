// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** Largest request body the relay reads. A real frame is a few hundred bytes plus the ciphertext. */
export const MAX_FRAME_BYTES = 32 * 1024;
/** Concurrent event streams on one `route/peer` address. */
export const MAX_STREAMS_PER_PEER = 4;
/** Concurrent event streams across the whole relay. */
export const MAX_STREAMS = 256;
export const KEEPALIVE_MS = 20_000;

const ROUTE = /^[a-f0-9]{32}$/;
const DEVICE = /^dev_[a-f0-9]{12}$/;
const TEAM = /^tm_[a-f0-9]{12}$/;
const PEER = /^(core|dev_[a-f0-9]{12}|tm_[a-f0-9]{12})$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FRAME_KEYS = "ciphertext,ephemeral_key,iv,sender,tag";

/** The only thing the relay ever holds about a message: who sent it and which peer it is for. */
export interface RelayOptions {
  /**
   * Starts the keep-alive beat for one open event stream and returns its stop function.
   * Default: a real interval every {@link KEEPALIVE_MS}. Tests inject a beat they call by hand.
   */
  keepalive?: (beat: () => void) => () => void;
  /** Test seam that may report a post-write stream as backpressured. */
  backpressured?(target: ServerResponse, message: string): boolean;
}

const everyKeepalive = (beat: () => void): (() => void) => {
  const timer = setInterval(beat, KEEPALIVE_MS);
  timer.unref();
  return () => clearInterval(timer);
};

function field(frame: Record<string, unknown>, name: string, max: number, length?: number) {
  const value = frame[name];
  return (
    typeof value === "string" &&
    value.length <= max &&
    (length === undefined || value.length === length) &&
    BASE64.test(value)
  );
}

/**
 * Direction is routing metadata too. Core talks to its phones and phones talk to Core; teammates
 * (Phase 92) talk only to teammates. A team address never reaches Core or a phone, or the reverse.
 */
function allowedDirection(sender: string, peer: string): boolean {
  if (sender === "core") return DEVICE.test(peer);
  if (DEVICE.test(sender)) return peer === "core";
  return TEAM.test(sender) && TEAM.test(peer);
}

/** The frame is opaque: shape and size only. The relay holds no key and cannot read the payload. */
function validFrame(frame: unknown): frame is Record<string, string> & { sender: string } {
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) return false;
  const record = frame as Record<string, unknown>;
  return (
    Object.keys(record).sort().join() === FRAME_KEYS &&
    typeof record.sender === "string" &&
    PEER.test(record.sender) &&
    field(record, "ephemeral_key", 256) &&
    field(record, "iv", 16, 16) &&
    field(record, "tag", 24, 24) &&
    field(record, "ciphertext", 44_000)
  );
}

/**
 * Stateless forwarder. Nothing is queued, stored or logged: a frame is written to the streams that
 * are open at that instant, and a post with nobody listening is refused (`503`) so the sender knows
 * it was not delivered. No key, device roster or approval content exists here; the route id is
 * routing metadata (a random 128-bit address), not an authenticator.
 */
export function createRelayServer(options: RelayOptions = {}): Server {
  const keepalive = options.keepalive ?? everyKeepalive;
  const listeners = new Map<string, Set<ServerResponse>>();
  let streams = 0;

  /** SSE has no bounded queue: a backpressured peer is dropped rather than consuming relay memory. */
  const write = (target: ServerResponse, message: string): void => {
    const accepted = target.write(message);
    if (!target.writable || !accepted || options.backpressured?.(target, message)) target.destroy();
  };
  const stream = (key: string, res: ServerResponse): void => {
    if ((listeners.get(key)?.size ?? 0) >= MAX_STREAMS_PER_PEER || streams >= MAX_STREAMS) {
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    write(res, ": connected\n\n");
    const peers = listeners.get(key) ?? new Set<ServerResponse>();
    peers.add(res);
    listeners.set(key, peers);
    streams++;
    const stop = keepalive(() => write(res, ": keepalive\n\n"));
    res.on("close", () => {
      stop();
      streams--;
      peers.delete(res);
      if (peers.size === 0) listeners.delete(key);
    });
  };

  const post = async (
    route: string,
    peer: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    if (req.headers["content-type"] !== "application/json") {
      res.writeHead(415).end();
      return;
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_FRAME_BYTES) {
      res.writeHead(413).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk as Buffer);
      size += bytes.length;
      if (size > MAX_FRAME_BYTES) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    let frame: unknown;
    try {
      frame = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Direction is routing metadata too: Core talks to devices, devices talk to Core.
    if (!validFrame(frame) || !allowedDirection(frame.sender, peer)) {
      res.writeHead(400).end();
      return;
    }
    const targets = listeners.get(`${route}/${peer}`);
    if (!targets?.size) {
      res.writeHead(503).end();
      return;
    }
    // Re-serialised so a body with embedded newlines can never break server-sent-event framing.
    const event = `data: ${JSON.stringify(frame)}\n\n`;
    for (const target of targets) write(target, event);
    res.writeHead(202).end();
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const match = /^\/v1\/routes\/([^/]+)\/peers\/([^/]+)$/.exec(req.url ?? "");
    const route = match?.[1] ?? "";
    const peer = match?.[2] ?? "";
    if (!ROUTE.test(route) || !PEER.test(peer) || (req.method !== "GET" && req.method !== "POST")) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "GET") {
      stream(`${route}/${peer}`, res);
      return;
    }
    post(route, peer, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  server.on("close", () => {
    for (const peers of listeners.values()) for (const peer of peers) peer.end();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 256;
  return server;
}
