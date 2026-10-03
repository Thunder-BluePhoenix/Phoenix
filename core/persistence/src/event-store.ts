// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PhoenixEvent } from "@phoenix/protocol";
import type { Database } from "./database";

export interface EventQuery {
  limit?: number;
  /** Return events with seq greater than this (for resuming streams). */
  afterSeq?: number;
  source?: string;
  /** Exact type or namespace prefix ending in ".*" */
  type?: string;
}

export interface StoredEvent {
  seq: number;
  event: PhoenixEvent;
}

/** Durable local event history (bounded by `limit`). */
export class EventStore {
  private seq: number;

  constructor(
    private readonly db: Database,
    private readonly historyLimit = 10_000,
  ) {
    const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM events").get() as { s: number };
    this.seq = row.s;
  }

  has(eventId: string): boolean {
    return this.db.prepare("SELECT 1 FROM events WHERE event_id = ?").get(eventId) !== undefined;
  }

  /** Inserts the event; returns its sequence number, or null if it already exists. */
  append(event: PhoenixEvent, receivedAt = new Date()): number | null {
    const seq = this.seq + 1;
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events
          (event_id, event_type, source, severity, timestamp, correlation_id, envelope, received_at, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.event_id,
        event.event_type,
        event.source,
        event.severity,
        event.timestamp,
        event.correlation_id ?? null,
        JSON.stringify(event),
        receivedAt.toISOString(),
        seq,
      );
    if (result.changes === 0) return null;
    this.seq = seq;
    if (seq % 100 === 0) this.prune();
    return seq;
  }

  /** Most recent events first. */
  recent(query: EventQuery = {}): StoredEvent[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.afterSeq !== undefined) {
      where.push("seq > ?");
      params.push(query.afterSeq);
    }
    if (query.source) {
      where.push("source = ?");
      params.push(query.source);
    }
    if (query.type) {
      if (query.type.endsWith(".*")) {
        where.push("event_type LIKE ? ESCAPE '\\'");
        params.push(query.type.slice(0, -1).replace(/[%_\\]/g, (c) => `\\${c}`) + "%");
      } else {
        where.push("event_type = ?");
        params.push(query.type);
      }
    }
    const sql = `SELECT seq, envelope FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY seq DESC LIMIT ?`;
    params.push(Math.min(Math.max(query.limit ?? 100, 1), 1000));
    const rows = this.db.prepare(sql).all(...params) as { seq: number; envelope: string }[];
    return rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.envelope) as PhoenixEvent }));
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  }

  /** Deletes the oldest events beyond the history limit. */
  prune(): number {
    return Number(
      this.db.prepare("DELETE FROM events WHERE seq <= ?").run(this.seq - this.historyLimit)
        .changes,
    );
  }
}

export interface DeadLetter {
  id: number;
  eventId: string;
  subscriber: string;
  error: string;
  attempts: number;
  event: PhoenixEvent;
  failedAt: string;
}

export class DeadLetterStore {
  constructor(private readonly db: Database) {}

  add(event: PhoenixEvent, subscriber: string, error: string, attempts: number): void {
    this.db
      .prepare(
        "INSERT INTO dead_letters (event_id, subscriber, error, attempts, envelope, failed_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.event_id,
        subscriber,
        error,
        attempts,
        JSON.stringify(event),
        new Date().toISOString(),
      );
  }

  list(limit = 100): DeadLetter[] {
    const rows = this.db
      .prepare("SELECT * FROM dead_letters ORDER BY id DESC LIMIT ?")
      .all(limit) as Record<string, string | number>[];
    return rows.map((r) => ({
      id: Number(r.id),
      eventId: String(r.event_id),
      subscriber: String(r.subscriber),
      error: String(r.error),
      attempts: Number(r.attempts),
      event: JSON.parse(String(r.envelope)) as PhoenixEvent,
      failedAt: String(r.failed_at),
    }));
  }
}
