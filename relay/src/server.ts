// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const MAX_FRAME = 32 * 1024;
const ROUTE = /^[a-f0-9]{32}$/;
const PEER = /^(core|dev_[a-f0-9]{12})$/;

/** No message queue, keys, device roster, or approval content is stored by the relay. */
export function createRelayServer(): Server {
  const listeners = new Map<string, Set<ServerResponse>>();
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const match = /^\/v1\/routes\/([^/]+)\/peers\/([^/]+)$/.exec(req.url ?? "");
    if (!match || !ROUTE.test(match[1]!) || !PEER.test(match[2]!) ||
        (req.method !== "GET" && req.method !== "POST")) {
      res.writeHead(404).end();
      return;
    }
    const key = `${match[1]}/${match[2]}`;
    if (req.method === "GET") {
      if ((listeners.get(key)?.size ?? 0) >= 4 || listeners.size >= 256) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");
      const peers = listeners.get(key) ?? new Set<ServerResponse>();
      peers.add(res);
      listeners.set(key, peers);
      const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 20_000);
      res.on("close", () => {
        clearInterval(heartbeat);
        peers.delete(res);
        if (peers.size === 0) listeners.delete(key);
      });
      return;
    }
    if (req.headers["content-type"] !== "application/json" ||
        Number(req.headers["content-length"] ?? 0) > MAX_FRAME) {
      res.writeHead(413).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk as Buffer);
        size += bytes.length;
        if (size > MAX_FRAME) throw new Error("frame too large");
        chunks.push(bytes);
      }
    } catch {
      res.writeHead(413).end();
      return;
    }
    const bytes = Buffer.concat(chunks);
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (typeof frame.sender !== "string" || !PEER.test(frame.sender) ||
        typeof frame.ephemeral_key !== "string" || typeof frame.iv !== "string" ||
        typeof frame.ciphertext !== "string" || typeof frame.tag !== "string" ||
        Object.keys(frame).sort().join() !== "ciphertext,ephemeral_key,iv,sender,tag") {
      res.writeHead(400).end();
      return;
    }
    const peers = listeners.get(key);
    if (!peers?.size) {
      res.writeHead(503).end();
      return;
    }
    const event = `data: ${bytes.toString("utf8")}\n\n`;
    for (const peer of peers) peer.write(event);
    res.writeHead(202).end();
  });
  server.on("close", () => {
    for (const peers of listeners.values()) for (const peer of peers) peer.end();
    listeners.clear();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 256;
  return server;
}
