// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Control, format and line-separator characters: none of them may reach a terminal from Core data. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Makes untrusted text safe to print on one line. Event summaries, commands and approval titles are
 * written by other programs; an escape sequence in one must not move the cursor, retitle the window
 * or hide text from the person deciding.
 */
export function clean(value: unknown, max = 200): string {
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);
  const flat = text.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * JSON keeps controls escaped but permits bidi and other format characters literally. Replace every
 * terminal-dangerous code point in untrusted string values with a visible JSON unicode escape.
 */
export function terminalSafeJson(value: unknown): string {
  const escape = (text: string): string =>
    text.replace(
      UNSAFE,
      (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
    );
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === "string" ? escape(entry) : entry,
  );
}

/** Orders keys so equal values always serialise to the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Tokens shorter than this are not session tokens; replacing them would mangle ordinary text. */
const MIN_SECRET = 8;

/** Removes every occurrence of the session token from text on its way to a terminal or a log. */
export function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret.length < MIN_SECRET) return text;
  return text.split(secret).join("[redacted]");
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
