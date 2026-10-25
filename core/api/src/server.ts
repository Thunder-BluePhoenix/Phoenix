// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  ATTACHMENT_BODY_MAX_BYTES,
  BROWSER_RELAY_BODY_MAX_BYTES,
  BROWSER_RELAY_RESULT_PATH,
  decodeParams,
  matchRoute,
  readJsonBody,
  sendError,
  sendJson,
  type Route,
} from "./http";
import { buildRoutes } from "./routes";
import { isAllowedHost, isAllowedOrigin, requestToken, tokensEqual } from "./security";
import { DICTATION_STREAM_PATH, DictationStreamSocket } from "./dictation-socket";
import { VOICE_STREAM_PATH, VoiceStreamSocket } from "./voice-socket";
import { NOTETAKER_STREAM_PATH, NotetakerStreamSocket } from "./notetaker-socket";
import { MultimodalCaptureSocket } from "./multimodal-capture";
import { StaticSite } from "./static";
import type { CoreServices } from "./services";
import { WebSocketHub } from "./websocket";

export interface ApiServerOptions {
  services: CoreServices;
  /** Session token required on every non-public request. */
  token: string;
  /** Built web app to serve at "/" (optional). */
  webRoot?: string;
}

/** Phoenix Core HTTP + WebSocket API (Phase 06). */
export class ApiServer {
  readonly server: Server;
  readonly hub: WebSocketHub;
  readonly capture: MultimodalCaptureSocket;
  readonly dictation: DictationStreamSocket;
  readonly voice: VoiceStreamSocket;
  readonly notetaker: NotetakerStreamSocket;
  private readonly routes: Route[];
  private readonly s: CoreServices;
  private readonly token: string;
  private readonly site: StaticSite | null;

  constructor(options: ApiServerOptions) {
    this.s = options.services;
    this.token = options.token;
    this.site = options.webRoot ? new StaticSite(options.webRoot, options.token) : null;
    this.routes = buildRoutes(this.s);
    this.hub = new WebSocketHub(this.s);
    this.capture = new MultimodalCaptureSocket(this.s);
    this.dictation = new DictationStreamSocket(this.s);
    this.voice = new VoiceStreamSocket(this.s);
    this.notetaker = new NotetakerStreamSocket(this.s);
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
    await this.hub.close();
    this.capture.close();
    this.dictation.close();
    this.voice.close();
    this.notetaker.close();
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
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/api/") && (req.method === "GET" || req.method === "HEAD")) {
        if (this.site?.available()) return this.site.serve(url.pathname, res);
        throw new PhoenixError(
          ErrorCode.RESOURCE_NOT_FOUND,
          "Web app not built (run: pnpm --filter @phoenix/web build)",
        );
      }
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

      const result = await route.handler({
        req,
        res,
        url,
        params: decodeParams(params),
        // Only POST /api/attachments and POST /api/browser/relay/:id/result may read more than the default; the route (already
        // authenticated above) asks for it, nobody else gets it.
        body: (maxBytes) =>
          readJsonBody(
            req,
            maxBytes !== undefined &&
              req.method === "POST" &&
              ((url.pathname === "/api/attachments" && maxBytes <= ATTACHMENT_BODY_MAX_BYTES) ||
                (BROWSER_RELAY_RESULT_PATH.test(url.pathname) &&
                  maxBytes <= BROWSER_RELAY_BODY_MAX_BYTES))
              ? maxBytes
              : undefined,
          ),
      });
      sendJson(
        res,
        res.statusCode === 202 || res.statusCode === 201 ? res.statusCode : 200,
        result,
      );
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
    if (url.pathname === DICTATION_STREAM_PATH) {
      const refusal = this.dictation.check(req, url, () => this.authenticate(req));
      if (refusal) return reject(refusal.status, refusal.message);
      this.dictation.handleUpgrade(req, socket, head, url.searchParams.get("session")!);
      return;
    }
    if (url.pathname === VOICE_STREAM_PATH) {
      const refusal = this.voice.check(req, url, () => this.authenticate(req));
      if (refusal) return reject(refusal.status, refusal.message);
      this.voice.handleUpgrade(req, socket, head, url.searchParams.get("session")!);
      return;
    }
    if (url.pathname === NOTETAKER_STREAM_PATH) {
      const refusal = this.notetaker.check(req, url, () => this.authenticate(req));
      if (refusal) return reject(refusal.status, refusal.message);
      this.notetaker.handleUpgrade(req, socket, head, url.searchParams.get("session")!);
      return;
    }
    if (url.pathname !== "/api/ws" && url.pathname !== "/api/multimodal/capture")
      return reject(404, "Not Found");
    if (url.pathname === "/api/multimodal/capture") {
      const host = req.headers.host;
      const origin = req.headers.origin;
      if (
        !host ||
        !isAllowedHost(host, false) ||
        !origin ||
        origin !== `http://${host}` ||
        url.search ||
        url.hash ||
        req.headers.cookie
      )
        return reject(403, "Forbidden");
      try {
        this.authenticate(req);
      } catch {
        return reject(401, "Unauthorized");
      }
      this.capture.handleUpgrade(req, socket, head);
      return;
    }
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
