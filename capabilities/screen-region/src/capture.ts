// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// One user-driven screen-region capture. The only OS effect is the stock macOS `screencapture`
// program, started with an argv array (never a shell) and told to let the person drag a region
// (`-i -s`). It never captures on its own: the caller (the capability command) runs only after the
// permission gateway's per-use confirmation. Everything the program leaves behind is a file in a
// fresh private directory, which is validated, read once and removed on every path.
//
// What this file will NOT do, on purpose:
//   * take a path, an argument, a window id or any other input from a caller: the argv is fixed
//     except for the final file name, which is a random name inside a directory this file just created;
//   * capture a whole screen or a window (`-s` allows mouse selection only);
//   * keep the image: it is returned once, as a PNG at most MAX_IMAGE_BYTES, and the file is deleted;
//   * support another platform. Linux and Windows report "unsupported"; nothing is guessed.
import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** The same cap as the web page's image drop (apps/web/src/core/attachments.ts DROP_LIMITS.imageBytes). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** A region larger than this on either side is refused (a PNG header can claim anything). */
export const MAX_DIMENSION = 16_384;
/** How long the person has to drag a region before the program is killed. */
export const CAPTURE_TIMEOUT_MS = 120_000;
/** The absolute path of the system program; never resolved through PATH. */
export const SCREENCAPTURE = "/usr/sbin/screencapture";

export type RegionCaptureErrorKind =
  "busy" | "timeout" | "stopped" | "failed" | "invalid_image" | "too_large" | "unsafe_directory";

/** Messages are fixed text: no path, argv or program output is ever put into one. */
export class RegionCaptureError extends Error {
  constructor(
    readonly kind: RegionCaptureErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "RegionCaptureError";
  }
}

export interface RunResult {
  /** Exit code; null when the program could not start, timed out or was stopped. */
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
}

export interface RunOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

/** Runs one program to completion with an argv array. The real one is `realRunner` (real.ts). */
export type Runner = (
  file: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

export interface RegionCaptureEnv {
  platform: NodeJS.Platform;
  /** Directory in which the private capture directory is created (the OS temp directory). */
  tmpRoot: string;
  run: Runner;
  timeoutMs?: number;
}

export type RegionCapture =
  | { status: "captured"; png: Uint8Array; width: number; height: number }
  | { status: "cancelled" }
  | { status: "unsupported"; platform: string };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;
const IHDR_END = 8 + 4 + 4 + 13 + 4;

const invalid = () =>
  new RegionCaptureError(
    "invalid_image",
    "The capture was not a valid PNG image and was discarded",
  );

/**
 * Checks the bytes are a whole PNG: signature, a 13-byte IHDR first, sane dimensions, and the IEND
 * chunk last (a truncated file fails). Returns the dimensions. It does not decode the pixels.
 */
export function inspectPng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < IHDR_END + IEND.length) throw invalid();
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (view.getUint32(8) !== 13 || ihdr !== "IHDR") throw invalid();
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw invalid();
  const tail = bytes.length - IEND.length;
  if (!IEND.every((b, i) => bytes[tail + i] === b)) throw invalid();
  return { width, height };
}

/** The private directory must be ours alone: a directory (not a link), no group or other access. */
async function assertPrivate(dir: string): Promise<void> {
  const info = await lstat(dir);
  const uid = typeof process.getuid === "function" ? process.getuid() : info.uid;
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== uid) {
    throw new RegionCaptureError("unsafe_directory", "The capture directory was not private");
  }
}

/**
 * Lets the person drag one region, then returns it. Esc in the selector leaves no file and exit code
 * 0, which is reported as "cancelled" (not an error). The private directory and anything in it are
 * removed before this returns or throws, whatever happened.
 */
export async function captureRegion(
  env: RegionCaptureEnv,
  signal: AbortSignal,
): Promise<RegionCapture> {
  if (env.platform !== "darwin") return { status: "unsupported", platform: env.platform };
  if (signal.aborted) throw new RegionCaptureError("stopped", "The capture was stopped");
  const dir = await mkdtemp(join(env.tmpRoot, "phoenix-region-"));
  try {
    await assertPrivate(dir);
    const file = join(dir, `${randomBytes(16).toString("hex")}.png`);
    const ran = await env.run(SCREENCAPTURE, ["-i", "-s", "-t", "png", file], {
      timeoutMs: env.timeoutMs ?? CAPTURE_TIMEOUT_MS,
      signal,
    });
    if (ran.aborted || signal.aborted) {
      throw new RegionCaptureError("stopped", "The capture was stopped");
    }
    if (ran.timedOut) {
      throw new RegionCaptureError("timeout", "No region was chosen in time; nothing was captured");
    }
    if (ran.code === null) {
      throw new RegionCaptureError("failed", "The macOS capture program could not run");
    }
    let info;
    try {
      info = await lstat(file);
    } catch {
      if (ran.code === 0) return { status: "cancelled" };
      throw new RegionCaptureError("failed", "The macOS capture program reported an error");
    }
    if (ran.code !== 0) {
      throw new RegionCaptureError("failed", "The macOS capture program reported an error");
    }
    if (!info.isFile()) throw invalid();
    if (info.size > MAX_IMAGE_BYTES) {
      throw new RegionCaptureError(
        "too_large",
        "The captured region is too large and was discarded",
      );
    }
    const png = new Uint8Array(await readFile(file));
    if (png.length > MAX_IMAGE_BYTES) {
      throw new RegionCaptureError(
        "too_large",
        "The captured region is too large and was discarded",
      );
    }
    const { width, height } = inspectPng(png);
    return { status: "captured", png, width, height };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
