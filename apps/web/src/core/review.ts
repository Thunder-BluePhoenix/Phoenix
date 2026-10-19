// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MessageKey } from "../i18n/en";
import type { Vars } from "../i18n/icu";
import { translate } from "../i18n/store";
import type { MeetingItem, MeetingItemKind, MeetingItemStatus } from "./types";

/** Anything that turns a message key into text: `useT()`'s result or the store's `translate`. */
type Say = (key: MessageKey, vars?: Vars) => string;

/** The limits Core enforces (core/api meeting-routes and ai/meetings store). */
export const MAX_ITEM_TEXT = 500;
export const MAX_OWNER = 80;
export const MAX_DUE = 80;
export const MAX_QUESTION = 500;

export const KIND_KEY: Record<MeetingItemKind, MessageKey> = {
  decision: "memory.items.kind.decision",
  action_item: "memory.items.kind.action_item",
  requirement: "memory.items.kind.requirement",
  topic: "memory.items.kind.topic",
  project_ref: "memory.items.kind.project_ref",
};

/** The same kinds in the middle of a sentence ("Accept decision: …"). */
export const KIND_LOWER_KEY: Record<MeetingItemKind, MessageKey> = {
  decision: "memory.items.kindLower.decision",
  action_item: "memory.items.kindLower.action_item",
  requirement: "memory.items.kindLower.requirement",
  topic: "memory.items.kindLower.topic",
  project_ref: "memory.items.kindLower.project_ref",
};

/** Words, never colour alone, say where an item stands. */
export const STATUS_KEY: Record<MeetingItemStatus, MessageKey> = {
  proposed: "memory.items.status.proposed",
  accepted: "memory.items.status.accepted",
  edited: "memory.items.status.edited",
  rejected: "memory.items.status.rejected",
};

export const STATUS_SHORT_KEY: Record<MeetingItemStatus, MessageKey> = {
  proposed: "memory.items.statusShort.proposed",
  accepted: "memory.items.statusShort.accepted",
  edited: "memory.items.statusShort.edited",
  rejected: "memory.items.statusShort.rejected",
};

/** The status in the middle of a sentence ("No rejected items."). */
export const STATUS_LOWER_KEY: Record<MeetingItemStatus, MessageKey> = {
  proposed: "memory.items.statusLower.proposed",
  accepted: "memory.items.statusLower.accepted",
  edited: "memory.items.statusLower.edited",
  rejected: "memory.items.statusLower.rejected",
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

export function extractedByLabel(extractedBy: string, say: Say = translate): string {
  if (extractedBy === "kage") return say("memory.items.extractedBy.kage");
  if (extractedBy === "manual") return say("memory.items.extractedBy.manual");
  if (extractedBy.startsWith("ai:call-summary")) return say("memory.items.extractedBy.callSummary");
  if (extractedBy.startsWith("ai:")) {
    return say("memory.items.extractedBy.ai", { model: extractedBy.slice(3) });
  }
  return say("memory.items.extractedBy.other", { source: extractedBy });
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
export function validateItemEdit(
  kind: MeetingItemKind,
  edit: ItemEdit,
  say: Say = translate,
): ItemEditProblems {
  const problems: ItemEditProblems = {};
  const text = edit.text.trim();
  if (text.length === 0) problems.text = say("memory.items.error.textEmpty");
  else if (text.length > MAX_ITEM_TEXT) {
    problems.text = say("memory.items.error.textLong", { length: text.length, max: MAX_ITEM_TEXT });
  }
  if (kind === "action_item") {
    if (edit.owner.trim().length > MAX_OWNER) {
      problems.owner = say("memory.items.error.ownerLong", { max: MAX_OWNER });
    }
    if (edit.due.trim().length > MAX_DUE) {
      problems.due = say("memory.items.error.dueLong", { max: MAX_DUE });
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
