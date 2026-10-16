// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The audio WebSocket of a notetaker session (protocol: see notetaker-routes.ts). Same rules as the
// dictation stream - loopback Host, exact same-origin Origin, token only in the sub-protocol, no
// cookie - and additionally single use per session and a hard frame size (1 MiB).
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { UpgradeRefusal } from "./dictation-socket";
import type { NotetakerStreamHandle } from "./notetaker-routes";
import { isAllowedHost, WS_PROTOCOL } from "./security";
import type { CoreServices } from "./services";

export const NOTETAKER_STREAM_PATH = "/api/notetaker/stream";
const MAX_FRAME = 1024 * 1024;
const SESSION = /^ntk_[0-9a-f]{32}$/u;

export class NotetakerStreamSocket {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly services: CoreServices) {}

  /**
   * Decides whether an upgrade may proceed. Order matters: origin and host first, then the token
   * (`authenticate` throws), then the session, so an unauthenticated caller learns nothing about
   * which sessions exist.
   */
  check(req: IncomingMessage, url: URL, authenticate: () => void): UpgradeRefusal | null {
    const host = req.headers.host;
    const origin = req.headers.origin;
    const params = [...url.searchParams.keys()];
    if (
      !host ||
      !isAllowedHost(host, false) ||
      !origin ||
      origin !== `http://${host}` ||
      url.hash ||
      req.headers.cookie ||
      params.length !== 1 ||
      params[0] !== "session" ||
      url.searchParams.getAll("session").length !== 1
    )
      return { status: 403, message: "Forbidden" };
    try {
      authenticate();
    } catch {
      return { status: 401, message: "Unauthorized" };
    }
    const id = url.searchParams.get("session") ?? "";
    if (!SESSION.test(id)) return { status: 400, message: "Bad Request" };
    if (!this.services.notetaker) return { status: 503, message: "Service Unavailable" };
    if (!this.services.notetaker.streamAvailable(id)) return { status: 409, message: "Conflict" };
    return null;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, id: string): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, id));
  }

  close(): void {
    for (const ws of this.sockets) ws.terminate();
    this.wss.close();
  }

  private onConnection(ws: WebSocket, id: string): void {
    this.sockets.add(ws);
    ws.once("close", () => this.sockets.delete(ws));
    ws.on("error", () => ws.terminate());
    const send = (message: Record<string, unknown>, then?: () => void) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message), then);
    };
    let stream: NotetakerStreamHandle;
    // While a frame is being handled, a session that ends because of that frame reports the
    // refusal (below) instead of a second, less specific "ended" message.
    let inFrame = false;
    try {
      stream = this.services.notetaker!.openStream(id, (reason) => {
        if (!inFrame) send({ type: "ended", reason }, () => ws.close(1000));
      });
    } catch {
      send({ type: "error", error: "This recording cannot take audio" }, () => ws.close(1008));
      return;
    }
    ws.once("close", () => stream.closed());
    send({ type: "ready" });
    ws.on("message", (raw, isBinary) => {
      const buffer = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as Buffer);
      const wipe = () => {
        if (Array.isArray(raw)) for (const part of raw) part.fill(0);
        else if (Buffer.isBuffer(raw)) raw.fill(0);
        buffer.fill(0);
      };
      inFrame = true;
      try {
        if (isBinary) {
          stream.push(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
          return;
        }
        if (buffer.byteLength <= 32 && buffer.toString("utf8") === '{"type":"end"}') {
          stream.end();
          send({ type: "audio_ended" });
          return;
        }
        send({ type: "error", error: "Only PCM frames and an end message are accepted" }, () =>
          ws.close(1008),
        );
        stream.closed();
      } catch (err) {
        // A frame arriving after `end` is dropped by the session; anything else already ended it.
        const message = err instanceof Error ? err.message : "Frame refused";
        send({ type: "error", error: message.slice(0, 200) }, () => ws.close(1008));
      } finally {
        inFrame = false;
        wipe();
      }
    });
  }
}
