// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { WS_PROTOCOL } from "./security";
import type { CoreServices, CaptureKind } from "./services";

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_WAV = 32 * 1024 * 1024;
const IDLE_MS = 30_000;
const LIFETIME_MS = 300_000;

/** A separate, session-authenticated, single-use transport; never joins the agent event bus. */
export class MultimodalCaptureSocket {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WAV,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly services: CoreServices) {}

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
  }

  close(): void {
    for (const ws of this.sockets) ws.terminate();
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    this.sockets.add(ws);
    let state: "hello" | "approving" | "ready" | "processing" | "closed" = "hello";
    let kind: CaptureKind | undefined;
    let command: string | undefined;
    let bytes: Buffer | undefined;
    const controller = new AbortController();
    const stop = () => {
      if (state === "closed") return;
      state = "closed";
      controller.abort();
      if (command) {
        const pending = this.services.permissions
          .pendingConfirmations()
          .find((c) => c.command === command);
        if (pending) this.services.permissions.resolveConfirmation(pending.id, false);
      }
      bytes?.fill(0);
      bytes = undefined;
      clearTimeout(idle);
      clearTimeout(lifetime);
      clearInterval(revocation);
      this.sockets.delete(ws);
    };
    const fail = (reason: string) => {
      if (state === "closed") return;
      ws.send(JSON.stringify({ type: "error", error: reason }), () => ws.close(1008));
      stop();
    };
    const idle = setTimeout(() => fail("Capture timed out"), IDLE_MS);
    const lifetime = setTimeout(() => fail("Capture lifetime expired"), LIFETIME_MS);
    idle.unref();
    lifetime.unref();
    const revocation = setInterval(() => {
      if (
        kind &&
        (this.services.permissions.isKillSwitchEngaged() ||
          !this.services.multimodal?.captureAllowed(kind))
      ) {
        fail("Capture permission revoked or emergency stop engaged");
      }
    }, 200);
    revocation.unref();
    ws.once("close", stop);
    ws.once("error", stop);
    ws.on("message", (raw, isBinary) => {
      const size = Array.isArray(raw)
        ? raw.reduce((total, fragment) => total + fragment.byteLength, 0)
        : raw.byteLength;
      if (state === "hello") {
        if (isBinary || size > 256) {
          this.wipe(raw);
          return fail("Invalid capture request");
        }
        let hello: unknown;
        try {
          hello = JSON.parse(raw.toString());
        } catch {
          this.wipe(raw);
          return fail("Invalid capture request");
        }
        if (
          !hello ||
          typeof hello !== "object" ||
          Array.isArray(hello) ||
          !("kind" in hello) ||
          (hello.kind !== "microphone" && hello.kind !== "screen") ||
          !("agent_id" in hello) ||
          hello.agent_id !== "user" ||
          Object.keys(hello).some((key) => key !== "kind" && key !== "agent_id")
        ) {
          this.wipe(raw);
          return fail("Only user-owned microphone or screen capture is allowed");
        }
        kind = hello.kind;
        const service = this.services.multimodal;
        if (!service) return fail("Local capture unavailable");
        state = "approving";
        command = `capture.${kind}.${crypto.randomUUID()}`;
        void service
          .authorizeCapture(kind, command, controller.signal)
          .then(() => {
            if (
              controller.signal.aborted ||
              state !== "approving" ||
              !service.captureAllowed(kind!)
            )
              return fail("Capture permission revoked");
            state = "ready";
            idle.refresh();
            ws.send(JSON.stringify({ type: "ready" }));
          })
          .catch(() => fail("Capture not authorized or local model unavailable"));
        return;
      }
      if (state !== "ready" || !isBinary || !kind) {
        this.wipe(raw);
        return fail("Only one approved binary capture is accepted");
      }
      const limit = kind === "screen" ? MAX_IMAGE : MAX_WAV;
      if (size === 0 || size > limit) {
        this.wipe(raw);
        return fail("Capture exceeds allowed size");
      }
      state = "processing";
      clearTimeout(idle);
      bytes = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw);
      if (bytes !== raw) this.wipe(raw);
      const input = bytes;
      const service = this.services.multimodal;
      void service!
        .processCapture(kind, input, controller.signal)
        .then((result) => {
          if (
            state !== "processing" ||
            controller.signal.aborted ||
            !service!.captureAllowed(kind!)
          )
            return fail("Capture permission revoked");
          ws.send(JSON.stringify({ type: "result", ...result }), () => {
            ws.close(1000);
            stop();
          });
        })
        .catch(() => fail("Local capture processing failed"));
    });
  }

  private wipe(raw: Buffer | ArrayBuffer | Buffer[]): void {
    if (Array.isArray(raw)) for (const fragment of raw) fragment.fill(0);
    else if (Buffer.isBuffer(raw)) raw.fill(0);
    else new Uint8Array(raw).fill(0);
  }
}
