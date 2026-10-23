// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Cover art. Same limits and same UI path as the Spotify capability: the web UI's CSP is
// `img-src 'self' data:`, so the capability hands the UI an inline `data:` image that it has
// checked itself. Music exposes artwork only as raw picture data, so the fixed COVER_SCRIPT asks
// for the current track's first artwork and `osascript` prints it as a `«data tdta<hex>»` literal.
// Everything that comes back is untrusted bytes: size-capped, then accepted only when the first
// bytes say PNG or JPEG (SVG, HTML, TIFF, WebP and garbage are all refused). No temp file, no
// input in the script, and every failure (error, timeout, oversize, wrong type) means "no cover".
import { PlayerError } from "./errors";
import type { OsaRunner } from "./osascript";
import { COVER_SCRIPT } from "./scripts";

/** The same cap as the Spotify cover. */
export const MAX_COVER_BYTES = 400 * 1024;
export const COVER_TIMEOUT_MS = 5_000;

/** `osascript` prints data as hex (two characters per byte) inside a short `«data tdta…»` wrapper. */
export const MAX_COVER_OUTPUT_BYTES = MAX_COVER_BYTES * 2 + 64;
const DATA_LITERAL = /^«data [A-Za-z0-9]{4}((?:[0-9A-Fa-f]{2})+)»$/u;

export type CoverType = "jpeg" | "png";

/** The real image type from the first bytes; only PNG and JPEG are accepted. */
export function imageType(bytes: Uint8Array): CoverType | undefined {
  const at = (i: number) => bytes[i] ?? 0;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b);
  return png ? "png" : undefined;
}

/** The inline image for COVER_SCRIPT's output, or undefined when it is not a small PNG/JPEG. */
export function parseCover(output: string): string | undefined {
  if (output.length > MAX_COVER_OUTPUT_BYTES) return undefined;
  const hex = DATA_LITERAL.exec(output)?.[1];
  if (hex === undefined || hex.length / 2 > MAX_COVER_BYTES) return undefined;
  const bytes = Buffer.from(hex, "hex");
  const type = imageType(bytes);
  return type ? `data:image/${type};base64,${bytes.toString("base64")}` : undefined;
}

/** What reading a cover found. `failed` = the player could not be asked (worth another try). */
export type CoverResult = { cover?: string; failed: false } | { failed: true };

/** Asks the Music app for the current track's artwork. Never throws; never launches the app. */
export async function readCover(
  run: OsaRunner,
  platform: NodeJS.Platform,
  signal?: AbortSignal,
  timeoutMs = COVER_TIMEOUT_MS,
): Promise<CoverResult> {
  if (platform !== "darwin") return { failed: false };
  const timeout = AbortSignal.timeout(timeoutMs);
  const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(new PlayerError("player", "The player did not answer"));
  if (stop.aborted) onAbort();
  else stop.addEventListener("abort", onAbort, { once: true });
  try {
    const output = await Promise.race([
      run(COVER_SCRIPT, [], { maxOutputBytes: MAX_COVER_OUTPUT_BYTES }),
      aborted.promise,
    ]);
    // The app closed between the two scripts: not an answer about this track, ask again later.
    if (output === "not_running") return { failed: true };
    const cover = parseCover(output);
    return cover ? { cover, failed: false } : { failed: false };
  } catch (err) {
    // An answer over the cap is a final "no cover" for this track; anything else may be transient.
    return err instanceof PlayerError && err.kind === "too_large"
      ? { failed: false }
      : { failed: true };
  } finally {
    stop.removeEventListener("abort", onAbort);
    aborted.promise.catch(() => {});
  }
}
