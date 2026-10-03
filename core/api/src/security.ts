// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const WS_PROTOCOL = "phoenix.v1";
export const WS_TOKEN_PREFIX = "phoenix.token.";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Extracts the session token from `Authorization: Bearer …` or the WebSocket subprotocol list. */
export function requestToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const protocols = req.headers["sec-websocket-protocol"];
  if (protocols) {
    for (const p of protocols.split(",").map((s) => s.trim())) {
      if (p.startsWith(WS_TOKEN_PREFIX)) return p.slice(WS_TOKEN_PREFIX.length);
    }
  }
  return undefined;
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Rejects requests whose Host header is not a loopback name, which defeats
 * DNS-rebinding attacks from web pages (ADR-0015).
 */
export function isAllowedHost(hostHeader: string | undefined, allowRemote: boolean): boolean {
  if (allowRemote) return true;
  if (!hostHeader) return false;
  const host = hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : hostHeader.split(":")[0]!;
  return LOCAL_HOSTNAMES.has(host.toLowerCase());
}

/** Requests without an Origin (CLI tools) are allowed; browsers must be same-origin or listed. */
export function isAllowedOrigin(
  origin: string | undefined,
  hostHeader: string | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === hostHeader;
  } catch {
    return false;
  }
}
