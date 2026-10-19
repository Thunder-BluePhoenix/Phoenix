// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The wake phrase "OK Fawkes", matched on the TEXT a recogniser produced for a short, VAD-gated
// utterance. This is deliberately not a keyword spotter: a whisper pass runs per utterance (see
// docs/voice-assistant.md), so recognition quality for a name like "Fawkes" depends on the model;
// the matcher tolerates the usual mis-hearings and nothing more.
//
// Rules:
//   * Both words are needed. "ok" alone, "fawkes" alone, "ok google" and "ok fine" do NOT wake.
//   * The phrase must be at the start of the utterance (at most two lead words, "hey ok fawkes").
//   * "Fawkes" matches itself, anything one edit away (five letters or more: "fakes", "fawke"), and
//     a short list of spellings whisper tends to produce. Ordinary words ("folks", "forks", "fake")
//     are NOT accepted: waking on "ok folks" in a meeting would be worse than missing a wake.
//   * What follows the phrase is returned as the request, untouched, for the intent matcher.

const OK_WORDS: Record<string, true> = { ok: true, okay: true, okey: true, okie: true };
/** Spellings whisper produces for the name. Ordinary words ("fox", "faux") are not in the list. */
const FAWKES_SPELLINGS: Record<string, true> = {
  fawkes: true,
  fawks: true,
  fawkis: true,
  fauks: true,
  fawcus: true,
  falks: true,
  fokes: true,
  fawx: true,
};
const MAX_LEAD_WORDS = 2;
const WORD = /[\p{L}\p{N}']+/gu;

export interface WakeMatch {
  matched: boolean;
  /** The text after the wake phrase, trimmed (empty when the user only said the phrase). */
  rest: string;
}

/** Lower case, accents and apostrophes removed: the form words are compared in. */
export function normaliseWord(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’]/gu, "")
    .toLowerCase();
}

/** True when `a` and `b` differ by at most one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function isFawkes(word: string): boolean {
  return (
    Object.hasOwn(FAWKES_SPELLINGS, word) || (word.length >= 5 && withinOneEdit(word, "fawkes"))
  );
}

/** Separates "o k" / "o.k." into one word so "O.K. Fawkes" wakes like "ok Fawkes". */
function wordsOf(text: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = normaliseWord(m[0]);
    if (word.length === 0) continue;
    const previous = out.at(-1);
    if (previous?.word === "o" && word === "k") {
      previous.word = "ok";
      previous.end = m.index + m[0].length;
    } else {
      out.push({ word, start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/** Words that, before the name, make a greeting the assistant (or a person) would answer to. */
const GREETING_WORDS: Record<string, true> = { ...OK_WORDS, hey: true, hi: true };

/**
 * `text` with every wake-phrase-like run ("ok Fawkes", "okay, fawkes", "O.K. Fawkes", "okfawkes",
 * and the same with "hey"/"hi", each as the matcher above would hear it, anywhere in the text)
 * replaced by a space. Text from a third party that Fawkes reads aloud goes through this, so the
 * assistant's own speech cannot wake it (or any other listener) with someone else's words.
 */
export function neutraliseWake(text: string): string {
  let current = text;
  for (;;) {
    const words = wordsOf(current);
    let hit: { start: number; end: number } | null = null;
    for (let i = 0; i < words.length && !hit; i++) {
      const first = words[i]!.word;
      const second = words[i + 1]?.word;
      const joined = Object.keys(GREETING_WORDS).some(
        (g) => first.startsWith(g) && isFawkes(first.slice(g.length)),
      );
      if (joined) hit = { start: words[i]!.start, end: words[i]!.end };
      else if (Object.hasOwn(GREETING_WORDS, first) && second !== undefined && isFawkes(second))
        hit = { start: words[i]!.start, end: words[i + 1]!.end };
    }
    if (!hit) return current;
    current = `${current.slice(0, hit.start)} ${current.slice(hit.end)}`;
  }
}

export function matchWake(text: string): WakeMatch {
  const words = wordsOf(text);
  const last = Math.min(MAX_LEAD_WORDS, words.length - 1);
  for (let i = 0; i <= last; i++) {
    const first = words[i]!.word;
    const second = words[i + 1]?.word;
    // "okfawkes" as one word is what a fast speaker produces.
    const joined = Object.keys(OK_WORDS).some(
      (ok) => first.startsWith(ok) && isFawkes(first.slice(ok.length)),
    );
    if (joined || (Object.hasOwn(OK_WORDS, first) && second !== undefined && isFawkes(second))) {
      const end = joined ? words[i]!.end : words[i + 1]!.end;
      return {
        matched: true,
        rest: text
          .slice(end)
          .replace(/^[\s,.:;!?-]+/u, "")
          .trim(),
      };
    }
  }
  return { matched: false, rest: "" };
}
