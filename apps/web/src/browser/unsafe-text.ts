// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: characters the chrome never searches for and never shows as they are. Page data (an
// origin, a title) can carry controls or bidirectional marks that make text read differently from how
// it is stored; the same set is refused in a find query.

/** C0, DEL and C1 controls (Unicode Cc). */
// eslint-disable-next-line no-control-regex
export const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** Bidi marks, embeddings, overrides and isolates (Arabic letter mark, LRM/RLM, LRE..RLO, LRI..PDI). */
export const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

// eslint-disable-next-line no-control-regex
const UNSAFE_ALL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Page text for display: unsafe characters become U+FFFD and the length is capped. */
export function displayText(text: string, max = 200): string {
  const clean = text.replace(UNSAFE_ALL, "\ufffd");
  const chars = [...clean];
  return chars.length > max ? `${chars.slice(0, max).join("")}\u2026` : clean;
}
