// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Append-only. Never edit a migration that has shipped; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        severity TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        correlation_id TEXT,
        envelope TEXT NOT NULL,
        received_at TEXT NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX events_seq ON events (seq);
      CREATE INDEX events_type ON events (event_type);
      CREATE INDEX events_correlation ON events (correlation_id);

      CREATE TABLE dead_letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        subscriber TEXT NOT NULL,
        error TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        envelope TEXT NOT NULL,
        failed_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE capabilities (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        manifest TEXT NOT NULL,
        config TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE credentials (
        id TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL,
        -- Reference into the OS secret store. The secret itself is never stored here.
        secret_ref TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE pet_profile (
        id TEXT PRIMARY KEY,
        character TEXT NOT NULL,
        settings TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "permissions-and-audit",
    sql: `
      CREATE TABLE permission_grants (
        capability_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (capability_id, permission)
      );

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        capability_id TEXT,
        decision TEXT NOT NULL,
        details TEXT NOT NULL
      );
      CREATE INDEX audit_capability ON audit_log (capability_id);
    `,
  },
  {
    version: 3,
    name: "capability-transport",
    sql: `
      ALTER TABLE capabilities ADD COLUMN kind TEXT NOT NULL DEFAULT 'builtin';
      ALTER TABLE capabilities ADD COLUMN endpoint TEXT;
    `,
  },
  {
    version: 4,
    name: "notification-details",
    sql: `
      ALTER TABLE notifications ADD COLUMN source TEXT;
      ALTER TABLE notifications ADD COLUMN event_type TEXT;
      CREATE INDEX notifications_created ON notifications (created_at);
    `,
  },
  {
    version: 5,
    name: "meetings",
    sql: `
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,            -- "<capability>:<external id>"
        capability_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        duration_seconds INTEGER,
        participants TEXT,              -- JSON array
        recording TEXT,                 -- JSON reference {location, retention}; never the media itself
        transcript TEXT,                -- JSON {text, segments}
        summary TEXT,                   -- JSON {text, topics, decisions, action_items, ...}
        archived_at TEXT,
        deleted_at TEXT,                -- tombstone: content purged and never re-imported
        updated_at TEXT NOT NULL
      );
      CREATE INDEX meetings_updated ON meetings (updated_at);
    `,
  },
];
