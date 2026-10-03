// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "./database";

export interface MeetingUpdate {
  capabilityId: string;
  externalId: string;
  status: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  participants?: string[];
  /** Where the recording lives and who manages its retention. Never the media itself. */
  recording?: { location: string; retention: string };
}

export interface Meeting {
  id: string;
  capability_id: string;
  external_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  participants: string[] | null;
  recording: { location: string; retention: string } | null;
  has_transcript: boolean;
  has_summary: boolean;
  archived_at: string | null;
  updated_at: string;
}

export interface Transcript {
  text: string;
  segments?: { start_ms: number; end_ms: number; speaker?: string | null; text: string }[];
}

export interface Summary {
  text: string;
  topics?: string[];
  decisions?: string[];
  action_items?: unknown[];
  follow_up_questions?: string[];
}

interface Row {
  id: string;
  capability_id: string;
  external_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  participants: string | null;
  recording: string | null;
  transcript: string | null;
  summary: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  updated_at: string;
}

const json = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

function toMeeting(r: Row): Meeting {
  return {
    id: r.id,
    capability_id: r.capability_id,
    external_id: r.external_id,
    title: r.title,
    status: r.status,
    started_at: r.started_at,
    ended_at: r.ended_at,
    duration_seconds: r.duration_seconds,
    participants: json<string[]>(r.participants),
    recording: json(r.recording),
    has_transcript: r.transcript !== null,
    has_summary: r.summary !== null,
    archived_at: r.archived_at,
    updated_at: r.updated_at,
  };
}

/** Phoenix's local record of meetings produced by meeting capabilities (Kage). */
export class MeetingStore {
  constructor(private readonly db: Database) {}

  static id(capabilityId: string, externalId: string): string {
    return `${capabilityId}:${externalId}`;
  }

  /** Creates or updates metadata. Returns null for meetings the user deleted. */
  upsert(u: MeetingUpdate): Meeting | null {
    const id = MeetingStore.id(u.capabilityId, u.externalId);
    const row = this.row(id);
    if (row?.deleted_at) return null;
    this.db
      .prepare(
        `INSERT INTO meetings (id, capability_id, external_id, title, status, started_at, ended_at,
           duration_seconds, participants, recording, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = COALESCE(excluded.title, title),
           status = excluded.status,
           started_at = COALESCE(excluded.started_at, started_at),
           ended_at = COALESCE(excluded.ended_at, ended_at),
           duration_seconds = COALESCE(excluded.duration_seconds, duration_seconds),
           participants = COALESCE(excluded.participants, participants),
           recording = COALESCE(excluded.recording, recording),
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        u.capabilityId,
        u.externalId,
        u.title ?? null,
        u.status,
        u.startedAt ?? null,
        u.endedAt ?? null,
        u.durationSeconds ?? null,
        u.participants ? JSON.stringify(u.participants) : null,
        u.recording ? JSON.stringify(u.recording) : null,
        new Date().toISOString(),
      );
    return this.get(id);
  }

  setTranscript(id: string, transcript: Transcript): void {
    this.db
      .prepare("UPDATE meetings SET transcript = ? WHERE id = ? AND deleted_at IS NULL")
      .run(JSON.stringify(transcript), id);
  }

  setSummary(id: string, summary: Summary): void {
    this.db
      .prepare("UPDATE meetings SET summary = ? WHERE id = ? AND deleted_at IS NULL")
      .run(JSON.stringify(summary), id);
  }

  list(options: { archived?: boolean; limit?: number } = {}): Meeting[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM meetings WHERE deleted_at IS NULL AND archived_at IS ${options.archived ? "NOT NULL" : "NULL"}
         ORDER BY COALESCE(started_at, updated_at) DESC LIMIT ?`,
      )
      .all(Math.min(options.limit ?? 100, 500)) as unknown as Row[];
    return rows.map(toMeeting);
  }

  get(id: string): Meeting | null {
    const r = this.row(id);
    return r && !r.deleted_at ? toMeeting(r) : null;
  }

  transcript(id: string): Transcript | null {
    const r = this.row(id);
    return r && !r.deleted_at ? json<Transcript>(r.transcript) : null;
  }

  summary(id: string): Summary | null {
    const r = this.row(id);
    return r && !r.deleted_at ? json<Summary>(r.summary) : null;
  }

  archive(id: string, archived = true): Meeting | null {
    this.db
      .prepare("UPDATE meetings SET archived_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(archived ? new Date().toISOString() : null, id);
    return this.get(id);
  }

  /** Purges Phoenix's copy and leaves a tombstone so it is not imported again. */
  delete(id: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE meetings SET title = NULL, participants = NULL, recording = NULL, transcript = NULL,
           summary = NULL, deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);
    return Number(r.changes) > 0;
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM meetings WHERE deleted_at IS NULL").get() as {
        n: number;
      }
    ).n;
  }

  /** Retention: deletes (with tombstones) meetings from before `iso`; no argument deletes all. */
  deleteBefore(iso?: string): number {
    const ids = (
      iso
        ? this.db
            .prepare(
              "SELECT id FROM meetings WHERE deleted_at IS NULL AND COALESCE(started_at, updated_at) < ?",
            )
            .all(iso)
        : this.db.prepare("SELECT id FROM meetings WHERE deleted_at IS NULL").all()
    ) as { id: string }[];
    return ids.filter((r) => this.delete(r.id)).length;
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as Row | undefined;
  }
}
