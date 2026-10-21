// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Phone Link LAN listener (Phase 71). A SEPARATE HTTPS server from the loopback API: its own
// socket, its own tiny route table that holds ONLY /phone/v1/* routes, no static files, no CORS, no
// WebSocket upgrade, no session token. Nothing in `buildRoutes` is reachable through it, and a
// session token is meaningless to it. Requests are authenticated by `PhoneDeviceApi.authenticate`
// (a per-request device-key signature); the pairing routes are the only unauthenticated ones and
// are guarded by the single-use pairing code inside the service.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import type { Logger } from "@phoenix/logging";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { BodyTooLargeError, sendError, sendJson } from "./http";
import { PhoneThrottledError, type PhoneDeviceApi, type PhoneIdentity } from "./phone-routes";

/** Every legitimate phone body (a decision, a pairing request) is far below this. */
export const PHONE_BODY_MAX_BYTES = 16 * 1024;
export const PHONE_MAX_CONNECTIONS = 32;
/** One peer cannot hold more than this many sockets, so a single host cannot starve the rest. */
export const PHONE_MAX_CONNECTIONS_PER_ADDRESS = 4;
/** A socket that has not finished the TLS handshake by now is dropped (a silent client holds nothing). */
export const PHONE_HANDSHAKE_TIMEOUT_MS = 8_000;
export const PHONE_API_PREFIX = "/phone/v1";

export interface PhoneTlsIdentity {
  key: string;
  cert: string;
}

export interface PhoneListenerOptions {
  device: PhoneDeviceApi;
  tls: PhoneTlsIdentity;
  /** The LAN address the socket is bound to; the only Host name (besides `address:port`) accepted. */
  address: string;
  logger: Logger;
  /** Tests shorten these; production uses the constants above. */
  handshakeTimeoutMs?: number;
  maxConnectionsPerAddress?: number;
}

interface PhoneRequest {
  params: Record<string, string>;
  body: Buffer;
  device: PhoneIdentity | undefined;
  remote: string | undefined;
}

interface PhoneRoute {
  /** Log label: never the path, which can hold a pairing id. */
  name: string;
  method: "GET" | "POST";
  pattern: RegExp;
  signed: boolean;
  handler: (request: PhoneRequest) => unknown;
}

function parseJson(body: Buffer): unknown {
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Body is not valid JSON");
  }
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  if (Number(req.headers["content-length"] ?? 0) > PHONE_BODY_MAX_BYTES) {
    reject(new BodyTooLargeError(PHONE_BODY_MAX_BYTES));
    return promise;
  }
  let size = 0;
  let tooLarge = false;
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > PHONE_BODY_MAX_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      req.pause();
      reject(new BodyTooLargeError(PHONE_BODY_MAX_BYTES));
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!tooLarge) resolve(Buffer.concat(chunks));
  });
  req.on("error", reject);
  return promise;
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
};

export class PhoneListener {
  private readonly server: Server;
  /** Every raw socket, from `connection` on: a half-open TLS socket is not an HTTP connection yet. */
  private readonly sockets = new Set<Socket>();
  private readonly perAddress = new Map<string, number>();
  private readonly routes: PhoneRoute[];
  private readonly hosts = new Set<string>();
  private readonly device: PhoneDeviceApi;
  private readonly logger: Logger;
  private readonly address: string;

  constructor(options: PhoneListenerOptions) {
    this.device = options.device;
    this.logger = options.logger.child("phone-link");
    this.address = options.address;
    this.routes = [
      {
        name: "pair",
        method: "POST",
        pattern: /^\/phone\/v1\/pair$/,
        signed: false,
        handler: (r) => this.device.pair(parseJson(r.body), r.remote),
      },
      {
        name: "pair.status",
        method: "GET",
        pattern: /^\/phone\/v1\/pair\/([A-Za-z0-9_]{1,64})$/,
        signed: false,
        handler: (r) => this.device.pairProgress(r.params.id!, r.remote),
      },
      {
        name: "whoami",
        method: "GET",
        pattern: /^\/phone\/v1\/whoami$/,
        signed: true,
        handler: (r) => this.device.whoami(r.device!),
      },
      {
        name: "approvals",
        method: "GET",
        pattern: /^\/phone\/v1\/approvals$/,
        signed: true,
        handler: (r) => this.device.approvals(r.device!),
      },
      {
        name: "approvals.decision",
        method: "POST",
        pattern: /^\/phone\/v1\/approvals\/decision$/,
        signed: true,
        handler: (r) => this.device.decide(r.device!, parseJson(r.body)),
      },
    ];
    this.server = createServer(
      {
        key: options.tls.key,
        cert: options.tls.cert,
        minVersion: "TLSv1.2",
        handshakeTimeout: options.handshakeTimeoutMs ?? PHONE_HANDSHAKE_TIMEOUT_MS,
      },
      (req, res) => void this.onRequest(req, res),
    );
    this.server.maxConnections = PHONE_MAX_CONNECTIONS;
    const perAddressCap = options.maxConnectionsPerAddress ?? PHONE_MAX_CONNECTIONS_PER_ADDRESS;
    this.server.on("connection", (socket: Socket) => {
      const peer = socket.remoteAddress ?? "unknown";
      const open = this.perAddress.get(peer) ?? 0;
      if (open >= perAddressCap) {
        socket.destroy();
        return;
      }
      this.perAddress.set(peer, open + 1);
      this.sockets.add(socket);
      socket.once("close", () => {
        this.sockets.delete(socket);
        const left = (this.perAddress.get(peer) ?? 1) - 1;
        if (left <= 0) this.perAddress.delete(peer);
        else this.perAddress.set(peer, left);
      });
    });
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 15_000;
    this.server.keepAliveTimeout = 5_000;
    // A failed handshake (a scanner, a phone that refused our certificate) is normal on a LAN.
    this.server.on("tlsClientError", (_err, socket) => socket.destroy());
    // No WebSocket or CONNECT on this socket.
    this.server.on("upgrade", (_req, socket) => socket.destroy());
    this.server.on("connect", (_req, socket) => socket.destroy());
  }

  async listen(port: number): Promise<AddressInfo> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.server.once("error", reject);
    this.server.listen(port, this.address, () => resolve());
    await promise;
    this.server.off("error", reject);
    const info = this.server.address() as AddressInfo;
    this.hosts.add(this.address);
    this.hosts.add(`${this.address}:${info.port}`);
    return info;
  }

  /** Closes the socket and drops every open connection. Safe to call twice. */
  async close(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.server.close(() => resolve());
    this.server.closeAllConnections();
    for (const socket of this.sockets) socket.destroy();
    await promise;
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let routeName = "unmatched";
    let deviceId: string | undefined;
    try {
      const host = header(req, "host")?.toLowerCase();
      if (host === undefined || !this.hosts.has(host)) {
        throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, "Host not allowed");
      }
      // Phones are native clients. A browser always sends Origin on cross-site and CORS requests;
      // no browser client is supported in this build, so any Origin is refused outright.
      if (req.headers.origin !== undefined) {
        throw new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          "Browser origins are not allowed",
        );
      }
      // Matched on the path exactly as sent: no URL normalisation, so `/phone/v1/pair/../approvals`
      // is not the same route as `/phone/v1/approvals` (the signature covers the raw target).
      const pathname = (req.url ?? "/").split("?")[0]!;
      const method = req.method ?? "GET";
      let matched: { route: PhoneRoute; params: Record<string, string> } | undefined;
      for (const route of this.routes) {
        const m = route.pattern.exec(pathname);
        if (m && route.method === method) {
          matched = { route, params: m[1] === undefined ? {} : { id: m[1] } };
          break;
        }
      }
      if (!matched) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Not found");
      routeName = matched.route.name;
      if (method === "POST") {
        const type = header(req, "content-type") ?? "";
        if (!type.startsWith("application/json")) {
          req.resume();
          throw new PhoenixError(
            ErrorCode.INVALID_REQUEST,
            "Content-Type must be application/json",
          );
        }
      }
      const body = await readRawBody(req);
      const remote = req.socket.remoteAddress;
      let identity: PhoneIdentity | undefined;
      if (matched.route.signed) {
        identity = this.device.authenticate({
          deviceId: header(req, "x-phoenix-device"),
          timestamp: header(req, "x-phoenix-timestamp"),
          nonce: header(req, "x-phoenix-nonce"),
          signature: header(req, "x-phoenix-signature"),
          method,
          target: req.url ?? "/",
          body,
          remote,
        });
        deviceId = identity.id;
      }
      const result = await matched.route.handler({
        params: matched.params,
        body,
        device: identity,
        remote,
      });
      const status = res.statusCode === 201 ? 201 : 200;
      sendJson(res, status, result);
      this.logger.debug("phone request", { route: routeName, status, device: deviceId });
    } catch (err) {
      if (err instanceof PhoneThrottledError) {
        res.setHeader("retry-after", String(err.retryAfterSeconds));
        sendJson(res, 429, err.toJSON());
      } else {
        if (!(err instanceof PhoenixError)) {
          this.logger.error("Phone listener handler failed", { route: routeName, error: err });
        }
        sendError(res, err);
      }
      this.logger.debug("phone request refused", {
        route: routeName,
        status: res.statusCode,
        device: deviceId,
      });
    }
  }
}
