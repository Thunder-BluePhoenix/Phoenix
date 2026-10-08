// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

const STOP_WORDS: Record<string, true> = Object.fromEntries(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in is it " +
    "its me my of on or our so than that the their them then there these they this to us was we were " +
    "what when where which who why will with would you your about tell show decide decided " +
    "yesterday today week last past days day ago happened happen going new did anything everything"
  )
    .split(" ")
    .map((w): [string, true] => [w, true]),
);

/** Lowercased words and numbers. Everything else (punctuation, FTS operators) is a separator. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Words worth searching for: no stop words, no single characters, unique, in first-seen order. */
export function contentWords(text: string): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const w of tokenize(text)) {
    if (w.length < 2 || STOP_WORDS[w] === true || seen[w] === true) continue;
    seen[w] = true;
    out.push(w);
  }
  return out;
}

/**
 * Turns free text into an FTS5 MATCH expression: every word quoted (so user text can never be
 * read as FTS syntax) and OR-ed (bm25 then ranks items that match more words higher).
 * Returns null when nothing searchable is left.
 */
export function buildMatchQuery(text: string, maxTerms = 12): string | null {
  const words = contentWords(text).slice(0, maxTerms);
  return words.length === 0 ? null : words.map((w) => `"${w}"`).join(" OR ");
}
