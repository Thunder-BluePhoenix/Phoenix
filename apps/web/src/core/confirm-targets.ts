// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Phase 67: the limits Core applies to `details.targets`, applied again here. */
export const MAX_TARGET_ROWS = 16;
export const MAX_TARGET_VALUE = 80;
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
/** Control (Cc), format and bidi (Cf), line and paragraph separators, and unassigned/private marks. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/gu;

/**
 * The `name: value` rows an approval card may show for a confirmation's `details.targets`.
 * Core already sanitises them, but the card never trusts that: names must be plain identifiers,
 * values lose control and bidirectional characters and are clipped, and at most 16 rows survive.
 * The result is for text nodes only: it is never a link, an attribute or markup.
 */
export function confirmTargetRows(targets: unknown): [name: string, value: string][] {
  if (typeof targets !== "object" || targets === null || Array.isArray(targets)) return [];
  const rows: [string, string][] = [];
  for (const [name, raw] of Object.entries(targets)) {
    if (rows.length >= MAX_TARGET_ROWS) break;
    if (!NAME.test(name) || typeof raw !== "string") continue;
    const value = Array.from(raw.replace(HIDDEN, "")).slice(0, MAX_TARGET_VALUE).join("").trim();
    if (value !== "") rows.push([name, value]);
  }
  return rows;
}
