// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Review of meeting decisions and action items inside Core (Phase 35 wiring).
//
// - Kage's own items are imported as `proposed` after every meeting sync (cheap, local, no model).
// - AI extraction is NEVER automatic: only `POST /api/meetings/:id/items/extract` runs it, through
//   `AiService` with privacy "sensitive" and a purpose the cloud gate does not allow for sensitive
//   data, so a transcript stays on this device.
// - Every review action is the signed-in user's (Core has one user, `reviewed_by` is the viewer id)
//   and writes an audit entry with ids and counts, never text.
// - Accepted decisions and action items become memory facts; forgetting such a fact in the Memory
//   tab rejects its item (`MemoryRuntime.setReviewHook`).
import { generateWith, type GenerateFn } from "@phoenix/ai-context";
import {
  askAboutMeetings,
  isItemKind,
  isItemStatus,
  MeetingItemService,
  searchMeetings,
  type Actor,
  type ExtractionStats,
  type ItemFilter,
  type MeetingAnswer,
  type MeetingHit,
  type MeetingItem,
  type ReviewResult,
} from "@phoenix/ai-meetings";
import type { AiService } from "@phoenix/ai-models";
import type {
  MeetingAskView,
  MeetingExtractionView,
  MeetingHitView,
  MeetingItemListView,
  MeetingItemView,
  MeetingReviewApi,
  MeetingReviewResultView,
  MeetingSearchView,
} from "@phoenix/api";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database, MeetingStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { MemoryRuntime } from "./memory";
import type { RetrievalRuntime } from "./retrieval";

/** Capabilities whose summaries are imported as proposed items. */
const IMPORT_CAPABILITIES = ["kage"];

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

function itemView(i: MeetingItem): MeetingItemView {
  return {
    id: i.id,
    meeting_id: i.meetingId,
    kind: i.kind,
    text: i.text,
    owner: i.owner,
    due: i.due,
    status: i.status,
    extracted_by: i.extractedBy,
    evidence: i.evidence
      ? {
          source: i.evidence.source,
          quote: i.evidence.quote,
          ...(i.evidence.segmentStart !== undefined
            ? { segment_start: i.evidence.segmentStart }
            : {}),
          ...(i.evidence.segmentEnd !== undefined ? { segment_end: i.evidence.segmentEnd } : {}),
          ...(i.evidence.charStart !== undefined ? { char_start: i.evidence.charStart } : {}),
          ...(i.evidence.charEnd !== undefined ? { char_end: i.evidence.charEnd } : {}),
        }
      : null,
    original: i.original,
    created_at: i.createdAt,
    reviewed_at: i.reviewedAt,
    reviewed_by: i.reviewedBy,
  };
}

const resultView = (r: ReviewResult): MeetingReviewResultView => ({
  item: itemView(r.item),
  memory: { stored: r.memory.stored, refused: r.memory.refused },
});

function statsView(s: ExtractionStats) {
  return {
    chunks: s.chunks,
    chars_skipped: s.charsSkipped,
    proposed: s.proposed,
    grounded: s.grounded,
    dropped: { ...s.dropped },
    owners_dropped: s.ownersDropped,
    dues_dropped: s.duesDropped,
    ignored_fields: s.ignoredFields,
    duplicates: s.duplicates,
    capped: s.capped,
    unparseable_chunks: s.unparseableChunks,
    failed_chunks: s.failedChunks,
  };
}

function hitView(h: MeetingHit): MeetingHitView {
  return {
    meeting_id: h.citation.meetingId,
    item_id: h.citation.itemId,
    memory_id: h.citation.memoryId,
    text: h.text,
    origin: h.origin,
    part: h.part,
    observed_at: h.observedAt,
    freshness: h.freshness,
    score: h.score,
  };
}

export interface MeetingReviewDeps {
  db: Database;
  meetings: MeetingStore;
  memory: MemoryRuntime;
  retrieval: RetrievalRuntime;
  audit: AuditLog;
  ai: AiService;
  /** Is the AI feature switched on right now? */
  aiEnabled: () => boolean;
  logger: Logger;
}

export class MeetingReviewRuntime implements MeetingReviewApi {
  readonly service: MeetingItemService;
  private readonly stopSync: () => void;
  private syncQueued = false;
  private closed = false;

  constructor(private readonly d: MeetingReviewDeps) {
    this.service = new MeetingItemService({
      db: d.db,
      meetings: d.meetings,
      memory: d.memory.store,
      pipeline: d.memory.pipeline,
      audit: (action, details) =>
        void d.audit.record({ actor: "user", action, decision: "info", details }),
      // Read on every use: turning AI off applies to the very next extraction.
      generate: () => (d.aiEnabled() ? generateWith(d.ai) : null),
    });
    this.stopSync = d.meetings.onChange(() => this.scheduleImport());
  }

  private get actor(): Actor {
    const { viewer } = this.d.memory.agentContext();
    return { id: viewer.id, viewer };
  }

  // ── Import after the meeting sync ──────────────────────────────────────────

  private scheduleImport(): void {
    if (this.syncQueued || this.closed) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      this.importAll();
    });
  }

  /** Kage's own items for every synced meeting that has a summary. Local, no model. */
  importAll(): { imported: number } {
    let imported = 0;
    if (this.closed) return { imported };
    const all = [
      ...this.d.meetings.list({ limit: 500 }),
      ...this.d.meetings.list({ archived: true, limit: 500 }),
    ];
    for (const meeting of all) {
      if (!IMPORT_CAPABILITIES.includes(meeting.capability_id) || !meeting.has_summary) continue;
      try {
        imported += this.service.importKage(meeting.id).imported;
      } catch (err) {
        this.d.logger.warn("meeting review: import failed", { error: (err as Error).message });
      }
    }
    return { imported };
  }

  /** Re-derives memory facts from accepted items, for example after sensitive meetings were allowed. */
  resyncMemory(): void {
    if (this.closed) return;
    for (const meeting of this.d.meetings.list({ limit: 500 })) {
      this.service.syncMemory(meeting.id);
    }
  }

  /** The Memory tab forgot reviewed facts: their items are rejected so none shows as accepted. */
  private rejectForgotten(itemIds: readonly string[]): void {
    for (const id of itemIds) {
      try {
        const item = this.service.items.get(id);
        if (item?.status === "accepted") this.service.reject(id, this.actor);
      } catch (err) {
        this.d.logger.warn("meeting review: could not reject a forgotten item", {
          error: (err as Error).message,
        });
      }
    }
  }

  close(): void {
    this.closed = true;
    this.stopSync();
  }

  // ── MeetingReviewApi ───────────────────────────────────────────────────────

  list(meetingId: string, filter: { status?: string; kind?: string }): MeetingItemListView {
    if (filter.status !== undefined && !isItemStatus(filter.status)) {
      throw invalid("Unknown status");
    }
    if (filter.kind !== undefined && !isItemKind(filter.kind)) throw invalid("Unknown kind");
    const itemFilter: ItemFilter = {
      ...(filter.status !== undefined && isItemStatus(filter.status)
        ? { status: filter.status }
        : {}),
      ...(filter.kind !== undefined && isItemKind(filter.kind) ? { kind: filter.kind } : {}),
    };
    const items = this.service.list(meetingId, itemFilter, this.actor);
    return {
      meeting_id: meetingId,
      items: items.map(itemView),
      counts: this.service.counts(meetingId, this.actor),
    };
  }

  async extract(meetingId: string): Promise<MeetingExtractionView> {
    const report = await this.service.extract(meetingId, { useAi: true });
    return {
      meeting_id: meetingId,
      has_transcript: report.ai !== null,
      kage: { ...report.kage },
      ai: report.ai
        ? {
            stored: report.ai.stored,
            unavailable: report.ai.unavailable,
            stats: statsView(report.ai.stats),
          }
        : null,
      counts: this.service.counts(meetingId, this.actor),
    };
  }

  add(
    meetingId: string,
    input: { kind: string; text: string; owner?: string | null; due?: string | null },
  ): MeetingReviewResultView {
    if (!isItemKind(input.kind)) throw invalid("Unknown item kind");
    return resultView(
      this.service.addManual(
        meetingId,
        {
          kind: input.kind,
          text: input.text,
          owner: input.owner?.trim() || null,
          due: input.due?.trim() || null,
        },
        this.actor,
      ),
    );
  }

  accept(itemId: string): MeetingReviewResultView {
    return resultView(this.service.accept(itemId, this.actor));
  }

  reject(itemId: string): MeetingReviewResultView {
    return resultView(this.service.reject(itemId, this.actor));
  }

  reopen(itemId: string): MeetingReviewResultView {
    return resultView(this.service.reopen(itemId, this.actor));
  }

  edit(
    itemId: string,
    change: { text: string; owner?: string | null; due?: string | null },
  ): MeetingReviewResultView {
    return resultView(this.service.edit(itemId, change, this.actor));
  }

  async search(query: string, limit: number): Promise<MeetingSearchView> {
    const { viewer } = this.d.memory.agentContext();
    const found = await this.d.retrieval.searchMeetings(query, viewer, limit);
    if (found.kind === "lexical") {
      const result = searchMeetings(
        { store: this.d.memory.store, now: () => new Date() },
        query,
        viewer,
        limit,
      );
      return {
        query: result.query,
        hits: result.hits.map(hitView),
        total: result.total,
        retrieval: found.info,
      };
    }
    return { query, hits: found.hits.map(hitView), total: found.hits.length, retrieval: found.info };
  }

  async ask(question: string): Promise<MeetingAskView> {
    const { viewer } = this.d.memory.agentContext();
    const prepared = await this.d.retrieval.preparedEngine({
      question: question.slice(0, 500),
      viewer,
      domains: ["meeting"],
      scopes: ["meeting:*"],
      limit: 8,
      tokenBudget: 1500,
    });
    const engine = prepared.engine ?? this.d.memory.agentContext().engine;
    const generate: GenerateFn | null = this.d.aiEnabled() ? generateWith(this.d.ai) : null;
    const answer: MeetingAnswer = await askAboutMeetings(engine, generate, question, viewer);
    return {
      question: answer.question,
      facts: answer.citations.map((c) => ({
        ref: c.ref,
        text: c.text,
        meeting_id: c.citation.meetingId,
        item_id: c.citation.itemId,
        memory_id: c.citation.memoryId,
        origin: c.origin,
      })),
      interpretation: answer.answer.interpretation,
      processed_by: answer.answer.model?.processedBy ?? null,
      ai_used: answer.answer.interpretation !== null,
      note: answer.answer.noInterpretationReason,
      retrieval: prepared.info,
    };
  }
}
