// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations";

export type Database = DatabaseSync;

/**
 * Opens (or creates) the Phoenix database and applies pending migrations.
 * Pass ":memory:" for an in-memory database.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export class DatabaseInUseError extends Error {
  override name = "DatabaseInUseError";
  constructor(path: string) {
    super(
      `Another Phoenix Core is already using ${dirname(path)}. Stop it first, or set PHOENIX_DATA_DIR to a different folder.`,
    );
  }
}

/**
 * Claims the data directory for this process and returns a function that gives it up.
 *
 * Two Cores on one database each keep their own state, and the second would replace the first's
 * session token, locking its clients out. The claim is an exclusive SQLite lock held on a
 * separate `<db>.lock` file, so the database itself stays readable by other tools. The operating
 * system drops the lock when the process dies, so a crash never leaves a stale one behind.
 */
export function lockDatabaseFile(path: string): () => void {
  if (path === ":memory:") return () => {};
  mkdirSync(dirname(path), { recursive: true });
  const lock = new DatabaseSync(`${path}.lock`);
  try {
    lock.exec("PRAGMA busy_timeout = 0");
    lock.exec("BEGIN EXCLUSIVE");
  } catch (err) {
    lock.close();
    if ((err as { errcode?: number }).errcode === 5) throw new DatabaseInUseError(path);
    throw err;
  }
  return () => {
    lock.exec("ROLLBACK");
    lock.close();
  };
}

export class DatabaseTooNewError extends Error {
  override name = "DatabaseTooNewError";
  constructor(found: number, known: number) {
    super(
      `This database was written by a newer Phoenix (schema ${found}; this version understands up to ${known}). ` +
        "Update Phoenix, or point PHOENIX_DATA_DIR at a different folder. It was not modified.",
    );
  }
}

export function migrate(db: Database): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as {
    v: number;
  };
  // Running old code over a newer schema would write rows it does not understand.
  const known = MIGRATIONS.at(-1)?.version ?? 0;
  if (row.v > known) throw new DatabaseTooNewError(row.v, known);
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (m.version <= row.v) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      applied++;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return applied;
}

export function schemaVersion(db: Database): number {
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as {
    v: number;
  };
  return row.v;
}
