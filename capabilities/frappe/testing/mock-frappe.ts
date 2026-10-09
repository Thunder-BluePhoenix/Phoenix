// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for a Frappe web server (gunicorn) that implements GET /api/method/ping and the Task
// resource endpoints (GET/POST /api/resource/Task), and like a multi-tenant bench it picks the
// site from X-Frappe-Site-Name (frappe/app.py).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

/**
 * Hostile behaviours of the /api/resource/Task endpoints (the ping has its own MockMode).
 * `drop-after-create` stores the task and then kills the connection: the outcome is unknown to the client.
 */
export type WriteMode =
  | "ok"
  | "redirect"
  | "forbidden"
  | "not-found"
  | "validation"
  | "http500"
  | "malformed"
  | "huge"
  | "huge-declared"
  | "bad-name"
  | "hang"
  | "drop-after-create";

/** A Task document as the mock stores it. */
export interface StoredTask {
  name: string;
  doc: Record<string, unknown>;
}

/** One request to /api/resource/Task, recorded separately from `requests`. */
export interface WriteRequest {
  method: string;
  path: string;
  site: string | undefined;
  authorization: string | undefined;
  /** Parsed JSON body (POST), undefined when there is none or it is not JSON. */
  body: unknown;
}

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
  /** Every request to /api/resource/Task (also present in `requests`, which stays unchanged). */
  writes: WriteRequest[];
  /** The Authorization header of every ping, in order (undefined when it carried none). */
  pingAuthorizations: (string | undefined)[];
  /** Tasks stored by POST /api/resource/Task. */
  tasks: StoredTask[];
  /** The Authorization header value the resource endpoints accept (`token key:secret`). */
  expectedAuth: string;
  setMode(next: MockMode): void;
  /** Hostile mode for the resource endpoints; `only` limits it to one method. */
  setWriteMode(next: WriteMode, only?: "GET" | "POST"): void;
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
  const writes: WriteRequest[] = [];
  const pingAuthorizations: (string | undefined)[] = [];
  const tasks: StoredTask[] = [];
  let expectedAuth = ["token ", "mock", "key", ":", "mock", "secret"].join("");
  let writeMode: WriteMode = "ok";
  let writeModeOnly: "GET" | "POST" | undefined;
  let closedEarly = 0;

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  /** Frappe's `filters` for this mock: a list of [field, "like", "%text%"] triples. */
  const matches = (doc: Record<string, unknown>, filters: unknown): boolean =>
    Array.isArray(filters) &&
    filters.every((f) => {
      if (!Array.isArray(f) || f[1] !== "like" || typeof f[0] !== "string") return false;
      const value = doc[f[0]];
      const needle = String(f[2]).replace(/^%|%$/g, "");
      return typeof value === "string" && value.includes(needle);
    });

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

  async function handleResource(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "", "http://mock");
    const method = req.method ?? "";
    const site = req.headers["x-frappe-site-name"];
    const authorization = req.headers.authorization;
    const raw = method === "POST" ? await readBody(req) : "";
    let body: unknown;
    try {
      body = raw ? (JSON.parse(raw) as unknown) : undefined;
    } catch {
      body = undefined;
    }
    writes.push({
      method,
      path: req.url ?? "",
      site: typeof site === "string" ? site : undefined,
      authorization,
      body,
    });
    if (authorization !== expectedAuth) {
      return json(res, 401, { exc_type: "AuthenticationError", message: REMOTE_MARKER });
    }
    if (served && !(typeof site === "string" && served.includes(site))) {
      res.writeHead(404, { "content-type": "text/html" });
      return void res.end(`<html>${REMOTE_MARKER} site not found</html>`);
    }
    const mode = writeModeOnly && writeModeOnly !== method ? "ok" : writeMode;
    switch (mode) {
      case "redirect":
        // Back to this very server, so a client that follows redirects shows up in `writes`.
        res.writeHead(302, { location: `http://${req.headers.host}/api/resource/Task?followed=1` });
        return void res.end();
      case "forbidden":
        return json(res, 403, { exc_type: "PermissionError", message: REMOTE_MARKER });
      case "not-found":
        return json(res, 404, { exc_type: "DoesNotExistError", message: REMOTE_MARKER });
      case "validation":
        return json(res, 417, { exc_type: "ValidationError", _server_messages: REMOTE_MARKER });
      case "http500":
        res.writeHead(500, { "content-type": "text/html" });
        return void res.end(`<html>Traceback ${REMOTE_MARKER}</html>`);
      case "malformed":
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(`{"data": ${REMOTE_MARKER}`);
      case "huge":
        res.writeHead(200, { "content-type": "application/json" });
        res.write(`{"data":[],"pad":"${REMOTE_MARKER}`);
        for (let i = 0; i < 64; i++) res.write("x".repeat(4096));
        return void res.end('"}');
      case "huge-declared": {
        const text = JSON.stringify({ data: [], pad: "y".repeat(200_000) });
        res.writeHead(200, { "content-type": "application/json", "content-length": text.length });
        return void res.end(text);
      }
      case "bad-name":
        return json(res, 200, { data: method === "GET" ? [{ name: "../x" }] : { name: "a/b" } });
      case "hang":
        return;
      case "ok":
      case "drop-after-create":
        break;
    }
    if (url.pathname !== "/api/resource/Task") return json(res, 404, { exc_type: "NotFound" });
    if (method === "GET") {
      let filters: unknown;
      try {
        filters = JSON.parse(url.searchParams.get("filters") ?? "[]");
      } catch {
        return json(res, 400, { exc_type: "ValidationError" });
      }
      const limit = Number(url.searchParams.get("limit_page_length") ?? 20);
      const data = tasks
        .filter((t) => matches(t.doc, filters))
        .slice(0, limit)
        .map((t) => ({ name: t.name }));
      return json(res, 200, { data });
    }
    if (method !== "POST") return json(res, 405, { exc_type: "MethodNotAllowed" });
    if (
      !isPlainObject(body) ||
      body.doctype !== "Task" ||
      typeof body.subject !== "string" ||
      !body.subject
    ) {
      return json(res, 417, { exc_type: "ValidationError", _server_messages: REMOTE_MARKER });
    }
    const name = `TASK-${String(tasks.length + 1).padStart(5, "0")}`;
    tasks.push({ name, doc: { ...body, name } });
    if (mode === "drop-after-create") return void req.socket.destroy();
    return json(res, 200, { data: { ...body, name } });
  }

  const server = createServer((req, res) => {
    const site = req.headers["x-frappe-site-name"];
    requests.push({
      path: req.url ?? "",
      site: typeof site === "string" ? site : undefined,
      accept: req.headers.accept,
    });
    if (req.url?.startsWith("/api/resource/Task")) {
      res.on("close", () => {
        if (!res.writableFinished) closedEarly++;
      });
      return void handleResource(req, res);
    }
    if (req.url === "/api/method/ping") pingAuthorizations.push(req.headers.authorization);
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
    writes,
    pingAuthorizations,
    tasks,
    get expectedAuth() {
      return expectedAuth;
    },
    set expectedAuth(next: string) {
      expectedAuth = next;
    },
    setMode(next: MockMode) {
      mode = next;
    },
    setWriteMode(next: WriteMode, only?: "GET" | "POST") {
      writeMode = next;
      writeModeOnly = only;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
