// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What "Send page to Phoenix" may say about a page, and nothing else. A page is untrusted data: its
// title and selection were written by a website. This module is shared by the extension (before it
// sends) and by the native-messaging host (before it forwards), so a hostile message to the host
// meets the same limits as the extension's own.

export const HOST_NAME = "dev.phoenix.companion";
export const MESSAGE_KIND = "page";
export const MAX_URL = 2048;
export const MAX_TITLE = 200;
export const MAX_SELECTION = 2000;

/** Control, format (this includes every bidirectional override) and line/paragraph separators. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** `text` cut to `max` code points, with an ellipsis when something was cut. */
export function clip(text, max) {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : text;
}

/** One line: control, format and separator characters become spaces, runs of space collapse. */
export function cleanTitle(value) {
  if (typeof value !== "string") return "";
  return clip(value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim(), MAX_TITLE);
}

/** Selected text: line breaks survive, tabs become spaces, every other control or format character goes. */
export function cleanSelection(value) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Zl}\p{Zp}]/gu, "\n")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : c === "\t" ? " " : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clip(text, MAX_SELECTION);
}

/**
 * The page address, or `null` when it must not be sent: http(s) only, no sign-in details, no
 * whitespace or control characters, at most MAX_URL characters. Only origin and path are sent: the
 * query and the fragment are dropped (an OAuth code, a session id or a magic-link key can sit in
 * either under a name no filter would recognise, and Phoenix has no use for them).
 */
export function cleanUrl(value) {
  if (typeof value !== "string" || value === "" || Array.from(value).length > MAX_URL) return null;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]/u.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const address = `${url.origin}${url.pathname}`;
  return Array.from(address).length > MAX_URL ? null : address;
}

/**
 * The one message the extension sends: `{ kind: "page", url, title, selection? }`. Returns
 * `{ ok: false, reason }` for an address that may not be sent. `selection` is included only when
 * the person had text selected.
 */
export function buildPageMessage({ url, title, selection }) {
  const address = cleanUrl(url);
  if (address === null) return { ok: false, reason: "unsupported_page" };
  const message = { kind: MESSAGE_KIND, url: address, title: cleanTitle(title) };
  const text = cleanSelection(selection);
  if (text !== "") message.selection = text;
  return { ok: true, message };
}

const KEYS = { kind: true, url: true, title: true, selection: true };

/**
 * Checks a message the host received. It must be a plain object with exactly the known keys and
 * already inside every limit: the host does not repair a hostile message, it refuses it.
 */
export function parsePageMessage(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !Object.hasOwn(KEYS, key))) return null;
  if (value.kind !== MESSAGE_KIND) return null;
  const url = cleanUrl(value.url);
  if (url === null || url !== value.url) return null;
  if (typeof value.title !== "string" || cleanTitle(value.title) !== value.title) return null;
  if (value.selection !== undefined) {
    if (typeof value.selection !== "string" || value.selection === "") return null;
    if (cleanSelection(value.selection) !== value.selection) return null;
  }
  return value.selection === undefined
    ? { kind: MESSAGE_KIND, url, title: value.title }
    : { kind: MESSAGE_KIND, url, title: value.title, selection: value.selection };
}
