// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Review of decisions and action items, and their link to memory.
//
// - Extraction (Kage's own items, optionally a model's) only ever creates `proposed` items.
// - A person accepts, edits or rejects each one. Every action is checked against the transition
//   table in types.ts and leaves an audit record with ids and counts, never text.
// - Only ACCEPTED decisions and action items are memory facts (source "meeting-review", scope
//   "meeting:<id>", sensitive). Memory is re-derived from the accepted set after every change, so
//   an edit replaces the fact, and a reject or reopen removes it. Deleting the meeting removes the
//   items and the facts through the migration-9 trigger.
import type { PrivacyClass } from "@phoenix/ai-models";
import {
  canView,
  digest,
  type MemoryPipeline,
  type MemoryStore,
  type Viewer,
} from "@phoenix/ai-memory";
import type { Meeting, Summary, Transcript, Database } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { GenerateFn } from "@phoenix/ai-context";
import { emptyStats, extractWithAi, type ExtractionStats } from "./extract-ai";
import { kageItems } from "./extract-kage";
import {
  ItemStore,
  MAX_DUE,
  MAX_ITEM_TEXT,
  MAX_OWNER,
  type ItemFilter,
  type ItemStoreOptions,
  type ManualItem,
} from "./store";
import {
  canTransition,
  isItemKind,
  isItemStatus,
  STATUS_AFTER_EDIT,
  type ItemKind,
  type ItemStatus,
  type MeetingItem,
} from "./types";

/** The memory `source` of facts made from reviewed items. The runtime's memory policy must know it. */
export const REVIEW_MEMORY_SOURCE = "meeting-review";

/** The part of MeetingStore this package reads. A MeetingStore satisfies it. */
export interface MeetingSource {
  get(id: string): Meeting | null;
  transcript(id: string): Transcript | null;
  summary(id: string): Summary | null;
}

/** Who is acting. `viewer`, when given, must be allowed to see the meeting. */
export interface Actor {
  id: string;
  viewer?: Viewer;
}

export interface MeetingServiceOptions extends ItemStoreOptions {
  db: Database;
  meetings: MeetingSource;
  memory: MemoryStore;
  pipeline: MemoryPipeline;
  /** Records an audit entry. Details are ids and counts only. */
  audit: (action: string, details: Record<string, unknown>) => void;
  /** The current model call, or null when AI is unavailable. Read on every use. */
  generate?: () => GenerateFn | null;
  nonce?: () => string;
}

export interface KageImport {
  imported: number;
  duplicates: number;
  /** Unreviewed Kage items removed because the regenerated summary no longer has them. */
  removed: number;
}

export interface AiImport {
  stored: number;
  stats: ExtractionStats;
  /** Why no model was used, in words for the user; null when one was. */
  unavailable: string | null;
}

export interface ExtractionReport {
  meetingId: string;
  kage: KageImport;
  /** null when AI extraction was not requested or no transcript exists. */
  ai: AiImport | null;
}

export interface MemoryOutcome {
  /** Facts newly stored by this action. */
  stored: number;
  /** Why memory refused an accepted item (for example sensitive meeting data is not allowed). */
  refused: string[];
}

export interface ReviewResult {
  item: MeetingItem;
  memory: MemoryOutcome;
}

export const REVIEW_KINDS: Record<ItemKind, boolean> = {
  decision: true,
  action_item: true,
  requirement: false,
  topic: false,
  project_ref: false,
};

const SENSITIVITY: PrivacyClass = "sensitive";

const invalid = (message: string): PhoenixError =>
  new PhoenixError(ErrorCode.INVALID_REQUEST, message);

export class MeetingItemService {
  readonly items: ItemStore;

  constructor(private readonly o: MeetingServiceOptions) {
    this.items = new ItemStore(o.db, { now: o.now, newId: o.newId });
  }

  // ── Visibility ───────────────────────────────────────────────────────────

  private canSee(meetingId: string, viewer: Viewer): boolean {
    return canView(viewer, {
      scope: `meeting:${meetingId}`,
      domain: "meeting",
      sensitivity: SENSITIVITY,
    });
  }

  private meetingFor(meetingId: string, actor?: Actor): Meeting {
    const meeting = this.o.meetings.get(meetingId);
    // Same error for "no such meeting" and "not yours": the caller cannot tell them apart.
    if (!meeting || (actor?.viewer !== undefined && !this.canSee(meetingId, actor.viewer))) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "No such meeting");
    }
    return meeting;
  }

  private itemFor(itemId: string, actor: Actor): MeetingItem {
    const item = this.items.get(itemId);
    const visible =
      item !== null &&
      this.o.meetings.get(item.meetingId) !== null &&
      (actor.viewer === undefined || this.canSee(item.meetingId, actor.viewer));
    // Missing, deleted and forbidden look the same.
    if (!item || !visible) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "No such item");
    return item;
  }

  // ── Extraction ───────────────────────────────────────────────────────────

  /**
   * Imports Kage's own decisions, action items and topics as `proposed`. Cheap and local; run it
   * whenever a summary arrives. Items already known (in any review state) are not added again.
   */
  importKage(meetingId: string): KageImport {
    const meeting = this.meetingFor(meetingId);
    const summary = this.o.meetings.summary(meeting.id);
    const report: KageImport = { imported: 0, duplicates: 0, removed: 0 };
    if (!summary) return report;
    const found = kageItems(summary, this.o.meetings.transcript(meeting.id));
    for (const item of found) {
      if (this.items.insertExtracted(meeting.id, item, "kage")) report.imported++;
      else report.duplicates++;
    }
    report.removed = this.items.removeStaleProposed(
      meeting.id,
      "kage",
      found.map((i) => i.dedupeKey),
    );
    if (report.imported + report.removed > 0) {
      this.o.audit("meeting.items.imported", {
        meeting_id: meeting.id,
        extracted_by: "kage",
        imported: report.imported,
        removed: report.removed,
      });
    }
    return report;
  }

  /**
   * Asks a model for items from the transcript. Only grounded items are stored, all as `proposed`.
   * Does nothing (reports why) when AI is off or no provider may see the transcript.
   */
  async extractWithAi(meetingId: string): Promise<AiImport | null> {
    const meeting = this.meetingFor(meetingId);
    const transcript = this.o.meetings.transcript(meeting.id);
    if (!transcript || transcript.text.trim().length === 0) return null;
    const generate = this.o.generate?.() ?? null;
    if (generate === null) {
      return {
        stored: 0,
        stats: emptyStats(),
        unavailable: "AI is not configured, so only Kage's own items were imported.",
      };
    }
    const known = this.items.list(meeting.id).map((i) => ({ kind: i.kind, text: i.text }));
    const result = await extractWithAi(transcript, {
      generate,
      known,
      ...(this.o.nonce ? { nonce: this.o.nonce } : {}),
    });
    let stored = 0;
    for (const candidate of result.items) {
      if (this.items.insertExtracted(meeting.id, candidate, candidate.extractedBy)) stored++;
    }
    const dropped = Object.values(result.stats.dropped).reduce((a, b) => a + b, 0);
    this.o.audit("meeting.items.extracted", {
      meeting_id: meeting.id,
      extracted_by: "ai",
      proposed: result.stats.proposed,
      stored,
      dropped,
      chunks: result.stats.chunks,
    });
    return { stored, stats: result.stats, unavailable: result.unavailable };
  }

  /** Kage's items, then (when `useAi`) the model's. */
  async extract(meetingId: string, options: { useAi: boolean }): Promise<ExtractionReport> {
    const kage = this.importKage(meetingId);
    const ai = options.useAi ? await this.extractWithAi(meetingId) : null;
    return { meetingId, kage, ai };
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  list(meetingId: string, filter: ItemFilter = {}, actor?: Actor): MeetingItem[] {
    this.meetingFor(meetingId, actor);
    return this.items.list(meetingId, filter);
  }

  get(itemId: string, actor?: Actor): MeetingItem {
    return this.itemFor(itemId, actor ?? { id: "" });
  }

  counts(meetingId: string, actor?: Actor): Record<ItemStatus, number> {
    this.meetingFor(meetingId, actor);
    return this.items.counts(meetingId);
  }

  // ── Review ───────────────────────────────────────────────────────────────

  accept(itemId: string, actor: Actor): ReviewResult {
    return this.move(itemId, "accepted", actor);
  }

  reject(itemId: string, actor: Actor): ReviewResult {
    return this.move(itemId, "rejected", actor);
  }

  /** Puts a rejected item back in the review queue (it is not accepted by doing so). */
  reopen(itemId: string, actor: Actor): ReviewResult {
    return this.move(itemId, "proposed", actor);
  }

  /**
   * Changes the wording (and optionally owner and due; `undefined` keeps, `null` clears). The
   * first edit keeps the extracted text in `original`. A pending item becomes `edited`; an
   * accepted item stays accepted and its memory fact is replaced; a rejected item cannot be
   * edited until it is reopened.
   */
  edit(
    itemId: string,
    change: { text: string; owner?: string | null; due?: string | null },
    actor: Actor,
  ): ReviewResult {
    const item = this.itemFor(itemId, actor);
    const next = STATUS_AFTER_EDIT[item.status];
    if (next === null) throw invalid(`A ${item.status} item cannot be edited`);
    const text = change.text.trim();
    if (text.length === 0) throw invalid("The text cannot be empty");
    if (text.length > MAX_ITEM_TEXT)
      throw invalid(`The text is longer than ${MAX_ITEM_TEXT} characters`);
    const owner = change.owner === undefined ? item.owner : change.owner?.trim() || null;
    const due = change.due === undefined ? item.due : change.due?.trim() || null;
    if (owner !== null && owner.length > MAX_OWNER) throw invalid("The owner name is too long");
    if (due !== null && due.length > MAX_DUE) throw invalid("The due date is too long");
    if (item.kind !== "action_item" && (owner !== null || due !== null)) {
      throw invalid("Only action items have an owner or a due date");
    }
    return this.write(item, next, { text, owner, due }, actor);
  }

  /** Adds an item the user wrote. It is accepted at once: the user is its author and reviewer. */
  addManual(meetingId: string, input: ManualItem, actor: Actor): ReviewResult {
    this.meetingFor(meetingId, actor);
    if (!isItemKind(input.kind)) throw invalid("Unknown item kind");
    const text = input.text.trim();
    if (text.length === 0 || text.length > MAX_ITEM_TEXT)
      throw invalid("The text is empty or too long");
    if (input.kind !== "action_item" && (input.owner !== null || input.due !== null)) {
      throw invalid("Only action items have an owner or a due date");
    }
    const item = this.items.insertManual(meetingId, { ...input, text }, actor.id);
    if (!item) throw invalid("That item already exists");
    const memory = this.syncMemory(meetingId);
    this.o.audit("meeting.item.added", {
      meeting_id: meetingId,
      item_id: item.id,
      kind: item.kind,
    });
    return { item, memory };
  }

  private move(itemId: string, to: ItemStatus, actor: Actor): ReviewResult {
    const item = this.itemFor(itemId, actor);
    if (!isItemStatus(to) || !canTransition(item.status, to)) {
      throw invalid(`A ${item.status} item cannot become ${to}`);
    }
    return this.write(item, to, { text: item.text, owner: item.owner, due: item.due }, actor);
  }

  private write(
    item: MeetingItem,
    status: ItemStatus,
    value: { text: string; owner: string | null; due: string | null },
    actor: Actor,
  ): ReviewResult {
    const changed =
      value.text !== item.text || value.owner !== item.owner || value.due !== item.due;
    const original =
      item.original ?? (changed ? { text: item.text, owner: item.owner, due: item.due } : null);
    const updated = this.items.update(item.id, {
      status,
      ...value,
      original,
      reviewedAt: this.items.stamp(),
      reviewedBy: actor.id,
    });
    if (!updated) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "No such item");
    const memory = this.syncMemory(item.meetingId);
    this.o.audit("meeting.item.reviewed", {
      meeting_id: item.meetingId,
      item_id: item.id,
      kind: item.kind,
      from: item.status,
      to: status,
      edited: changed,
      reviewed_by: actor.id,
    });
    return { item: updated, memory };
  }

  // ── Memory ───────────────────────────────────────────────────────────────

  /**
   * Makes memory match the accepted decisions and action items of one meeting: captures each,
   * removes the facts of items that are no longer accepted or whose text changed (the dedupe key
   * includes a digest of the wording, so an edit is a new fact and the old one is purged).
   */
  syncMemory(meetingId: string): MemoryOutcome {
    const outcome: MemoryOutcome = { stored: 0, refused: [] };
    const meeting = this.o.meetings.get(meetingId);
    const keys: string[] = [];
    if (meeting) {
      const title = meeting.title ?? `Meeting ${meeting.external_id}`;
      const observedAt = meeting.started_at ?? meeting.ended_at ?? meeting.updated_at;
      for (const item of this.items.list(meetingId, { status: "accepted" })) {
        if (!REVIEW_KINDS[item.kind]) continue;
        const extra = [
          item.owner ? `owner: ${item.owner}` : "",
          item.due ? `due: ${item.due}` : "",
        ].filter(Boolean);
        const body = extra.length ? `${item.text} (${extra.join(", ")})` : item.text;
        const dedupeKey = `${REVIEW_MEMORY_SOURCE}:${item.id}:${digest(body)}`;
        keys.push(dedupeKey);
        const result = this.o.pipeline.capture({
          source: REVIEW_MEMORY_SOURCE,
          sourceRef: meetingId,
          scope: `meeting:${meetingId}`,
          contentType: item.kind === "decision" ? "meeting_decision" : "meeting_action_item",
          text:
            item.kind === "decision"
              ? `Decision in "${title}": ${body}`
              : `Action item in "${title}": ${body}`,
          observedAt,
          dedupeKey,
          sensitivity: SENSITIVITY,
          provenance: {
            meeting_id: meetingId,
            item_id: item.id,
            item_kind: item.kind,
            extracted_by: item.extractedBy,
            reviewed_by: item.reviewedBy,
            reviewed_at: item.reviewedAt,
            edited: item.original !== null,
            ...(item.evidence
              ? {
                  evidence_source: item.evidence.source,
                  ...(item.evidence.segmentStart !== undefined
                    ? { segment_start: item.evidence.segmentStart }
                    : {}),
                  ...(item.evidence.segmentEnd !== undefined
                    ? { segment_end: item.evidence.segmentEnd }
                    : {}),
                  ...(item.evidence.charStart !== undefined
                    ? { char_start: item.evidence.charStart }
                    : {}),
                  ...(item.evidence.charEnd !== undefined
                    ? { char_end: item.evidence.charEnd }
                    : {}),
                }
              : {}),
            part: item.kind,
          },
        });
        if (result.status === "stored") outcome.stored++;
        else if (result.status === "refused") outcome.refused.push(result.reason);
        else if (result.status === "rejected") outcome.refused.push(result.reason);
      }
    }
    this.o.memory.purge({
      source: REVIEW_MEMORY_SOURCE,
      domain: "meeting",
      sourceRef: meetingId,
      keepKeys: keys,
    });
    return outcome;
  }
}
