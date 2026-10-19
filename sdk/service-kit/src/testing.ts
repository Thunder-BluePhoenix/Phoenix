// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

export interface MockReply {
  status?: number;
  /** Serialised as JSON unless it is a string, which is sent as is. */
  body?: unknown;
  headers?: Record<string, string>;
}

export type MockHandler = (req: RecordedRequest) => MockReply | undefined;

export interface MockService {
  /** Base URL on 127.0.0.1, e.g. http://127.0.0.1:41234 */
  url: string;
  requests: RecordedRequest[];
  /** Replaces the handler (for example to flip a deployment from building to ready). */
  respond(handler: MockHandler): void;
  close(): Promise<void>;
}

/**
 * A local HTTP server standing in for a remote service. Tests write its responses from the
 * service's documented shapes, then point the capability's `base_url` at `url`.
 * Unhandled requests get 404, so a capability that calls something unexpected fails loudly.
 */
export async function startMockService(handler: MockHandler): Promise<MockService> {
  let current = handler;
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      const reply = current(recorded) ?? { status: 404, body: { error: "not mocked" } };
      const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? null);
      res.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
      res.end(body);
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respond: (next) => {
      current = next;
    },
    close: async () => {
      server.closeAllConnections();
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    },
  };
}
