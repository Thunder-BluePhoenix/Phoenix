// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export const ITEM_KINDS = [
  "decision",
  "action_item",
  "requirement",
  "topic",
  "project_ref",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value);
}

export const ITEM_STATUSES = ["proposed", "accepted", "edited", "rejected"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export function isItemStatus(value: unknown): value is ItemStatus {
  return typeof value === "string" && (ITEM_STATUSES as readonly string[]).includes(value);
}

/**
 * Who produced an item: Kage itself, a model (`ai:<provider>/<model>`) or the user. Anything that
 * is not `manual` is a machine and can only ever be stored as `proposed`.
 */
export type ExtractedBy = "kage" | "manual" | `ai:${string}`;

export function isExtractedBy(value: unknown): value is ExtractedBy {
  return (
    value === "kage" || value === "manual" || (typeof value === "string" && value.startsWith("ai:"))
  );
}

/**
 * Every allowed status change, as data. A pair that is not listed is refused (self-pairs included).
 *
 * - proposed -> accepted | edited | rejected: the three review actions.
 * - edited -> accepted | rejected: an edited item still awaits a decision.
 * - accepted -> rejected: take back an approval.
 * - rejected -> proposed: "undo reject" puts the item back in the review queue. It never skips
 *   review: there is no rejected -> accepted or rejected -> edited.
 *
 * Only `accepted` items are memory facts. `edited` is a human-changed text that nobody has
 * approved yet, so it is not remembered until it is accepted.
 */
export const STATUS_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  proposed: ["accepted", "edited", "rejected"],
  edited: ["accepted", "rejected"],
  accepted: ["rejected"],
  rejected: ["proposed"],
};

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * The status an item has after its text is edited, or null when it may not be edited. Editing an
 * accepted item keeps it accepted (the person who edits it is its reviewer; the memory fact
 * follows the new text); editing a pending item marks it `edited`; a rejected item must be
 * reopened first.
 */
export const STATUS_AFTER_EDIT: Record<ItemStatus, ItemStatus | null> = {
  proposed: "edited",
  edited: "edited",
  accepted: "accepted",
  rejected: null,
};

/** Where an item came from inside the meeting. A verbatim quote, never a paraphrase. */
export interface Evidence {
  source: "transcript" | "summary";
  quote: string;
  /** Transcript segment indices (inclusive) the quote lies in, when the transcript has segments. */
  segmentStart?: number;
  segmentEnd?: number;
  /** UTF-16 offsets of the quote in the transcript text (end exclusive). */
  charStart?: number;
  charEnd?: number;
}

/** What the item said before the first edit. Set once, never overwritten. */
export interface OriginalText {
  text: string;
  owner: string | null;
  due: string | null;
}

export interface MeetingItem {
  id: string;
  /** `MeetingStore.id`: `<capability>:<external id>`. */
  meetingId: string;
  kind: ItemKind;
  text: string;
  owner: string | null;
  due: string | null;
  status: ItemStatus;
  extractedBy: ExtractedBy;
  evidence: Evidence | null;
  original: OriginalText | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}
