// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "./database";

/** Metadata of one agent-session checkpoint (migration 31). The snapshot itself lives in git. */
export interface CheckpointRow {
  id: string;
  sessionId: string;
  agent: string;
  /** Absolute path of the repository's working tree. */
  project: string;
  /** `refs/phoenix/checkpoints/<id>` in that repository. */
  ref: string;
  /** The snapshot commit. */
  commitId: string;
  /** The repository's HEAD commit when the checkpoint was taken; null for an unborn HEAD. */
  headId: string | null;
  fileCount: number;
  createdAt: string;
  expiresAt: string;
  rolledBackAt: string | null;
}

interface Raw {
  id: string;
  session_id: string;
  agent: string;
  project: string;
  ref: string;
  commit_id: string;
  head_id: string | null;
  file_count: number;
  created_at: string;
  expires_at: string;
  rolled_back_at: string | null;
}

const COLUMNS =
  "id, session_id, agent, project, ref, commit_id, head_id, file_count, created_at, expires_at, rolled_back_at";

const row = (r: Raw): CheckpointRow => ({
  id: r.id,
  sessionId: r.session_id,
  agent: r.agent,
  project: r.project,
  ref: r.ref,
  commitId: r.commit_id,
  headId: r.head_id,
  fileCount: Number(r.file_count),
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  rolledBackAt: r.rolled_back_at,
});

/** Checkpoint metadata. Holds no file names and no file content. */
export class CheckpointStore {
  constructor(private readonly db: Database) {}

  insert(c: CheckpointRow): void {
    this.db
      .prepare(
        `INSERT INTO agent_checkpoints (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.sessionId,
        c.agent,
        c.project,
        c.ref,
        c.commitId,
        c.headId,
        c.fileCount,
        c.createdAt,
        c.expiresAt,
        c.rolledBackAt,
      );
  }

  get(id: string): CheckpointRow | undefined {
    const found = this.db
      .prepare(`SELECT ${COLUMNS} FROM agent_checkpoints WHERE id = ?`)
      .get(id) as Raw | undefined;
    return found ? row(found) : undefined;
  }

  /** Newest first. */
  list(limit = 200): CheckpointRow[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM agent_checkpoints ORDER BY created_at DESC, id LIMIT ?`)
        .all(limit) as unknown as Raw[]
    ).map(row);
  }

  every(): CheckpointRow[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM agent_checkpoints ORDER BY created_at, id`)
        .all() as unknown as Raw[]
    ).map(row);
  }

  hasSession(agent: string, sessionId: string): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 AS yes FROM agent_checkpoints WHERE agent = ? AND session_id = ? LIMIT 1",
        )
        .get(agent, sessionId) !== undefined
    );
  }

  /** Rows whose expiry is at or before `nowIso`. */
  expired(nowIso: string): CheckpointRow[] {
    return (
      this.db
        .prepare(
          `SELECT ${COLUMNS} FROM agent_checkpoints WHERE expires_at <= ? ORDER BY created_at`,
        )
        .all(nowIso) as unknown as Raw[]
    ).map(row);
  }

  markRolledBack(id: string, at: string): boolean {
    return (
      this.db.prepare("UPDATE agent_checkpoints SET rolled_back_at = ? WHERE id = ?").run(at, id)
        .changes > 0
    );
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM agent_checkpoints WHERE id = ?").run(id).changes > 0;
  }

  deleteAll(): number {
    return Number(this.db.prepare("DELETE FROM agent_checkpoints").run().changes);
  }

  count(): number {
    const found = this.db.prepare("SELECT COUNT(*) AS n FROM agent_checkpoints").get() as
      { n: number } | undefined;
    return found?.n ?? 0;
  }
}
