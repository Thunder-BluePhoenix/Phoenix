// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/**
 * Runs `fn` with a timeout and converts any throw (sync or async) into a
 * rejected promise, so a misbehaving capability can never take down core.
 */
export async function guarded<T>(fn: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PhoenixError(ErrorCode.OPERATION_TIMEOUT)), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([Promise.resolve().then(fn), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function toPhoenixError(
  err: unknown,
  fallback: ErrorCode = ErrorCode.CAPABILITY_UNAVAILABLE,
): PhoenixError {
  if (err instanceof PhoenixError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new PhoenixError(fallback, message.slice(0, 300));
}
