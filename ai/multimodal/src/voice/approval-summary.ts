// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What Fawkes says about the capability confirmations that are waiting for a person (Phase 67
// follow-up). Each confirmation carries `details.targets` (the marked input values of the command),
// already re-sanitised by the permission gateway. They are still UNTRUSTED text from a third party
// (a repository, a page, a file name), so this file treats them as data and nothing else:
//   * only the VALUES are spoken, each inside quotes after the fixed words `target:`; the names of
//     the properties are never read out;
//   * a value loses control, format (bidi, zero-width), separator and private-use characters, is
//     folded to NFKC, loses quote marks, and is clipped to 80 characters;
//   * at most three values in all, then "and N more";
//   * a value that looks like a secret (the `[REDACTED]` marker, a long unbroken run of credential
//     characters) is spoken as "[hidden]", never as itself;
//   * words that voice treats as an answer or an action (approve, yes, no, deny, ok, send...) and any
//     wake phrase are replaced by an ellipsis, so the speech cannot read out an instruction or a
//     phrase a listener (or a microphone) could take as a yes/no.
// The result is a sentence only. Nothing here approves, denies or runs anything.
import { clipSpeech } from "./summary";
import { neutraliseWake } from "./wake";

export const MAX_TARGET_CHARS = 80;
export const MAX_TARGETS_SPOKEN = 3;
/** Values read per confirmation before the rest are only counted (bounds the work on hostile input). */
const MAX_VALUES_SCANNED = 16;

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
/** Control, format (bidi, zero-width), line/paragraph separators, private-use, unassigned, blank fillers. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\u2800\u3164\u115f\u1160]/gu;
const QUOTES = /["'`\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f\u00ab\u00bb\u2039\u203a]/gu;
/** Words voice treats as an answer or an action (see intent.ts), plus yes/no/ok variants. */
const ANSWER_WORDS =
  /\b(approve[ds]?|approving|approval|confirm(?:ed|s)?|accept(?:ed|s)?|allow(?:ed|s)?|yes|yeah|yep|yup|sure|ok|okay|no|nope|deny|denied|reject(?:ed|s)?|decline[ds]?|cancel(?:led|s)?|go ahead|send|delete|remove|create|write|edit|deploy|publish|play|pause|skip)\b/giu;
/** A long unbroken run of credential-ish characters. */
const LONG_RUN = /[A-Za-z0-9_+=-]{20,}/gu;
const REDACTED_MARK = /\[(?:REDACTED|TRUNCATED)\]/giu;

export interface ConfirmationTargets {
  id: string;
  targets?: unknown;
}

/** One value as quoted data: clean, masked, clipped. Empty string when nothing is left to say. */
export function safeTargetValue(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  // Clip first: everything below only ever sees a bounded string, whatever the gateway handed over.
  let text = String(raw).slice(0, MAX_TARGET_CHARS * 4);
  text = text.replace(HIDDEN, "").normalize("NFKC").replace(HIDDEN, "").replace(QUOTES, "");
  text = text.replace(REDACTED_MARK, "[hidden]");
  text = text.replace(LONG_RUN, (run) => (/\d/u.test(run) || run.length >= 32 ? "[hidden]" : run));
  text = neutraliseWake(text).replace(ANSWER_WORDS, "…");
  return clipSpeech(text, MAX_TARGET_CHARS).replace(QUOTES, "");
}

/**
 * The safe values of one confirmation's targets, in the order the gateway sent them, and how many
 * further named targets were counted without being cleaned (bounds the work on a hostile object).
 */
function valuesOf(targets: unknown): { values: string[]; unscanned: number } {
  const out = { values: [] as string[], unscanned: 0 };
  if (typeof targets !== "object" || targets === null || Array.isArray(targets)) return out;
  let scanned = 0;
  for (const [name, raw] of Object.entries(targets)) {
    if (!NAME.test(name)) continue;
    if (++scanned > MAX_VALUES_SCANNED) {
      out.unscanned++;
      continue;
    }
    const value = safeTargetValue(raw);
    if (value !== "") out.values.push(value);
  }
  return out;
}

/**
 * `target: "a", target: "b", target: "c", and N more.` for the waiting confirmations (three values
 * in all, across every request). Returns "" when no confirmation has a usable target.
 */
export function summariseConfirmationTargets(pending: readonly ConfirmationTargets[]): string {
  const values: string[] = [];
  let unscanned = 0;
  for (const item of pending) {
    const one = valuesOf(item.targets);
    values.push(...one.values);
    unscanned += one.unscanned;
  }
  if (values.length === 0) return "";
  const spoken = values.slice(0, MAX_TARGETS_SPOKEN).map((v) => `target: "${v}"`);
  const more = values.length - spoken.length + unscanned;
  if (more > 0) spoken.push(`and ${more} more`);
  return `${spoken.join(", ")}.`;
}
