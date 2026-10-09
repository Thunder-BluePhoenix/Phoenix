// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What Kage already produced (`summary.decisions`, `summary.action_items`, `summary.topics`),
// turned into reviewable items. These are proposals like any other: Kage is a machine too, so
// nothing here is accepted until a person accepts it.
import type { Summary, Transcript } from "@phoenix/persistence";
import { isRecord } from "./guards";
import { findQuote, normalise, type NormalisedText } from "./normalize";
import { itemKey } from "./extract-ai";
import { MAX_DUE, MAX_ITEM_TEXT, MAX_OWNER, type ExtractedItem } from "./store";
import type { Evidence, ItemKind } from "./types";

/** Most items imported per kind from one summary. */
export const MAX_KAGE_ITEMS_PER_KIND = 100;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

interface Shape {
  text: string;
  owner: string | null;
  due: string | null;
}

/** An action item given as a string, or as an object with `text` (or `task`) and optional owner/due. */
function actionShape(raw: unknown): Shape | null {
  const plain = text(raw);
  if (plain !== null) return { text: plain, owner: null, due: null };
  if (!isRecord(raw)) return null;
  const body = text(raw.text) ?? text(raw.task) ?? text(raw.description);
  if (body === null) return null;
  const owner = text(raw.owner) ?? text(raw.assignee);
  const due = text(raw.due) ?? text(raw.due_date) ?? text(raw.deadline);
  return {
    text: body,
    owner: owner !== null && owner.length <= MAX_OWNER ? owner : null,
    due: due !== null && due.length <= MAX_DUE ? due : null,
  };
}

function evidenceFor(body: string, transcript: NormalisedText | null, raw: string): Evidence {
  if (transcript !== null) {
    const found = findQuote(transcript, body);
    if (found.found) {
      return {
        source: "transcript",
        quote: raw.slice(found.match.start, found.match.end),
        charStart: found.match.start,
        charEnd: found.match.end,
      };
    }
  }
  return { source: "summary", quote: body };
}

/** The items in a Kage summary. Unknown shapes are skipped; nothing is invented. */
export function kageItems(summary: Summary, transcript: Transcript | null): ExtractedItem[] {
  const normalised = transcript ? normalise(transcript.text) : null;
  const out: ExtractedItem[] = [];
  const add = (kind: ItemKind, shape: Shape | null): void => {
    if (shape === null) return;
    const body = shape.text.slice(0, MAX_ITEM_TEXT);
    out.push({
      kind,
      text: body,
      owner: shape.owner,
      due: shape.due,
      evidence: evidenceFor(body, normalised, transcript?.text ?? ""),
      dedupeKey: itemKey(kind, body),
    });
  };
  const plain = (raw: unknown): Shape | null => {
    const body = text(raw);
    return body === null ? null : { text: body, owner: null, due: null };
  };
  for (const d of (summary.decisions ?? []).slice(0, MAX_KAGE_ITEMS_PER_KIND)) {
    add("decision", plain(d));
  }
  for (const a of (summary.action_items ?? []).slice(0, MAX_KAGE_ITEMS_PER_KIND)) {
    add("action_item", actionShape(a));
  }
  for (const t of (summary.topics ?? []).slice(0, MAX_KAGE_ITEMS_PER_KIND)) {
    add("topic", plain(t));
  }
  return out;
}
