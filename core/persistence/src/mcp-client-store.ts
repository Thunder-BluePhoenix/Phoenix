// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "./database";

export interface McpClientRecord {
  id: string;
  name: string;
  /** SHA-256 of the client token, 64 lowercase hex characters. The token itself is never stored. */
  tokenHash: string;
  /** What the owner allowed, as the JSON the runtime wrote; `null` when the stored text is damaged. */
  grants: unknown;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface ClientRow {
  id: string;
  name: string;
  token_hash: string;
  grants: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface CountRow {
  n: number;
}

const COLUMNS = "id, name, token_hash, grants, created_at, last_used_at, revoked_at";

function parseGrants(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A damaged value reads as "no grants": the runtime treats `null` as nothing allowed.
    return null;
  }
}

const row = (value: ClientRow): McpClientRecord => ({
  id: value.id,
  name: value.name,
  tokenHash: value.token_hash,
  grants: parseGrants(value.grants),
  createdAt: value.created_at,
  lastUsedAt: value.last_used_at,
  revokedAt: value.revoked_at,
});

/** MCP clients (Phase 76): one row per client; only the SHA-256 of its token is kept. */
export class McpClientStore {
  constructor(private readonly db: Database) {}

  create(client: {
    id: string;
    name: string;
    tokenHash: string;
    grants: unknown;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO mcp_clients (id, name, token_hash, grants, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
      )
      .run(
        client.id,
        client.name,
        client.tokenHash,
        JSON.stringify(client.grants),
        client.createdAt,
      );
  }

  get(id: string): McpClientRecord | undefined {
    const found = this.db.prepare(`SELECT ${COLUMNS} FROM mcp_clients WHERE id = ?`).get(id) as
      ClientRow | undefined;
    return found ? row(found) : undefined;
  }

  /** The lookup every request does: the unique hash index is the comparison. */
  getByHash(tokenHash: string): McpClientRecord | undefined {
    const found = this.db
      .prepare(`SELECT ${COLUMNS} FROM mcp_clients WHERE token_hash = ?`)
      .get(tokenHash) as ClientRow | undefined;
    return found ? row(found) : undefined;
  }

  list(): McpClientRecord[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM mcp_clients ORDER BY created_at DESC, id`)
        .all() as unknown as ClientRow[]
    ).map(row);
  }

  touch(id: string, usedAt: string): void {
    this.db.prepare("UPDATE mcp_clients SET last_used_at = ? WHERE id = ?").run(usedAt, id);
  }

  /** Replaces the grants of a client that is not revoked. */
  setGrants(id: string, grants: unknown): boolean {
    return (
      this.db
        .prepare("UPDATE mcp_clients SET grants = ? WHERE id = ? AND revoked_at IS NULL")
        .run(JSON.stringify(grants), id).changes > 0
    );
  }

  revoke(id: string, revokedAt: string): boolean {
    return (
      this.db
        .prepare("UPDATE mcp_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .run(revokedAt, id).changes > 0
    );
  }

  deleteAll(): number {
    return Number(this.db.prepare("DELETE FROM mcp_clients").run().changes);
  }

  count(): number {
    const found = this.db.prepare("SELECT COUNT(*) AS n FROM mcp_clients").get() as
      CountRow | undefined;
    return found?.n ?? 0;
  }

  countActive(): number {
    const found = this.db
      .prepare("SELECT COUNT(*) AS n FROM mcp_clients WHERE revoked_at IS NULL")
      .get() as CountRow | undefined;
    return found?.n ?? 0;
  }
}
