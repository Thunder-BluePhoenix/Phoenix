// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import type { CaptureOutcome } from "../pipeline";

/** What one ingest run did. Refusals carry their reason; nothing is dropped silently. */
export interface IngestReport {
  stored: number;
  duplicate: number;
  /** Skipped because the user deleted this memory earlier. */
  tombstoned: number;
  refused: { reason: string; count: number }[];
  rejected: { reason: string; count: number }[];
  /** Memories removed because their source no longer says them. */
  removed: number;
  /** Sources skipped before capture (too large, unreadable), with the reason. */
  skipped: { source: string; reason: string }[];
}

export function emptyReport(): IngestReport {
  return {
    stored: 0,
    duplicate: 0,
    tombstoned: 0,
    refused: [],
    rejected: [],
    removed: 0,
    skipped: [],
  };
}

function bump(list: { reason: string; count: number }[], reason: string): void {
  const found = list.find((e) => e.reason === reason);
  if (found) found.count++;
  else list.push({ reason, count: 1 });
}

export function tally(report: IngestReport, outcome: CaptureOutcome): void {
  if (outcome.status === "refused") bump(report.refused, outcome.reason);
  else if (outcome.status === "rejected") bump(report.rejected, outcome.reason);
  else report[outcome.status]++;
}

/** True when every capture was stored, already known, or deliberately deleted by the user. */
export function isClean(report: IngestReport): boolean {
  return report.refused.length === 0 && report.rejected.length === 0;
}

/** Short stable digest used inside dedupe keys. */
export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
