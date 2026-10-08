// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Meetings → memory. Only what the meeting capability extracted is stored: the summary text, each
// decision and each action item. Transcripts are NOT stored as memory in Phase 28: they are the
// most sensitive text Phoenix holds and far too large to index usefully; the summary already
// carries what was decided. Phase 29 (sensitive-data rules) and Phase 35 revisit this.
import type { Meeting, Summary } from "@phoenix/persistence";
import type { MemoryPipeline, RawCapture } from "../pipeline";
import type { MemoryStore } from "../store";
import { digest, emptyReport, tally, type IngestReport } from "./report";

/** The part of MeetingStore the ingestor needs. A MeetingStore satisfies it. */
export interface MeetingReader {
  list(options?: { archived?: boolean; limit?: number }): Meeting[];
  summary(id: string): Summary | null;
}

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * An action item as text, or null when its shape is unknown. Accepts a string or an object with a
 * `text` (and optionally `owner`, `due`); it never fills in anything the item did not say.
 */
export function actionItemText(item: unknown): string | null {
  if (typeof item === "string") return text(item) ?? null;
  if (item === null || typeof item !== "object" || !("text" in item)) return null;
  const body = text(item.text);
  if (!body) return null;
  const owner = "owner" in item ? text(item.owner) : undefined;
  const due = "due" in item ? text(item.due) : undefined;
  const extra = [owner ? `owner: ${owner}` : "", due ? `due: ${due}` : ""].filter(Boolean);
  return extra.length ? `${body} (${extra.join(", ")})` : body;
}

/** Captures for one meeting's summary, decisions and action items. All are facts Kage extracted. */
export function meetingCaptures(meeting: Meeting, summary: Summary): RawCapture[] {
  const observedAt = meeting.started_at ?? meeting.ended_at ?? meeting.updated_at;
  const title = meeting.title ?? `Meeting ${meeting.external_id}`;
  const base = {
    source: meeting.capability_id,
    sourceRef: meeting.id,
    scope: `meeting:${meeting.id}`,
    observedAt,
  };
  const provenance = (part: string) => ({
    meeting_id: meeting.id,
    capability: meeting.capability_id,
    external_id: meeting.external_id,
    part,
  });
  const captures: RawCapture[] = [];
  const summaryText = text(summary.text);
  if (summaryText) {
    captures.push({
      ...base,
      contentType: "meeting_summary",
      text: `Summary of "${title}": ${summaryText}`,
      dedupeKey: `meeting:${meeting.id}:summary:${digest(summaryText)}`,
      provenance: provenance("summary"),
    });
  }
  for (const decision of summary.decisions ?? []) {
    const body = text(decision);
    if (!body) continue;
    captures.push({
      ...base,
      contentType: "meeting_decision",
      text: `Decision in "${title}": ${body}`,
      dedupeKey: `meeting:${meeting.id}:decision:${digest(body)}`,
      provenance: provenance("decision"),
    });
  }
  for (const item of summary.action_items ?? []) {
    const body = actionItemText(item);
    if (!body) continue;
    captures.push({
      ...base,
      contentType: "meeting_action_item",
      text: `Action item in "${title}": ${body}`,
      dedupeKey: `meeting:${meeting.id}:action:${digest(body)}`,
      provenance: provenance("action_item"),
    });
  }
  return captures;
}

export interface MeetingIngestOptions {
  pipeline: MemoryPipeline;
  store: MemoryStore;
  meetings: MeetingReader;
  /** Capability ids whose meetings are synced, for example ["kage"]. */
  capabilities: readonly string[];
}

/**
 * Syncs meeting memories with the MeetingStore: new summaries, decisions and action items are
 * captured; items the summary no longer contains and meetings that were deleted are removed.
 * Run it whenever a meeting summary changes (the runtime hooks it where syncMeetings stores one).
 */
export function ingestMeetings(options: MeetingIngestOptions): IngestReport {
  const { pipeline, store, meetings } = options;
  const report = emptyReport();
  const present: Record<string, true> = {};
  const all = [...meetings.list({ limit: 500 }), ...meetings.list({ archived: true, limit: 500 })];
  for (const meeting of all) {
    if (!options.capabilities.includes(meeting.capability_id)) continue;
    present[meeting.id] = true;
    const summary = meetings.summary(meeting.id);
    const captures = summary ? meetingCaptures(meeting, summary) : [];
    for (const capture of captures) tally(report, pipeline.capture(capture));
    report.removed += store.purge({
      source: meeting.capability_id,
      domain: "meeting",
      sourceRef: meeting.id,
      keepKeys: captures.map((c) => c.dedupeKey),
    });
  }
  for (const capability of options.capabilities) {
    const gone = store
      .sourceRefs({ source: capability, domain: "meeting" })
      .filter((ref) => present[ref] !== true);
    for (const ref of gone) {
      report.removed += store.purge({ source: capability, domain: "meeting", sourceRef: ref });
    }
  }
  return report;
}
