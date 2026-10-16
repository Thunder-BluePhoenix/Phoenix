// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { Fragment, type ReactNode } from "react";

/**
 * Text from a coding agent, made safe to judge by eye. Nothing is truncated; whitespace and
 * look-alike or invisible characters cannot hide a payload:
 *  - a newline shows as ⏎ (and still breaks the line), a tab as →;
 *  - a run of two or more spaces, and a leading or trailing space, shows as · per space;
 *  - every character outside printable ASCII shows as an escape like \u{202e}.
 * The marker characters ⏎ → · are themselves non-ASCII, so real text can never imitate them.
 */
const SPECIAL = /\n|\t| {2,}|^ | $|[^\x20-\x7e]/gu;

/** True when `text` holds a character other than printable ASCII, newline or tab. */
export const hasHiddenChars = (text: string) => /[^\x20-\x7e\n\t]/u.test(text);

interface Part {
  text: string;
  marker: boolean;
}

function parts(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(SPECIAL)) {
    const at = m.index;
    if (at > last) out.push({ text: text.slice(last, at), marker: false });
    const found = m[0];
    if (found === "\n") {
      out.push({ text: "⏎", marker: true }, { text: "\n", marker: false });
    } else if (found === "\t") {
      out.push({ text: "→", marker: true });
    } else if (found.startsWith(" ")) {
      out.push({ text: "·".repeat(found.length), marker: true });
    } else {
      out.push({ text: `\\u{${found.codePointAt(0)!.toString(16)}}`, marker: true });
    }
    last = at + found.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), marker: false });
  return out;
}

/** The same rendering as plain text, for places that cannot hold elements (labels, titles). */
export const revealPlain = (text: string) =>
  parts(text)
    .map((p) => p.text)
    .join("");

/** `text` with its markers highlighted; plain text is returned as one text node. */
export function revealNodes(text: string): ReactNode {
  const all = parts(text);
  if (all.every((p) => !p.marker)) return text;
  return all.map((p, i) =>
    p.marker ? (
      <span key={i} className="reveal-mark">
        {p.text}
      </span>
    ) : (
      <Fragment key={i}>{p.text}</Fragment>
    ),
  );
}

/** A wrapped monospace block holding the whole of `text`. */
export function RevealedBlock({ text }: { text: string }) {
  return <code className="reveal-block">{revealNodes(text)}</code>;
}
