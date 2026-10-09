// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MeetingItem, MeetingItemKind, MeetingItemStatus } from "./types";

/** The limits Core enforces (core/api meeting-routes and ai/meetings store). */
export const MAX_ITEM_TEXT = 500;
export const MAX_OWNER = 80;
export const MAX_DUE = 80;
export const MAX_QUESTION = 500;

export const KIND_LABEL: Record<MeetingItemKind, string> = {
  decision: "Decision",
  action_item: "Action item",
  requirement: "Requirement",
  topic: "Topic",
  project_ref: "Project reference",
};

/** Words, never colour alone, say where an item stands. */
export const STATUS_LABEL: Record<MeetingItemStatus, string> = {
  proposed: "Proposed: needs your review",
  accepted: "Accepted",
  edited: "Edited, not yet accepted",
  rejected: "Rejected",
};

export const STATUS_SHORT: Record<MeetingItemStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

/** Which review actions the state table allows (ai/meetings STATUS_TRANSITIONS). */
export const ITEM_ACTIONS: Record<
  MeetingItemStatus,
  { accept: boolean; edit: boolean; reject: boolean; reopen: boolean }
> = {
  proposed: { accept: true, edit: true, reject: true, reopen: false },
  edited: { accept: true, edit: true, reject: true, reopen: false },
  accepted: { accept: false, edit: true, reject: true, reopen: false },
  rejected: { accept: false, edit: false, reject: false, reopen: true },
};

export function extractedByLabel(extractedBy: string): string {
  if (extractedBy === "kage") return "Found by Kage";
  if (extractedBy === "manual") return "Written by you";
  if (extractedBy.startsWith("ai:")) return `Suggested by AI (${extractedBy.slice(3)})`;
  return `Found by ${extractedBy}`;
}

export interface ItemEdit {
  text: string;
  owner: string;
  due: string;
}

export interface ItemEditProblems {
  text?: string;
  owner?: string;
  due?: string;
}

/** The same rules the API applies on edit, so the form says what Core would say. */
export function validateItemEdit(kind: MeetingItemKind, edit: ItemEdit): ItemEditProblems {
  const problems: ItemEditProblems = {};
  const text = edit.text.trim();
  if (text.length === 0) problems.text = "The text cannot be empty.";
  else if (text.length > MAX_ITEM_TEXT) {
    problems.text = `The text is ${text.length} characters; the most allowed is ${MAX_ITEM_TEXT}.`;
  }
  if (kind === "action_item") {
    if (edit.owner.trim().length > MAX_OWNER) {
      problems.owner = `The owner is too long (most ${MAX_OWNER} characters).`;
    }
    if (edit.due.trim().length > MAX_DUE) {
      problems.due = `The due date is too long (most ${MAX_DUE} characters).`;
    }
  }
  return problems;
}

/** The JSON body of POST /api/meeting-items/:id/edit. */
export interface ItemEditBody {
  text: string;
  owner?: string | null;
  due?: string | null;
}

/** Blank owner or due clears it; only action items carry them. */
export function editBody(item: Pick<MeetingItem, "kind">, edit: ItemEdit): ItemEditBody {
  const text = edit.text.trim();
  if (item.kind !== "action_item") return { text };
  return { text, owner: edit.owner.trim() || null, due: edit.due.trim() || null };
}
