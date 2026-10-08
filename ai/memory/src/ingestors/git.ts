// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PhoenixEvent } from "@phoenix/protocol";
import type { MemoryPipeline, RawCapture } from "../pipeline";
import { emptyReport, tally, type IngestReport } from "./report";

export const GIT_SOURCE = "git";
export const GIT_COMMIT_EVENT = "git.commit.created";

/** One commit as a git capability or a `git log` reader reports it. */
export interface CommitRecord {
  repository: string;
  sha: string;
  branch?: string | null;
  message: string;
  /** When the commit was made (ISO). */
  at: string;
  /** Id of the event that reported it, when it came from one. */
  eventId?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Reads `git.commit.created`. Returns null when the event is not one or lacks repository/sha. */
export function commitFromEvent(event: PhoenixEvent): CommitRecord | null {
  if (event.event_type !== GIT_COMMIT_EVENT) return null;
  const repository = str(event.payload.repository);
  const sha = str(event.payload.sha);
  if (!repository || !sha) return null;
  return {
    repository,
    sha,
    branch: str(event.payload.branch) ?? null,
    message: str(event.payload.message) ?? "",
    at: event.timestamp,
    eventId: event.event_id,
  };
}

/** Builds the capture for one commit. The text only restates what the commit reported. */
export function commitCapture(c: CommitRecord): RawCapture {
  const where = c.branch ? ` on ${c.branch}` : "";
  const subject = c.message.trim() ? `: ${c.message.trim()}` : "";
  return {
    source: GIT_SOURCE,
    sourceRef: c.repository,
    scope: `repo:${c.repository}`,
    contentType: "commit",
    text: `Commit ${c.sha.slice(0, 7)}${where} in ${c.repository}${subject}`,
    observedAt: c.at,
    dedupeKey: `git:${c.repository}:${c.sha}`,
    provenance: {
      repository: c.repository,
      sha: c.sha,
      ...(c.branch ? { branch: c.branch } : {}),
      ...(c.eventId ? { event_id: c.eventId } : {}),
    },
  };
}

/** Subscribe-side entry point: one live event. Other event types are ignored (empty report). */
export function ingestGitEvent(pipeline: MemoryPipeline, event: PhoenixEvent): IngestReport {
  const report = emptyReport();
  const commit = commitFromEvent(event);
  if (commit) tally(report, pipeline.capture(commitCapture(commit)));
  return report;
}

/** Backfill: commits read from history. Re-running it stores nothing new. */
export function ingestCommits(
  pipeline: MemoryPipeline,
  commits: readonly CommitRecord[],
): IngestReport {
  const report = emptyReport();
  for (const c of commits) tally(report, pipeline.capture(commitCapture(c)));
  return report;
}

const FIELD = "\u001f";
const RECORD = "\u001e";
/** Format string for `git log` that parseGitLog understands. */
export const GIT_LOG_FORMAT = `--format=${RECORD}%H${FIELD}%cI${FIELD}%s`;

/**
 * Parses `git log` output produced with GIT_LOG_FORMAT. Malformed records are skipped, not
 * guessed at.
 */
export function parseGitLog(repository: string, output: string, branch?: string): CommitRecord[] {
  const out: CommitRecord[] = [];
  for (const record of output.split(RECORD)) {
    const [sha, at, ...rest] = record.trim().split(FIELD);
    if (!sha || !at || !/^[0-9a-f]{7,64}$/.test(sha) || Number.isNaN(Date.parse(at))) continue;
    out.push({ repository, sha, at, message: rest.join(FIELD).trim(), branch: branch ?? null });
  }
  return out;
}
