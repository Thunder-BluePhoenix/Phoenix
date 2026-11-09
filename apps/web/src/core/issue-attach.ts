// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 85, the page side of attaching the redacted screenshot to a Linear or Jira issue that
// already exists. It builds the one input of `issues` `linear.issue.attach` / `jira.issue.attach`
// from the flattened PNG the page holds:
//   * the image is checked here the way Core checks it (PNG signature, 13-byte IHDR first, IEND
//     last, at most 5 MiB), so a bad image never leaves the page;
//   * the file name is generated from the content hash (`phoenix-screenshot-<12 hex>.png`), never
//     typed or taken from the capture; `bytes` and `sha256_prefix` are what Core's approval card shows
//     and are recomputed by the capability on the bytes it sends, so the card cannot describe
//     another file than the one uploaded.
// GitHub is not here: it has no documented REST endpoint for an issue image, so it stays text only.

/** The same cap as the capture adapter, the drop and the capability. */
export const MAX_ATTACH_BYTES = 5 * 1024 * 1024;
export const ISSUES_CAPABILITY = "issues";
export type AttachTracker = "linear" | "jira";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

export type AttachProblem = "badImage" | "tooLarge" | "changed";

export class AttachImageError extends Error {
  constructor(readonly problem: AttachProblem) {
    super(problem);
    this.name = "AttachImageError";
  }
}

/** What the person is asked to confirm; identical to what Core's approval card will show. */
export interface AttachDetails {
  tracker: AttachTracker;
  issue: string;
  fileName: string;
  bytes: number;
  sha256Prefix: string;
}

export interface AttachRequest {
  details: AttachDetails;
  /** The command input, with the image as base64. */
  input: {
    issue: string;
    image_base64: string;
    bytes: number;
    sha256_prefix: string;
    file_name: string;
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(raw);
}

/** Throws AttachImageError unless `bytes` is a whole PNG of at most 5 MiB. */
export function checkPng(bytes: Uint8Array): void {
  if (bytes.length > MAX_ATTACH_BYTES) throw new AttachImageError("tooLarge");
  if (bytes.length < 8 + 25 + IEND.length) throw new AttachImageError("badImage");
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) throw new AttachImageError("badImage");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (view.getUint32(8) !== 13 || ihdr !== "IHDR") throw new AttachImageError("badImage");
  const tail = bytes.length - IEND.length;
  if (!IEND.every((b, i) => bytes[tail + i] === b)) throw new AttachImageError("badImage");
}

/** Reads, checks and hashes the PNG; the result is the command input and the confirmation details. */
export async function buildAttachRequest(
  tracker: AttachTracker,
  issue: string,
  image: Blob,
): Promise<AttachRequest> {
  if (image.size > MAX_ATTACH_BYTES) throw new AttachImageError("tooLarge");
  const bytes = new Uint8Array(await image.arrayBuffer());
  checkPng(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256Prefix = hex(digest).slice(0, 12);
  const fileName = `phoenix-screenshot-${sha256Prefix}.png`;
  return {
    details: { tracker, issue, fileName, bytes: bytes.length, sha256Prefix },
    input: {
      issue,
      image_base64: toBase64(bytes),
      bytes: bytes.length,
      sha256_prefix: sha256Prefix,
      file_name: fileName,
    },
  };
}
