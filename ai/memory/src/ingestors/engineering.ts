// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Only curated, structured capability output belongs here. Do not pass bodies, transcripts,
// comments, chat messages, deployment logs, incident timelines or prompt/completion text.
import { createHash } from "node:crypto";
import type { PrivacyClass } from "@phoenix/ai-models";
import type { MemoryPipeline, RawCapture } from "../pipeline";
import type { MemoryStore } from "../store";
import type { MemoryDomain } from "../types";
import { emptyReport, tally, type IngestReport } from "./report";

export const ENGINEERING_DOMAINS = [
  "repo",
  "pr",
  "issue",
  "meeting",
  "decision",
  "architecture",
  "deployment",
  "infra",
  "people",
  "incident",
  "fawkes",
] as const satisfies readonly MemoryDomain[];
export type EngineeringDomain = (typeof ENGINEERING_DOMAINS)[number];
/** Closed vocabulary: arbitrary prose belongs in its source, not the memory index. */
export const ENGINEERING_STATES = [
  "created",
  "updated",
  "opened",
  "closed",
  "merged",
  "reopened",
  "assigned",
  "approved",
  "rejected",
  "adopted",
  "superseded",
  "planned",
  "started",
  "succeeded",
  "failed",
  "rolled_back",
  "resolved",
  "mitigated",
  "active",
  "inactive",
  "deleted",
  "joined",
  "left",
  "requested",
  "completed",
  "cancelled",
] as const;
export type EngineeringState = (typeof ENGINEERING_STATES)[number];

/** A source-authenticated structured observation, not an arbitrary body of untrusted text. */
export interface EngineeringRecord {
  domain: EngineeringDomain;
  /** Enabled capability id. The runtime must authenticate the producer, not trust a payload source. */
  source: string;
  /** Stable source object id, e.g. repo id, PR number, deployment id. */
  sourceRef: string;
  /** Stable event/revision id; changed observations use a new id. */
  recordId: string;
  /** Permission boundary, e.g. repo:org/name or incident:123. */
  scope: string;
  observedAt: string;
  sensitivity: PrivacyClass;
  /** Source assertion or merely retrieved evidence; never use 'fact' for model deductions. */
  evidenceKind: "fact" | "evidence";
  /** Controlled object label, e.g. PR #42, deployment web-prod, or incident INC-1. */
  subject: string;
  /** Controlled state/action, e.g. merged, failed, assigned, adopted. No free-form body. */
  state: EngineeringState;
  /** Where the assertion originated. For generated summaries use evidenceKind=evidence. */
  evidenceId: string;
  confidence: number;
  freshnessTtlDays: number;
  retentionDays: number;
}

/** Capture only metadata-sized curated fields; never store raw event payloads in provenance. */
export function engineeringCapture(record: EngineeringRecord): RawCapture | null {
  if (
    !ENGINEERING_DOMAINS.includes(record.domain) ||
    !["public", "internal", "sensitive"].includes(record.sensitivity) ||
    !["fact", "evidence"].includes(record.evidenceKind) ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1 ||
    !Number.isFinite(record.freshnessTtlDays) ||
    record.freshnessTtlDays < 0 ||
    !Number.isFinite(record.retentionDays) ||
    record.retentionDays < 0
  )
    return null;
  if (!(ENGINEERING_STATES as readonly string[]).includes(record.state)) return null;
  // Labels must be identifiers rather than sentences, URLs, quoted bodies or path contents.
  if (
    typeof record.subject !== "string" ||
    record.subject.length > 80 ||
    !/^[\p{L}\p{N}_#./:@-]+(?: [\p{L}\p{N}_#./:@-]+){0,3}$/u.test(record.subject)
  )
    return null;
  const fields = [
    record.source,
    record.sourceRef,
    record.recordId,
    record.scope,
    record.subject,
    record.state,
    record.evidenceId,
  ];
  if (
    fields.some(
      (field) =>
        typeof field !== "string" ||
        !field.trim() ||
        field.length > 256 ||
        /[\r\n\x00-\x1f]/.test(field),
    )
  )
    return null;
  // Provenance fields are retained verbatim: reject secret-shaped identifiers rather than relying
  // on a redactor to preserve identity after modifying a dedupe key.
  if (
    fields.some((field) =>
      /gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN /i.test(field),
    )
  )
    return null;
  if (
    (record.domain === "pr" || record.domain === "repo" || record.domain === "issue") &&
    !record.scope.startsWith("repo:") &&
    !(
      record.domain === "issue" &&
      record.source === "issues" &&
      (record.sourceRef.startsWith("linear:") || record.sourceRef.startsWith("jira:")) &&
      record.scope === `issue:${record.sourceRef}`
    )
  )
    return null;
  if (record.domain === "meeting" && !record.scope.startsWith("meeting:")) return null;
  if (record.domain === "incident" && !record.scope.startsWith("incident:")) return null;
  if (record.domain === "fawkes" && record.sensitivity !== "sensitive") return null;
  if (record.domain === "people" && record.sensitivity !== "sensitive") return null;
  if (!Number.isFinite(Date.parse(record.observedAt))) return null;
  return {
    source: record.source,
    sourceRef: record.sourceRef,
    scope: record.scope,
    contentType: record.evidenceKind === "fact" ? "engineering_fact" : "engineering_evidence",
    domain: record.domain,
    kind: record.evidenceKind,
    text: `${record.domain} ${record.subject}: ${record.state}`,
    observedAt: record.observedAt,
    dedupeKey: `engineering:${createHash("sha256")
      .update(
        JSON.stringify([
          record.source,
          record.domain,
          record.sourceRef,
          record.recordId,
          record.evidenceKind,
          record.subject,
          record.state,
          record.scope,
          record.sensitivity,
        ]),
      )
      .digest("hex")}`,
    sensitivity: record.sensitivity,
    confidence: record.confidence,
    freshnessTtlDays: record.freshnessTtlDays,
    retentionDays: record.retentionDays,
    provenance: { evidence_id: record.evidenceId, record_id: record.recordId },
  };
}

export function ingestEngineeringRecords(
  pipeline: MemoryPipeline,
  records: readonly EngineeringRecord[],
): IngestReport {
  const report = emptyReport();
  for (const record of records) {
    const capture = engineeringCapture(record);
    if (capture) tally(report, pipeline.capture(capture));
    else {
      const invalid = report.rejected.find(
        (entry) => entry.reason === "invalid_engineering_record",
      );
      if (invalid) invalid.count++;
      else report.rejected.push({ reason: "invalid_engineering_record", count: 1 });
    }
  }
  return report;
}

/** Authoritative source snapshot. Only call with complete records for this source/ref. */
export function syncEngineeringRecords(
  pipeline: MemoryPipeline,
  store: MemoryStore,
  source: string,
  domain: EngineeringDomain,
  sourceRef: string,
  records: readonly EngineeringRecord[],
): IngestReport {
  if (records.length === 0) throw new Error("Empty snapshot is not proof of source deletion");
  if (
    records.some((r) => r.source !== source || r.domain !== domain || r.sourceRef !== sourceRef)
  ) {
    throw new Error("Engineering snapshot contains records outside its source boundary");
  }
  const captures: RawCapture[] = [];
  for (const record of records) {
    const capture = engineeringCapture(record);
    if (capture === null) throw new Error("Engineering snapshot contains invalid records");
    captures.push(capture);
  }
  const report = emptyReport();
  for (const capture of captures) tally(report, pipeline.capture(capture));
  // Refused/invalid snapshots must not erase good records. The producer must explicitly call
  // store.purge after a verified deletion, not infer deletion from an empty/failed sync.
  if (report.refused.length || report.rejected.length) return report;
  const keys = captures.map((capture) => capture.dedupeKey);
  report.removed += store.purge({ source, domain, sourceRef, keepKeys: keys });
  return report;
}
