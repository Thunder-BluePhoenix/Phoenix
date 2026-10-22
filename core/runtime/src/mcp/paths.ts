// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Absolute paths name the owner's account, project layout and other clients' work. What an MCP
// client may read carries the last path segment only.

/** An absolute path inside text: `/a/b`, `~/a/b`, `C:\a\b`. Relative paths and URLs are left alone. */
const ABSOLUTE_PATH = /(?<![\w.~:\\/-])(?:~|[A-Za-z]:)?[\\/][^\s"'`<>|;,()]*/gu;

/** The last segment of a path (`/Users/me/proj/` -> `proj`); `…` when there is none. */
export function lastSegment(path: string): string {
  const parts = path
    .split(/[\\/]/)
    .filter((p) => p.length > 0 && p !== "~" && !/^[A-Za-z]:$/.test(p));
  return parts.at(-1) ?? "…";
}

/** `text` with every absolute path reduced to its last segment. */
export function basenamesOnly(text: string): string {
  return text.replace(ABSOLUTE_PATH, (found) => lastSegment(found));
}
