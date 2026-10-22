// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { IncomingMessage } from "node:http";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { BodyTooLargeError } from "./http";

export interface RawBodyLimits {
  maxBytes: number;
  /** A sender that has not finished its body by then is cut off. */
  timeoutMs: number;
  /** Accepted `content-type` prefixes (the signature covers bytes, so the type is not parsed). */
  contentTypes: readonly string[];
}

/**
 * Reads the exact bytes of a request body for callers that authenticate with a signature over those
 * bytes (webhooks, chat provider callbacks). It enforces the size cap by declaration and while
 * streaming, and a deadline so a sender that stalls cannot hold the connection open.
 */
export function readRawBody(req: IncomingMessage, limits: RawBodyLimits): Promise<Buffer> {
  const { maxBytes, timeoutMs, contentTypes } = limits;
  const type = req.headers["content-type"] ?? "";
  if (!contentTypes.some((allowed) => type.startsWith(allowed))) {
    req.resume();
    throw new PhoenixError(
      ErrorCode.INVALID_REQUEST,
      `Content-Type must be ${contentTypes.join(" or ")}`,
    );
  }
  const declared = req.headers["content-length"];
  if (declared !== undefined && !/^\d+$/.test(declared))
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Invalid Content-Length");
  if (Number(declared ?? 0) > maxBytes) throw new BodyTooLargeError(maxBytes);
  const done = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  let size = 0;
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    chunks.length = 0;
    req.destroy();
    done.reject(new PhoenixError(ErrorCode.INVALID_REQUEST, "Request body timed out"));
  }, timeoutMs);
  timer.unref();
  req.on("data", (chunk: Buffer) => {
    if (finished) return;
    size += chunk.length;
    if (size > maxBytes) {
      finished = true;
      chunks.length = 0;
      req.pause();
      clearTimeout(timer);
      done.reject(new BodyTooLargeError(maxBytes));
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!finished) {
      finished = true;
      clearTimeout(timer);
      done.resolve(Buffer.concat(chunks));
    }
  });
  req.on("error", (error) => {
    clearTimeout(timer);
    done.reject(error);
  });
  return done.promise;
}
