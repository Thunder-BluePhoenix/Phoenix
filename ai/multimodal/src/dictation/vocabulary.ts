// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The user's dictionary, replacements and snippets.
//
//   * Everything is LITERAL. There is no user-supplied pattern anywhere, so nothing a user (or a
//     file that was imported into the settings) writes can make matching slow or surprising.
//   * A trigger is a phrase of plain words. Matching walks the dictated words once, left to right
//     (linear in the text; at most MAX_PHRASE_WORDS compares per candidate), and the output of a
//     stage is never matched again by the same stage, so replacements cannot chain or loop.
//   * Every list and every string has a limit, and a value over the limit is REFUSED with a message,
//     never silently shortened.
import {
  DictationError,
  MAX_EXPANDED_CHARS,
  hasHiddenCharacters,
  phraseKeys,
  stripTrailingPunctuation,
  tokenizeWords,
} from "./text";

export const VOCABULARY_LIMITS = {
  dictionary: 500,
  replacements: 500,
  snippets: 100,
  phraseWords: 5,
  phraseChars: 60,
  termChars: 80,
  replacementChars: 200,
  snippetChars: 2000,
} as const;

/** A word or name spelled the way the user wants it ("phoenix core" -> "Phoenix Core"). */
export interface DictionaryEntry {
  term: string;
  /** Plain words the recogniser hears when the term is not plain words itself ("C++"). */
  sounds_like?: string;
}
/** Literal text swapped for another literal text. `to` may be empty (the words are dropped). */
export interface Replacement {
  from: string;
  to: string;
}
/** Expands only when the WHOLE dictation is exactly the trigger (ignoring case and end punctuation). */
export interface Snippet {
  trigger: string;
  text: string;
}
export interface Vocabulary {
  dictionary: DictionaryEntry[];
  replacements: Replacement[];
  snippets: Snippet[];
}

export const EMPTY_VOCABULARY: Vocabulary = { dictionary: [], replacements: [], snippets: [] };

const bad = (message: string): never => {
  throw new DictationError("invalid", message);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(entry: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) bad(`${what}: unknown field "${key.slice(0, 40)}"`);
  }
}

function text(
  entry: Record<string, unknown>,
  key: string,
  what: string,
  max: number,
  options: { min?: number; lineBreaks?: boolean } = {},
): string {
  const value = entry[key];
  if (typeof value !== "string") return bad(`${what}: "${key}" must be text`);
  if (value.length < (options.min ?? 1)) return bad(`${what}: "${key}" is too short`);
  if (value.length > max) return bad(`${what}: "${key}" is longer than ${max} characters`);
  if (hasHiddenCharacters(value, options.lineBreaks === true))
    return bad(`${what}: "${key}" contains a control, invisible or direction-changing character`);
  return value;
}

function phrase(value: string, what: string, field: string): string[] {
  if (value.length > VOCABULARY_LIMITS.phraseChars)
    bad(`${what}: "${field}" is longer than ${VOCABULARY_LIMITS.phraseChars} characters`);
  const keys = phraseKeys(value);
  if (!keys || keys.length > VOCABULARY_LIMITS.phraseWords)
    bad(
      `${what}: "${field}" must be 1 to ${VOCABULARY_LIMITS.phraseWords} plain words separated by single spaces (no punctuation)`,
    );
  return keys!;
}

function list(input: unknown, name: string, max: number): unknown[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return bad(`${name} must be a list`);
  if (input.length > max) return bad(`${name} may hold at most ${max} entries`);
  return input;
}

function unique(seen: Record<string, true>, keys: string[], what: string): void {
  const id = keys.join(" ");
  if (Object.hasOwn(seen, id)) bad(`${what}: "${id}" appears twice`);
  seen[id] = true;
}

/** Validates user input and returns fresh, trimmed-to-nothing copies. Throws DictationError("invalid"). */
export function validateVocabulary(input: unknown): Vocabulary {
  if (!isRecord(input)) return bad("The vocabulary must be an object");
  onlyKeys(input, ["dictionary", "replacements", "snippets"], "Vocabulary");
  const dictionary: DictionaryEntry[] = [];
  const seenDictionary: Record<string, true> = {};
  for (const [i, raw] of list(
    input.dictionary,
    "dictionary",
    VOCABULARY_LIMITS.dictionary,
  ).entries()) {
    const what = `Dictionary entry ${i + 1}`;
    if (!isRecord(raw)) bad(`${what} must be an object`);
    const entry = raw as Record<string, unknown>;
    onlyKeys(entry, ["term", "sounds_like"], what);
    const term = text(entry, "term", what, VOCABULARY_LIMITS.termChars);
    if (term !== term.trim()) bad(`${what}: "term" has spaces at its start or end`);
    const sounds =
      entry.sounds_like === undefined
        ? undefined
        : text(entry, "sounds_like", what, VOCABULARY_LIMITS.phraseChars);
    const keys = phrase(sounds ?? term, what, sounds === undefined ? "term" : "sounds_like");
    unique(seenDictionary, keys, what);
    dictionary.push(sounds === undefined ? { term } : { term, sounds_like: sounds });
  }
  const replacements: Replacement[] = [];
  const seenReplacements: Record<string, true> = {};
  for (const [i, raw] of list(
    input.replacements,
    "replacements",
    VOCABULARY_LIMITS.replacements,
  ).entries()) {
    const what = `Replacement ${i + 1}`;
    if (!isRecord(raw)) bad(`${what} must be an object`);
    const entry = raw as Record<string, unknown>;
    onlyKeys(entry, ["from", "to"], what);
    const from = text(entry, "from", what, VOCABULARY_LIMITS.phraseChars);
    const keys = phrase(from, what, "from");
    unique(seenReplacements, keys, what);
    const to = text(entry, "to", what, VOCABULARY_LIMITS.replacementChars, { min: 0 });
    replacements.push({ from, to });
  }
  const snippets: Snippet[] = [];
  const seenSnippets: Record<string, true> = {};
  for (const [i, raw] of list(input.snippets, "snippets", VOCABULARY_LIMITS.snippets).entries()) {
    const what = `Snippet ${i + 1}`;
    if (!isRecord(raw)) bad(`${what} must be an object`);
    const entry = raw as Record<string, unknown>;
    onlyKeys(entry, ["trigger", "text"], what);
    const trigger = text(entry, "trigger", what, VOCABULARY_LIMITS.phraseChars);
    const keys = phrase(trigger, what, "trigger");
    unique(seenSnippets, keys, what);
    snippets.push({
      trigger,
      text: text(entry, "text", what, VOCABULARY_LIMITS.snippetChars, { lineBreaks: true }),
    });
  }
  return { dictionary, replacements, snippets };
}

interface PhraseEntry {
  keys: string[];
  out: string;
}
/** First word -> the phrases that start with it, longest first. */
type PhraseTable = Map<string, PhraseEntry[]>;

export interface CompiledVocabulary {
  dictionary: PhraseTable;
  replacements: PhraseTable;
  snippets: { keys: string; text: string }[];
}

function table(entries: readonly { keys: string[]; out: string }[]): PhraseTable {
  const byFirst: PhraseTable = new Map();
  for (const entry of entries) {
    const first = entry.keys[0]!;
    const bucket = byFirst.get(first);
    if (bucket) bucket.push(entry);
    else byFirst.set(first, [entry]);
  }
  for (const bucket of byFirst.values()) bucket.sort((a, b) => b.keys.length - a.keys.length);
  return byFirst;
}

/** Compiles VALIDATED vocabulary (see validateVocabulary). */
export function compileVocabulary(vocabulary: Vocabulary): CompiledVocabulary {
  return {
    dictionary: table(
      vocabulary.dictionary.map((e) => ({
        keys: phraseKeys(e.sounds_like ?? e.term)!,
        out: e.term,
      })),
    ),
    replacements: table(
      vocabulary.replacements.map((e) => ({ keys: phraseKeys(e.from)!, out: e.to })),
    ),
    snippets: vocabulary.snippets.map((s) => ({
      keys: phraseKeys(s.trigger)!.join(" "),
      text: s.text,
    })),
  };
}

/** One left-to-right pass: the longest listed phrase at each position wins. */
function applyTable(text: string, entries: PhraseTable): { text: string; changed: number } {
  if (entries.size === 0) return { text, changed: 0 };
  const tokens = tokenizeWords(text);
  let out = "";
  let last = 0;
  let changed = 0;
  for (let i = 0; i < tokens.length;) {
    const candidates = entries.get(tokens[i]!.key);
    let hit: PhraseEntry | undefined;
    if (candidates) {
      for (const candidate of candidates) {
        const n = candidate.keys.length;
        if (i + n > tokens.length) continue;
        let ok = true;
        for (let k = 0; k < n && ok; k++) {
          ok =
            tokens[i + k]!.key === candidate.keys[k] &&
            (k === 0 || text.slice(tokens[i + k - 1]!.end, tokens[i + k]!.start) === " ");
        }
        if (ok) {
          hit = candidate;
          break;
        }
      }
    }
    if (!hit) {
      i++;
      continue;
    }
    const lastToken = tokens[i + hit.keys.length - 1]!;
    out += text.slice(last, tokens[i]!.start) + hit.out;
    if (out.length > MAX_EXPANDED_CHARS)
      throw new DictationError(
        "limit",
        "The text grew past the allowed size while applying replacements",
      );
    last = lastToken.end;
    i += hit.keys.length;
    changed++;
  }
  if (changed === 0) return { text, changed };
  return { text: (out + text.slice(last)).replace(/\s+/gu, " ").trim(), changed };
}

export interface VocabularyResult {
  text: string;
  /** Dictionary hits and replacements applied (counts only). */
  dictionary: number;
  replacements: number;
  /** True when the whole dictation was a snippet trigger and was expanded. */
  snippet: boolean;
}

/** Dictionary, then replacements, then snippets. Pure; input must already be normalised. */
export function applyVocabulary(text: string, vocabulary: CompiledVocabulary): VocabularyResult {
  const dictionary = applyTable(text, vocabulary.dictionary);
  const replaced = applyTable(dictionary.text, vocabulary.replacements);
  const base = {
    text: replaced.text,
    dictionary: dictionary.changed,
    replacements: replaced.changed,
  };
  if (vocabulary.snippets.length === 0) return { ...base, snippet: false };
  const keys = phraseKeys(stripTrailingPunctuation(replaced.text).trim());
  if (!keys) return { ...base, snippet: false };
  const id = keys.join(" ");
  const hit = vocabulary.snippets.find((s) => s.keys === id);
  return hit ? { ...base, text: hit.text, snippet: true } : { ...base, snippet: false };
}
