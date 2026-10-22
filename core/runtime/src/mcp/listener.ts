// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The MCP HTTP listener (Phase 76). A SEPARATE server from the loopback API: its own socket, bound
// to 127.0.0.1 only, one route (`POST /mcp`), no static files, no CORS, no WebSocket upgrade, no
// session token. A browser page cannot use it: any `Origin` header is refused (browsers always send
// one on cross-site requests) and the `Host` header must be exactly this socket's own name, which
// defeats DNS rebinding. Authentication is the per-client bearer token, checked by the handler.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Logger } from "@phoenix/logging";
import type { McpHandler } from "./handler";
import { rpcError, RpcCode, type McpReply } from "./protocol";

export const MCP_BODY_MAX_BYTES = 64 * 1024;
export const MCP_PATH = "/mcp";
export const MCP_HOST = "127.0.0.1";
export const MCP_MAX_CONNECTIONS = 16;

export type McpRefusal =
  "host" | "origin" | "method" | "path" | "content_type" | "body_too_large" | "bad_body";

export interface McpListenerOptions {
  handler: Pick<McpHandler, "handle">;
  logger: Logger;
  /** Called (without any request content) when a request is refused before it reaches the handler. */
  refused: (reason: McpRefusal) => void;
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  if (Number(req.headers["content-length"] ?? 0) > MCP_BODY_MAX_BYTES) {
    reject(new TooLarge());
    return promise;
  }
  let size = 0;
  let over = false;
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => {
    if (over) return;
    size += chunk.length;
    if (size > MCP_BODY_MAX_BYTES) {
      over = true;
      chunks.length = 0;
      req.pause();
      reject(new TooLarge());
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!over) resolve(Buffer.concat(chunks));
  });
  req.on("error", reject);
  return promise;
}

function send(res: ServerResponse, reply: McpReply): void {
  if (res.headersSent) return;
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (reply.retryAfterSeconds !== undefined)
    headers["retry-after"] = String(reply.retryAfterSeconds);
  if (reply.challenge) headers["www-authenticate"] = "Bearer";
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  res.writeHead(reply.status, { ...headers, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(reply.body));
}

export class McpListener {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly hosts = new Set<string>();
  private readonly logger: Logger;

  constructor(private readonly o: McpListenerOptions) {
    this.logger = o.logger.child("mcp");
    this.server = createServer((req, res) => void this.onRequest(req, res));
    this.server.maxConnections = MCP_MAX_CONNECTIONS;
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 60_000;
    this.server.keepAliveTimeout = 5_000;
    this.server.on("connection", (socket: Socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server.on("upgrade", (_req, socket) => socket.destroy());
    this.server.on("connect", (_req, socket) => socket.destroy());
  }

  async listen(port: number): Promise<AddressInfo> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.server.once("error", reject);
    this.server.listen(port, MCP_HOST, () => resolve());
    await promise;
    this.server.off("error", reject);
    const info = this.server.address() as AddressInfo;
    this.hosts.add(`${MCP_HOST}:${info.port}`);
    this.hosts.add(`localhost:${info.port}`);
    return info;
  }

  /** Closes the socket and drops every open connection (in-flight calls included). Safe twice. */
  async close(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.server.close(() => resolve());
    this.server.closeAllConnections();
    for (const socket of this.sockets) socket.destroy();
    await promise;
  }

  /** Answers a request the handler never saw, then closes the connection: it may hold unread bytes. */
  private refuse(res: ServerResponse, status: number, reason: McpRefusal, message: string): void {
    this.o.refused(reason);
    res.setHeader("connection", "close");
    send(res, { status, body: rpcError(null, RpcCode.INVALID_REQUEST, message) });
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const host = req.headers.host?.toLowerCase();
      if (host === undefined || !this.hosts.has(host)) {
        req.resume();
        return this.refuse(res, 403, "host", "Host not allowed");
      }
      // No browser client is supported: a browser always sends Origin cross-site, so any Origin is refused.
      if (req.headers.origin !== undefined) {
        req.resume();
        return this.refuse(res, 403, "origin", "Browser origins are not allowed");
      }
      const pathname = (req.url ?? "/").split("?")[0];
      if (pathname !== MCP_PATH) {
        req.resume();
        return this.refuse(res, 404, "path", "Not found");
      }
      if (req.method !== "POST") {
        req.resume();
        res.setHeader("allow", "POST");
        return this.refuse(res, 405, "method", "Only POST is supported");
      }
      if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        req.resume();
        return this.refuse(res, 415, "content_type", "Content-Type must be application/json");
      }
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch (err) {
        if (err instanceof TooLarge) {
          // Reply, then drop the connection without reading the rest.
          res.setHeader("connection", "close");
          res.once("finish", () => req.destroy());
          return this.refuse(res, 413, "body_too_large", "Request body is too large");
        }
        return this.refuse(res, 400, "bad_body", "Could not read the request body");
      }
      send(res, await this.o.handler.handle({ authorization: req.headers.authorization, body }));
    } catch (err) {
      this.logger.error("mcp listener failed", { error: err });
      send(res, { status: 500, body: rpcError(null, RpcCode.INTERNAL_ERROR, "Internal error") });
    }
  }
}
