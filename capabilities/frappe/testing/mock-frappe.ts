// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for a Frappe web server (gunicorn) that implements only GET /api/method/ping, and
// like a multi-tenant bench it picks the site from X-Frappe-Site-Name (frappe/app.py).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type MockMode =
  | "ok"
  | "http500"
  | "hang"
  | "malformed"
  | "huge"
  | "huge-declared"
  | "wrong-body"
  | "redirect"
  | "down";

/** Marker placed in every hostile body; no event, command result or health text may contain it. */
export const REMOTE_MARKER = "REMOTE-TEXT-MUST-NOT-LEAK";

export interface MockRequest {
  path: string;
  /** X-Frappe-Site-Name, as the site selector Frappe uses. */
  site: string | undefined;
  accept: string | undefined;
}

export interface MockFrappe {
  port: number;
  url: string;
  requests: MockRequest[];
  setMode(next: MockMode): void;
  /** Restricts which sites exist (others get Frappe's 404); null serves every site. */
  serveOnly(sites: string[] | null): void;
  /** Requests abandoned by the client before the mock answered. */
  readonly closedEarly: number;
  close(): Promise<void>;
}

export async function startMockFrappe(): Promise<MockFrappe> {
  let mode: MockMode = "ok";
  /** When set, only these sites exist; any other site gets Frappe's 404. */
  let served: string[] | null = null;
  const requests: MockRequest[] = [];
  let closedEarly = 0;

  const server = createServer((req, res) => {
    const site = req.headers["x-frappe-site-name"];
    requests.push({
      path: req.url ?? "",
      site: typeof site === "string" ? site : undefined,
      accept: req.headers.accept,
    });
    // Counts requests the client gave up on (timeout or abort) before we answered.
    res.on("close", () => {
      if (!res.writableFinished) closedEarly++;
    });
    if (mode === "down") return void req.socket.destroy();
    if (mode === "hang") return;
    if (mode === "redirect") {
      res.writeHead(302, { location: "http://127.0.0.1:1/api/method/ping" });
      return void res.end();
    }
    if (req.url !== "/api/method/ping") {
      res.writeHead(404, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ exc_type: "NotFound" }));
    }
    if (served && !(typeof site === "string" && served.includes(site))) {
      res.writeHead(404, { "content-type": "text/html" });
      return void res.end(`<html>${REMOTE_MARKER} site not found</html>`);
    }
    switch (mode) {
      case "http500":
        res.writeHead(500, { "content-type": "text/html" });
        return void res.end(`<html>Traceback ${REMOTE_MARKER}</html>`);
      case "malformed":
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(`{"message": ${REMOTE_MARKER}`);
      case "wrong-body":
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ message: REMOTE_MARKER }));
      case "huge": {
        // No content-length: chunked, far over the reader's cap.
        res.writeHead(200, { "content-type": "application/json" });
        res.write(`{"message":"pong","pad":"${REMOTE_MARKER}`);
        for (let i = 0; i < 64; i++) res.write("x".repeat(4096));
        return void res.end('"}');
      }
      case "huge-declared": {
        const body = JSON.stringify({ message: "pong", pad: "y".repeat(100_000) });
        res.writeHead(200, { "content-type": "application/json", "content-length": body.length });
        return void res.end(body);
      }
      default:
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ message: "pong" }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    setMode(next: MockMode) {
      mode = next;
    },
    serveOnly(sites: string[] | null) {
      served = sites;
    },
    get closedEarly() {
      return closedEarly;
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections(); // hung requests would keep close() waiting
      }),
  };
}
