// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { RawRequest } from "./types";

/** One header value, case-insensitive; undefined when absent or repeated (a repeated signature header is refused). */
export function headerValue(request: RawRequest, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}
