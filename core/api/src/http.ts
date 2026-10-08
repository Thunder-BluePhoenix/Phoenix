// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage, ServerResponse } from "node:http";
import { ERROR_HTTP_STATUS, ErrorCode, PhoenixError } from "@phoenix/protocol";

export const MAX_BODY_BYTES = 256 * 1024;

/** Thrown when a body exceeds MAX_BODY_BYTES; answered with 413 and the connection closed. */
export class BodyTooLargeError extends PhoenixError {
  constructor() {
    super(ErrorCode.INVALID_REQUEST, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
  }
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: () => Promise<unknown>;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** Routes are authenticated unless marked public. */
  public?: boolean;
}

/** Compiles "/api/capabilities/:id/enable" into a matcher. */
export function route(method: string, path: string, handler: Handler, isPublic = false): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:([a-z_]+)/gi, (_m, k: string) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$",
  );
  return { method, pattern, keys, handler, ...(isPublic ? { public: true } : {}) };
}
/** A path segment with its %-escapes decoded; a malformed escape (`%zz`) is a bad request, not a crash. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Malformed %-escape in the URL path");
  }
}

/**
 * Finds the route for a request. `params` are the raw path segments, still %-encoded: decoding
 * can fail, and that must only be reported to a caller who has passed authentication
 * (see `decodeParams`).
 */
export function matchRoute(routes: readonly Route[], method: string, pathname: string) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = m[i + 1]!));
    return { route: r, params };
  }
  return { route: undefined, params: {}, pathMatched };
}

export function decodeParams(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, decodeSegment(v)]));
}

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("application/json")) {
      reject(new PhoenixError(ErrorCode.INVALID_REQUEST, "Content-Type must be application/json"));
      req.resume();
      return;
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
      reject(new BodyTooLargeError());
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        req.pause();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new PhoenixError(ErrorCode.INVALID_REQUEST, "Body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export function sendError(res: ServerResponse, error: unknown): void {
  const e = error instanceof PhoenixError ? error : new PhoenixError(ErrorCode.INTERNAL_ERROR);
  if (error instanceof BodyTooLargeError) {
    // Do not read the rest of the body: reply, then drop the connection.
    res.setHeader("connection", "close");
    res.once("finish", () => res.req.destroy());
    sendJson(res, 413, e.toJSON());
    return;
  }
  sendJson(res, ERROR_HTTP_STATUS[e.code], e.toJSON());
}

/** Validates that `value` is a plain object; returns it typed. */
export function expectObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function expectBoolean(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, `"${key}" must be a boolean`);
  }
  return v;
}

export function intParam(url: URL, key: string, fallback?: number): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, `"${key}" must be a non-negative integer`);
  }
  return n;
}
