// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Text helpers for oracles. Matching is done on a normalised form so that zero-width characters,
// full-width letters, mixed case and RTL marks cannot hide (or fake) a match.
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g;

/** NFKC, invisible characters removed, lower-cased. */
export function normalise(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "").toLowerCase();
}

export const includesText = (haystack: string, needle: string): boolean =>
  normalise(haystack).includes(normalise(needle));

const STOP: Record<string, true> = Object.fromEntries(
  "about after again also because been before being below between both could does doing down during each from further have having here into more most only other over same should some such than that their them then there these they this those through under until very what when where which while with would your the and for are was were its not but can will not"
    .split(" ")
    .map((w): [string, true] => [w, true]),
);

const HEX = /\b[0-9a-f]{7,40}\b/g;
const QUOTED = /["'`“”‘’]([^"'`“”‘’]{2,80})["'`“”‘’]/g;
// A token that has a digit, or an underscore, dot, slash or hyphen BETWEEN two alphanumerics.
// A sentence-ending full stop ("failed.") must not turn a plain word into an identifier.
const IDENT = /[\p{L}\p{N}]+(?:[_./-][\p{L}\p{N}]+)+|[\p{L}]*[\p{N}][\p{L}\p{N}]*/gu;

/**
 * The identifiers a claim asserts: commit shas, quoted names, and tokens with digits or
 * punctuation inside (job names, file paths, versions). A claim naming one of these is only
 * supported by evidence that contains it.
 */
export function identifiersOf(claim: string): string[] {
  const text = normalise(claim);
  const found: Record<string, true> = {};
  for (const m of text.matchAll(HEX)) found[m[0]] = true;
  for (const m of text.matchAll(QUOTED)) if (m[1]) found[m[1].trim()] = true;
  for (const m of text.matchAll(IDENT)) {
    const token = m[0];
    // Plain numbers like "1" or "2" say nothing; versions, paths, job names and ids do.
    if (token.length >= 3 && /[\p{L}]/u.test(token)) found[token] = true;
  }
  return Object.keys(found);
}

export function contentWordsOf(text: string): string[] {
  const seen: Record<string, true> = {};
  for (const w of normalise(text).match(/[\p{L}]{5,}/gu) ?? [])
    if (STOP[w] !== true) seen[w] = true;
  return Object.keys(seen);
}

export interface Support {
  supported: boolean;
  /** Identifiers (or content words) that the cited evidence does not contain. */
  missing: string[];
}

/**
 * Does the cited evidence actually contain what the claim asserts? If the claim names
 * identifiers, every one must be present. Otherwise at least half of its content words must be.
 * This is deliberately a lexical check: it catches a real id attached to an unrelated statement,
 * but cannot prove the statement is true.
 */
export function supportedBy(claim: string, evidenceTexts: readonly string[]): Support {
  const evidence = normalise(evidenceTexts.join("\n"));
  const ids = identifiersOf(claim);
  if (ids.length > 0) {
    const missing = ids.filter((id) => !evidence.includes(id));
    return { supported: missing.length === 0, missing };
  }
  const words = contentWordsOf(claim);
  if (words.length === 0) return { supported: true, missing: [] };
  const missing = words.filter((w) => !evidence.includes(w));
  return { supported: missing.length <= words.length / 2, missing };
}
