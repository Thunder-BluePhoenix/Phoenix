// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The pseudo-locale en-XA, built from the English messages: letters accented, text about 30% longer
// and every message in brackets. A string that shows up plain English in this locale was never
// extracted, a string that is cut off or overflows would be too in a long translation, and a
// missing bracket shows text that is built from pieces. Loaded only in dev and test builds.
import { en, type Messages, type MessageKey } from "./en";
import { mapMessageText } from "./icu";

const ACCENTS: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ł",
  n: "ñ",
  o: "ó",
  p: "þ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  w: "ŵ",
  y: "ý",
  z: "ž",
  A: "Á",
  C: "Ç",
  D: "Ð",
  E: "É",
  I: "Í",
  N: "Ñ",
  O: "Ó",
  S: "Š",
  U: "Ú",
  Y: "Ý",
};

/** Accents the letters of one piece of literal text and pads it by 30% with tildes. */
export function pseudoText(text: string): string {
  if (!/\p{L}/u.test(text)) return text;
  const accented = text.replace(/[A-Za-z]/g, (c) => ACCENTS[c] ?? c);
  return accented + "~".repeat(Math.ceil(text.length * 0.3));
}

export function pseudoMessage(message: string): string {
  return `[${mapMessageText(message, pseudoText)}]`;
}

const entries = (Object.keys(en) as MessageKey[]).map((key) => [key, pseudoMessage(en[key])]);
const pseudo: Messages = Object.fromEntries(entries) as Messages;

export default pseudo;
