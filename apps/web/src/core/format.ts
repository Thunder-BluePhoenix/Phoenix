// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { dateStyle: "medium" });
}

/** "just now", "3 min", "2 h", "4 d" */
export function formatSince(iso: string, now: number = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 45_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export const SEVERITY_LABEL: Record<string, string> = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  error: "Error",
};

export const SIDE_EFFECT_LABEL: Record<string, string> = {
  none: "No side effects",
  read: "Reads data",
  write: "Changes data",
  execute: "Runs commands",
  external: "Acts on an external service",
  production: "Changes production",
};

/**
 * An http(s) URL that is safe to link to, or null. A source reference is data from memory, so it is
 * only ever linked when it parses as a plain http(s) URL without embedded credentials; everything
 * else (file paths, commit ids, `javascript:` and `data:` URLs) stays text.
 */
export function safeHttpUrl(ref: string | null | undefined): string | null {
  if (!ref || ref.length > 2048 || /\s/.test(ref)) return null;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.href;
}
