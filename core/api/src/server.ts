// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { matchRoute, readJsonBody, sendError, sendJson, type Route } from "./http";
import { buildRoutes } from "./routes";
import { isAllowedHost, isAllowedOrigin, requestToken, tokensEqual } from "./security";
import type { CoreServices } from "./services";
import { WebSocketHub } from "./websocket";

export interface ApiServerOptions {
  services: CoreServices;
  /** Session token required on every non-public request. */
  token: string;
}

/** Phoenix Core HTTP + WebSocket API (Phase 06). */
export class ApiServer {
  readonly server: Server;
  readonly hub: WebSocketHub;
  private readonly routes: Route[];
  private readonly s: CoreServices;
  private readonly token: string;

  constructor(options: ApiServerOptions) {
    this.s = options.services;
    this.token = options.token;
    this.routes = buildRoutes(this.s);
    this.hub = new WebSocketHub(this.s);
    this.server = createServer((req, res) => void this.onRequest(req, res));
    this.server.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));
  }

  async listen(port: number, host: string): Promise<AddressInfo> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => resolve());
    });
    return this.server.address() as AddressInfo;
  }

  async close(): Promise<void> {
    this.hub.close();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { config, logger } = this.s;
    try {
      if (!isAllowedHost(req.headers.host, config.allowRemote)) {
        throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Host not allowed");
      }
      const origin = req.headers.origin;
      if (!isAllowedOrigin(origin, req.headers.host, config.allowedOrigins)) {
        throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Origin not allowed");
      }
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const { route, params, pathMatched } = matchRoute(
        this.routes,
        req.method ?? "GET",
        url.pathname,
      );
      if (!route) {
        if (pathMatched) {
          sendJson(res, 405, {
            code: ErrorCode.INVALID_REQUEST,
            message: "Method not allowed",
            details: [],
          });
          return;
        }
        throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Not found");
      }
      if (!route.public) this.authenticate(req);

      const result = await route.handler({ req, res, url, params, body: () => readJsonBody(req) });
      sendJson(res, res.statusCode === 202 ? 202 : 200, result);
    } catch (err) {
      if (!(err instanceof PhoenixError))
        logger.error("API handler failed", { path: req.url, error: err });
      sendError(res, err);
    }
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const reject = (status: number, message: string) => {
      socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ws") return reject(404, "Not Found");
    if (!isAllowedHost(req.headers.host, this.s.config.allowRemote))
      return reject(403, "Forbidden");
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, this.s.config.allowedOrigins)) {
      return reject(403, "Forbidden");
    }
    try {
      this.authenticate(req);
    } catch {
      return reject(401, "Unauthorized");
    }
    this.hub.handleUpgrade(req, socket, head);
  }

  private authenticate(req: IncomingMessage): void {
    const token = requestToken(req);
    if (!token || !tokensEqual(token, this.token)) {
      throw new PhoenixError(ErrorCode.UNAUTHENTICATED);
    }
  }
}
