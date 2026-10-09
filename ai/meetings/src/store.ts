// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import { redact } from "@phoenix/logging";
import { isRecord } from "./guards";
import {
  isExtractedBy,
  isItemKind,
  isItemStatus,
  type Evidence,
  type ExtractedBy,
  type ItemKind,
  type ItemStatus,
  type MeetingItem,
  type OriginalText,
} from "./types";

/** Longest item text, owner and due kept. Longer values are cut by the caller, never here. */
export const MAX_ITEM_TEXT = 500;
export const MAX_OWNER = 80;
export const MAX_DUE = 80;

/** What an extractor hands over. There is no status: a machine item is always `proposed`. */
export interface ExtractedItem {
  kind: ItemKind;
  text: string;
  owner: string | null;
  due: string | null;
  evidence: Evidence | null;
  /** Stable identity of the extracted wording, see `itemDedupeKey`. */
  dedupeKey: string;
}

export interface ManualItem {
  kind: ItemKind;
  text: string;
  owner: string | null;
  due: string | null;
}

export interface ReviewUpdate {
  status: ItemStatus;
  text: string;
  owner: string | null;
  due: string | null;
  original: OriginalText | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface ItemFilter {
  status?: ItemStatus;
  kind?: ItemKind;
}

interface Row {
  id: string;
  meeting_id: string;
  kind: string;
  text: string;
  owner: string | null;
  due: string | null;
  status: string;
  extracted_by: string;
  evidence: string | null;
  original: string | null;
  dedupe_key: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const optionalNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

function toEvidence(v: unknown): Evidence | null {
  if (!isRecord(v) || typeof v.quote !== "string") return null;
  if (v.source !== "transcript" && v.source !== "summary") return null;
  const segmentStart = optionalNumber(v.segmentStart);
  const segmentEnd = optionalNumber(v.segmentEnd);
  const charStart = optionalNumber(v.charStart);
  const charEnd = optionalNumber(v.charEnd);
  return {
    source: v.source,
    quote: v.quote,
    ...(segmentStart !== undefined ? { segmentStart } : {}),
    ...(segmentEnd !== undefined ? { segmentEnd } : {}),
    ...(charStart !== undefined ? { charStart } : {}),
    ...(charEnd !== undefined ? { charEnd } : {}),
  };
}

function toOriginal(v: unknown): OriginalText | null {
  if (!isRecord(v) || typeof v.text !== "string") return null;
  return {
    text: v.text,
    owner: typeof v.owner === "string" ? v.owner : null,
    due: typeof v.due === "string" ? v.due : null,
  };
}

function toItem(r: Row): MeetingItem {
  if (!isItemKind(r.kind) || !isItemStatus(r.status) || !isExtractedBy(r.extracted_by)) {
    throw new Error(`meeting item ${r.id} has an unknown kind, status or origin`);
  }
  return {
    id: r.id,
    meetingId: r.meeting_id,
    kind: r.kind,
    text: r.text,
    owner: r.owner,
    due: r.due,
    status: r.status,
    extractedBy: r.extracted_by,
    evidence: toEvidence(parseJson(r.evidence)),
    original: toOriginal(parseJson(r.original)),
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
  };
}

export interface ItemStoreOptions {
  now?: () => Date;
  newId?: () => string;
}

/**
 * Decisions, action items and the rest, one row each (`meeting_items`, migration 9). Text that
 * looks like a credential is redacted on the way in. Deleting the meeting removes the rows through
 * a database trigger; nothing here has to remember to.
 */
export class ItemStore {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly db: Database,
    options: ItemStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => `mi_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  stamp(): string {
    return this.now().toISOString();
  }

  /**
   * Stores a machine-extracted item. The status is the literal "proposed" here and also enforced
   * by a database trigger: no input can make a machine item accepted. Returns null when the same
   * wording is already stored for the meeting (whatever its review state: a rejected item is
   * never re-proposed by a second run).
   */
  insertExtracted(
    meetingId: string,
    item: ExtractedItem,
    extractedBy: Exclude<ExtractedBy, "manual">,
  ): MeetingItem | null {
    const id = this.newId();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO meeting_items
           (id, meeting_id, kind, text, owner, due, status, extracted_by, evidence, original,
            dedupe_key, created_at, reviewed_at, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        id,
        meetingId,
        item.kind,
        clean(item.text),
        item.owner === null ? null : clean(item.owner),
        item.due === null ? null : clean(item.due),
        extractedBy,
        item.evidence ? JSON.stringify(cleanEvidence(item.evidence)) : null,
        item.dedupeKey,
        this.stamp(),
      );
    return Number(result.changes) > 0 ? this.get(id) : null;
  }

  /** An item the user typed in. It starts accepted: the user is its author and its reviewer. */
  insertManual(meetingId: string, item: ManualItem, reviewer: string): MeetingItem | null {
    const id = this.newId();
    const at = this.stamp();
    const text = clean(item.text);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO meeting_items
           (id, meeting_id, kind, text, owner, due, status, extracted_by, evidence, original,
            dedupe_key, created_at, reviewed_at, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, 'accepted', 'manual', NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        id,
        meetingId,
        item.kind,
        text,
        item.owner === null ? null : clean(item.owner),
        item.due === null ? null : clean(item.due),
        `manual:${id}`,
        at,
        at,
        reviewer,
      );
    return Number(result.changes) > 0 ? this.get(id) : null;
  }

  get(id: string): MeetingItem | null {
    const row = this.db.prepare("SELECT * FROM meeting_items WHERE id = ?").get(id) as
      Row | undefined;
    return row ? toItem(row) : null;
  }

  list(meetingId: string, filter: ItemFilter = {}): MeetingItem[] {
    const where = ["meeting_id = ?"];
    const params: string[] = [meetingId];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.kind) {
      where.push("kind = ?");
      params.push(filter.kind);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM meeting_items WHERE ${where.join(" AND ")} ORDER BY created_at, rowid`,
      )
      .all(...params) as unknown as Row[];
    return rows.map(toItem);
  }

  /** Item count per status for one meeting. */
  counts(meetingId: string): Record<ItemStatus, number> {
    const counts: Record<ItemStatus, number> = { proposed: 0, accepted: 0, edited: 0, rejected: 0 };
    const rows = this.db
      .prepare(
        "SELECT status, COUNT(*) AS n FROM meeting_items WHERE meeting_id = ? GROUP BY status",
      )
      .all(meetingId) as unknown as { status: string; n: number }[];
    for (const r of rows) if (isItemStatus(r.status)) counts[r.status] = r.n;
    return counts;
  }

  count(meetingId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM meeting_items WHERE meeting_id = ?")
        .get(meetingId) as unknown as { n: number }
    ).n;
  }

  /** Writes a review decision. The caller has already checked the transition. */
  update(id: string, u: ReviewUpdate): MeetingItem | null {
    this.db
      .prepare(
        `UPDATE meeting_items SET status = ?, text = ?, owner = ?, due = ?, original = ?,
           reviewed_at = ?, reviewed_by = ? WHERE id = ?`,
      )
      .run(
        u.status,
        clean(u.text),
        u.owner === null ? null : clean(u.owner),
        u.due === null ? null : clean(u.due),
        u.original ? JSON.stringify(u.original) : null,
        u.reviewedAt,
        u.reviewedBy,
        id,
      );
    return this.get(id);
  }

  /**
   * Removes Kage items nobody has reviewed yet whose text Kage no longer produces (a summary was
   * regenerated). Reviewed items stay: a person's decision is not undone by a re-run.
   */
  removeStaleProposed(
    meetingId: string,
    extractedBy: ExtractedBy,
    keepKeys: readonly string[],
  ): number {
    const keep = new Set(keepKeys);
    const stale = (
      this.db
        .prepare(
          "SELECT id, dedupe_key FROM meeting_items WHERE meeting_id = ? AND extracted_by = ? AND status = 'proposed'",
        )
        .all(meetingId, extractedBy) as unknown as { id: string; dedupe_key: string }[]
    ).filter((r) => !keep.has(r.dedupe_key));
    const del = this.db.prepare("DELETE FROM meeting_items WHERE id = ?");
    for (const r of stale) del.run(r.id);
    return stale.length;
  }
}

/** Secret-shaped text never lands in the table. */
function clean(text: string): string {
  return redact(text) as string;
}

function cleanEvidence(e: Evidence): Evidence {
  return { ...e, quote: clean(e.quote) };
}
