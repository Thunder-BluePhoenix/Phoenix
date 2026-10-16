// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Text hygiene shared by the dictation pipeline. Dictated text is DATA from a microphone and a
// speech model: it can carry anything. Every pattern below is linear (no nested quantifiers, no
// user-supplied pattern), so no input can make it backtrack.

/** Largest text the pipeline accepts or produces. A 120 s session is a few hundred words. */
export const MAX_TEXT_CHARS = 20_000;
/** A hard stop on how far replacements and snippets may grow a text. */
export const MAX_EXPANDED_CHARS = 100_000;

export type DictationErrorKind =
  "disabled" | "busy" | "not_found" | "limit" | "invalid" | "unavailable" | "aborted";

/** A refusal with a stable kind; the Core maps it to an API error. Its message is safe to show. */
export class DictationError extends Error {
  constructor(
    readonly kind: DictationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DictationError";
  }
}

/** Bidi controls, zero-width characters, BOM: they make a text look different from what it is. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;
const INVISIBLE_TEST = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
const CONTROL_TEST = /[\u0000-\u001F\u007F-\u009F]/u;
const BLANK_CONTROL = /[\t\n\r\v\f\u0085\u2028\u2029]/gu;
const OTHER_CONTROL = /[\u0000-\u001F\u007F-\u009F]/gu;

/** True when a user-authored label or term contains an invisible or control character. */
export function hasHiddenCharacters(value: string, allowLineBreaks = false): boolean {
  if (INVISIBLE_TEST.test(value)) return true;
  if (!allowLineBreaks) return CONTROL_TEST.test(value);
  return CONTROL_TEST.test(value.replace(/[\n\t]/gu, ""));
}

/** Removes invisible characters and control characters, without changing visible content. */
export function stripHidden(value: string): string {
  return value.replace(INVISIBLE, "").replace(BLANK_CONTROL, " ").replace(OTHER_CONTROL, "");
}

/** NFC, no hidden characters, one space between words, trimmed. Throws on oversized input. */
export function normaliseText(raw: string): string {
  if (raw.length > MAX_TEXT_CHARS) {
    throw new DictationError(
      "limit",
      `The dictated text is longer than ${MAX_TEXT_CHARS} characters`,
    );
  }
  return stripHidden(raw.normalize("NFC")).replace(/\s+/gu, " ").trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/** A word is letters, digits, marks, apostrophes and hyphens; everything else separates words. */
const WORD = /[\p{L}\p{N}\p{M}_'\u2019-]+/gu;

export interface WordToken {
  start: number;
  end: number;
  /** Lower-cased word, the comparison key. */
  key: string;
}

export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index;
    tokens.push({ start, end: start + match[0].length, key: match[0].toLowerCase() });
  }
  return tokens;
}

/** The words of a phrase that is only words separated by single spaces; otherwise null. */
export function phraseKeys(phrase: string): string[] | null {
  const tokens = tokenizeWords(phrase);
  if (tokens.length === 0) return null;
  const keys = tokens.map((t) => t.key);
  return keys.join(" ") === phrase.toLowerCase() ? keys : null;
}

/** Removes trailing sentence punctuation, scanning from the end (no pattern, so no backtracking). */
export function stripTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && ".!?,;:".includes(text.charAt(end - 1))) end--;
  return text.slice(0, end);
}
