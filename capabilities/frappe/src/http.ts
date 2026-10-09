// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// HTTP helpers shared by the health poller (index.ts) and the Task writer (tasks.ts).

import { isRecord } from "./guards";

/** A Frappe site name: the directory name under sites/, also the X-Frappe-Site-Name value. */
export const SITE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,148}$/;

/** The origin of an http(s) URL (host_name may omit the scheme, as Frappe's get_url allows). */
export function normalizeOrigin(value: string, assumeHttp = false): string | undefined {
  const text = value.trim();
  if (!text || text.length > 300 || /\s/.test(text)) return undefined;
  const withScheme = assumeHttp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? `http://${text}` : text;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Reads at most `max` bytes; null when the body is larger. */
export async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A short Node error code (ECONNREFUSED, ...) from a fetch failure, if it has one. */
export function errorCode(err: unknown): string | undefined {
  const cause = isRecord(err) ? err.cause : undefined;
  const code = isRecord(cause) ? cause.code : isRecord(err) ? err.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code) ? code : undefined;
}
