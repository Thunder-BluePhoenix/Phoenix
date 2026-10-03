// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export const TOKEN_META = "phoenix-token";

/** Security headers for every page we serve. */
export const PAGE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    // The pet runtime injects <style> elements; React uses inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "),
};

/** Inserts the session token as a <meta> tag so the same-origin web app can call the API. */
export function injectToken(html: string, token: string): string {
  const meta = `<meta name="${TOKEN_META}" content="${token.replace(/[^A-Za-z0-9_-]/g, "")}">`;
  return html.includes("</head>") ? html.replace("</head>", `  ${meta}\n  </head>`) : meta + html;
}

/**
 * Serves the built web app. Hashed assets are cached; index.html is never
 * cached because it carries the per-start session token. Unknown paths fall
 * back to index.html (single-page app).
 */
export class StaticSite {
  private readonly root: string;

  constructor(
    root: string,
    private readonly token: string,
  ) {
    this.root = resolve(root);
  }

  available(): boolean {
    return existsSync(join(this.root, "index.html"));
  }

  serve(pathname: string, res: ServerResponse): void {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = "/";
    }
    const candidate = resolve(this.root, "." + normalize("/" + decoded));
    const inside = candidate === this.root || candidate.startsWith(this.root + sep);
    const isFile = inside && existsSync(candidate) && statSync(candidate).isFile();
    const file = isFile ? candidate : join(this.root, "index.html");
    const isIndex = file === join(this.root, "index.html");

    const headers: Record<string, string> = {
      ...PAGE_HEADERS,
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": isIndex ? "no-store" : "public, max-age=31536000, immutable",
    };
    const body = isIndex ? injectToken(readFileSync(file, "utf8"), this.token) : readFileSync(file);
    res.writeHead(200, headers);
    res.end(body);
  }
}
