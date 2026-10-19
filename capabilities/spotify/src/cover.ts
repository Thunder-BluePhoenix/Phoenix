// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cover art. The web UI's Content-Security-Policy is `img-src 'self' data:`, so a remote image
// URL can never be shown, and Phoenix does not loosen it. Instead the capability fetches the
// image itself, from Spotify's own CDN only, checks it really is a small JPEG/PNG/WebP by its
// first bytes, and hands the UI an inline `data:` image.
import { httpsUrl } from "@phoenix/service-kit";

export const MAX_COVER_BYTES = 400 * 1024;
export const COVER_TIMEOUT_MS = 5_000;
const CDN_DOMAIN = "scdn.co";

/** True for https URLs on scdn.co or one of its subdomains (i.scdn.co, mosaic.scdn.co). */
export function isSpotifyCdn(url: string): boolean {
  const checked = httpsUrl(url);
  if (!checked) return false;
  const { hostname, port } = new URL(checked);
  return port === "" && (hostname === CDN_DOMAIN || hostname.endsWith(`.${CDN_DOMAIN}`));
}

function imageType(bytes: Uint8Array): "jpeg" | "png" | "webp" | undefined {
  const at = (i: number) => bytes[i] ?? 0;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  const riff = [0x52, 0x49, 0x46, 0x46].every((b, i) => at(i) === b);
  const webp = [0x57, 0x45, 0x42, 0x50].every((b, i) => at(8 + i) === b);
  return riff && webp ? "webp" : undefined;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | undefined> {
  if (Number(res.headers.get("content-length") ?? 0) > max || !res.body) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Fetches a cover; undefined for anything that is not a small image on Spotify's CDN. Never throws. */
export async function fetchCover(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!isSpotifyCdn(url)) return undefined;
  const timeout = AbortSignal.timeout(COVER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "image/jpeg,image/png,image/webp" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    const bytes = await readCapped(res, MAX_COVER_BYTES);
    const type = bytes && imageType(bytes);
    return bytes && type
      ? `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`
      : undefined;
  } catch {
    return undefined;
  }
}
