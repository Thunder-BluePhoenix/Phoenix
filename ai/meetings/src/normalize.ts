// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Text normalisation for the grounding check. A quote counts as present in a transcript when the
// two match after: Unicode NFKC, lower case, typographic quotes and dashes made plain, invisible
// and control characters removed (zero-width spaces, bidi marks, tag characters) and every run of
// whitespace collapsed to one space. Nothing else is forgiven: a paraphrase does not match.

/** The normalised form of a text, with where each normalised character came from. */
export interface NormalisedText {
  text: string;
  /** For normalised index i: UTF-16 offset in the original where that character begins. */
  starts: number[];
  /** ... and where it ends (exclusive). */
  ends: number[];
}

const PLAIN: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2212": "-",
};

const INVISIBLE = /^[\p{Cf}\p{Cc}]$/u;
const WHITESPACE = /^\s$/u;

export function normalise(original: string): NormalisedText {
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace = false;
  // One code point plus any combining marks that follow it, so "e" + U+0301 composes like "é".
  for (const match of original.matchAll(/[\s\S]\p{M}*/gu)) {
    const cluster = match[0];
    const at = match.index;
    const first = String.fromCodePoint(cluster.codePointAt(0) ?? 0);
    if (WHITESPACE.test(first)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (INVISIBLE.test(first)) continue;
    const folded = cluster.normalize("NFKC").toLowerCase();
    const chars = [...folded].map((c) => PLAIN[c] ?? c).join("");
    if (chars.length === 0) continue;
    if (pendingSpace) {
      out.push(" ");
      starts.push(at);
      ends.push(at);
      pendingSpace = false;
    }
    for (let i = 0; i < chars.length; i++) {
      out.push(chars.charAt(i));
      starts.push(at);
      ends.push(at + cluster.length);
    }
  }
  return { text: out.join(""), starts, ends };
}

/** Letters and digits only, lower case: the words of a text. */
export function tokens(text: string): string[] {
  return normalise(text).text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** True when `needle` appears in `haystack` as a whole run of words (punctuation ignored). */
export function containsWords(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

export interface QuoteMatch {
  /** UTF-16 offsets in the ORIGINAL text; end exclusive. */
  start: number;
  end: number;
}

/** Shortest normalised quote that can count as evidence. */
export const MIN_QUOTE_CHARS = 8;
/** Fewest words in a quote: one word is not a quote. */
export const MIN_QUOTE_WORDS = 2;
/** Longest normalised quote: a quote that is a large part of the transcript proves nothing. */
export const MAX_QUOTE_CHARS = 600;

export type QuoteResult =
  | { found: true; match: QuoteMatch; normalised: string }
  | { found: false; reason: "unusable" | "absent" };

/**
 * Finds `quote` in an already normalised text. "unusable": too short or too long to be evidence.
 * "absent": a usable quote that the text does not contain. `quote` is normalised the same way.
 */
export function findQuote(haystack: NormalisedText, quote: string): QuoteResult {
  const needle = normalise(quote).text;
  if (
    needle.length < MIN_QUOTE_CHARS ||
    needle.length > MAX_QUOTE_CHARS ||
    needle.split(" ").length < MIN_QUOTE_WORDS
  ) {
    return { found: false, reason: "unusable" };
  }
  const at = haystack.text.indexOf(needle);
  const start = haystack.starts[at];
  const end = haystack.ends[at + needle.length - 1];
  if (at < 0 || start === undefined || end === undefined) return { found: false, reason: "absent" };
  return { found: true, match: { start, end }, normalised: needle };
}
