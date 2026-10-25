// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the approval card shows for a Phoenix browser action (Phase 95). The capability hands over its
// raw, schema-checked input in `details.confirm_input`; everything here is re-validated and cut down
// to what a person needs to decide: the action, the page (host and path only), the control or
// destination and, for `type`, the FULL text. The text is display data: it is never put in the
// summary, the audit record or an event, only in the pending confirmation the user is looking at.

export type BrowserCardKind = "click" | "type" | "submit" | "download" | "navigate";

export interface BrowserCard {
  kind: BrowserCardKind;
  /** Host and path, never query, fragment or credentials. */
  pageUrl: string;
  selector?: string;
  /** Host and path, never the query. */
  destination?: string;
  /** The destination had a query that the card does not show. */
  queryHidden?: boolean;
  /** type only: the full text, invisible and control characters shown as escapes. */
  text?: string;
  /** type only: UTF-16 length of the raw text. */
  textLength?: number;
}

const KINDS = new Set<string>(["click", "type", "submit", "download", "navigate"]);
const SELECTOR =
  /^(?:input|button|form|select|textarea)(?:#[A-Za-z0-9_:.-]{1,80}|\[name="[A-Za-z0-9_:.-]{1,80}"\])$/;
export const MAX_CARD_TEXT_CHARS = 4096;
const MAX_CARD_URL_CHARS = 2048;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/gu;

/** host + path of an http(s) address; `null` for anything else. The query is reported, not returned. */
export function hostAndPath(value: unknown): { shown: string; hadQuery: boolean } | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CARD_URL_CHARS)
    return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  return { shown: `${url.host}${url.pathname}`, hadQuery: url.search !== "" };
}

/** Newline as `\n`, tab as `\t`, every other invisible character as `\u{XXXX}`; nothing is dropped. */
export function escapeTypedText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(INVISIBLE, (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()}}`);
}

/** The card for `browser.<command>`, or `undefined` when the input is not exactly what the capability sends. */
export function browserCard(command: string, details: unknown): BrowserCard | undefined {
  if (!KINDS.has(command)) return undefined;
  const raw = (details as { confirm_input?: unknown } | undefined)?.confirm_input;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const page = hostAndPath(input.pageUrl);
  if (!page) return undefined;
  const kind = command as BrowserCardKind;
  const card: BrowserCard = { kind, pageUrl: page.shown };
  if (kind === "navigate") {
    const destination = hostAndPath(input.destination);
    if (!destination) return undefined;
    card.destination = destination.shown;
    if (destination.hadQuery) card.queryHidden = true;
    return card;
  }
  if (typeof input.selector !== "string" || !SELECTOR.test(input.selector)) return undefined;
  card.selector = input.selector;
  if (kind === "type") {
    if (typeof input.text !== "string" || input.text.length > MAX_CARD_TEXT_CHARS) return undefined;
    card.text = escapeTypedText(input.text);
    card.textLength = input.text.length;
  }
  return card;
}
