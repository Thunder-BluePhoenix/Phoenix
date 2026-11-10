// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import { redact } from "@phoenix/logging";
import type { Database } from "@phoenix/persistence";

export type AuditDecision = "allowed" | "denied" | "blocked" | "pending" | "info";

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  capabilityId?: string;
  decision: AuditDecision;
  details: Record<string, unknown>;
}

export interface AuditQuery {
  limit?: number;
  capabilityId?: string;
}

/** Domain-separation prefix of every audit entry hash. Changing it invalidates existing chains. */
export const AUDIT_HASH_DOMAIN = "phoenix-audit-v1";

/** `prev_hash` of the first chained row; rows from before the chain existed precede it. */
export const AUDIT_GENESIS_HASH = createHash("sha256")
  .update(`${AUDIT_HASH_DOMAIN}\0genesis`)
  .digest("hex");

/** What `AuditLog.verify()` reports. Counts and one row id only, never entry content. */
export interface AuditVerification {
  ok: boolean;
  /** Chained rows whose link and hash were checked and were correct. */
  checked: number;
  /** Id of the first row that breaks the chain, or null when the chain is intact. */
  firstBadId: number | null;
  /** Rows from before hash chaining existed (leading rows with no hash); accepted unchecked. */
  unchainedPrefix: number;
}

/** JSON with object keys sorted at every depth, so the same value always encodes the same way. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface HashedFields {
  prevHash: string;
  id: number;
  ts: string;
  actor: string;
  action: string;
  capabilityId: string | null;
  decision: string;
  /** The stored details text; re-encoded canonically before hashing. */
  details: string;
}

/**
 * SHA-256 over a JSON array of the fields in fixed order (a length-unambiguous encoding, so no
 * field can bleed into its neighbour), led by the domain-separation prefix.
 */
export function auditEntryHash(f: HashedFields): string {
  let details: string;
  try {
    details = canonicalJson(JSON.parse(f.details));
  } catch {
    details = `unparseable:${f.details}`;
  }
  return createHash("sha256")
    .update(
      JSON.stringify([
        AUDIT_HASH_DOMAIN,
        f.prevHash,
        f.id,
        f.ts,
        f.actor,
        f.action,
        f.capabilityId,
        f.decision,
        details,
      ]),
    )
    .digest("hex");
}

/**
 * Append-only audit trail of security-relevant decisions. Details are redacted.
 *
 * Each new row is hash-chained to the one before it. That detects accidental or partial
 * tampering (an edited, deleted or reordered row). It does NOT stop someone who can write the
 * database file from recomputing every hash from the genesis constant: the algorithm is public
 * and no secret is involved. Cutting off the newest rows is also invisible without an external
 * copy of the head hash.
 */
export class AuditLog {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  record(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
    const ts = new Date(this.now()).toISOString();
    const details = redact(entry.details) as Record<string, unknown>;
    const detailsText = JSON.stringify(details);
    const capabilityId = entry.capabilityId ?? null;
    // Reading the previous hash and inserting happen in one write transaction (BEGIN IMMEDIATE
    // takes the write lock first), so two writers can never both chain onto the same row.
    const id = this.inWriteTransaction(() => {
      const last = this.db
        .prepare("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1")
        .get() as { entry_hash: string | null } | undefined;
      const prevHash = last?.entry_hash ?? AUDIT_GENESIS_HASH;
      const result = this.db
        .prepare(
          "INSERT INTO audit_log (ts, actor, action, capability_id, decision, details) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(ts, entry.actor, entry.action, capabilityId, entry.decision, detailsText);
      const rowId = Number(result.lastInsertRowid);
      const hash = auditEntryHash({
        prevHash,
        id: rowId,
        ts,
        actor: entry.actor,
        action: entry.action,
        capabilityId,
        decision: entry.decision,
        details: detailsText,
      });
      this.db
        .prepare("UPDATE audit_log SET prev_hash = ?, entry_hash = ? WHERE id = ?")
        .run(prevHash, hash, rowId);
      return rowId;
    });
    return { ...entry, details, id, ts };
  }

  /**
   * Walks the whole log in id order. Leading rows without a hash predate the chain and are
   * counted, not checked; every later row must link to the one before it and match its own hash.
   */
  verify(): AuditVerification {
    const rows = this.db
      .prepare(
        "SELECT id, ts, actor, action, capability_id, decision, details, prev_hash, entry_hash FROM audit_log ORDER BY id ASC",
      )
      .iterate() as Iterable<Record<string, string | number | null>>;
    let unchainedPrefix = 0;
    let checked = 0;
    let chained = false;
    let expectedPrev = AUDIT_GENESIS_HASH;
    for (const r of rows) {
      const id = Number(r.id);
      const bad = (): AuditVerification => ({
        ok: false,
        checked,
        firstBadId: id,
        unchainedPrefix,
      });
      if (r.entry_hash === null && r.prev_hash === null) {
        if (chained) return bad();
        unchainedPrefix++;
        continue;
      }
      chained = true;
      if (typeof r.entry_hash !== "string" || r.prev_hash !== expectedPrev) return bad();
      const hash = auditEntryHash({
        prevHash: expectedPrev,
        id,
        ts: String(r.ts),
        actor: String(r.actor),
        action: String(r.action),
        capabilityId: r.capability_id === null ? null : String(r.capability_id),
        decision: String(r.decision),
        details: String(r.details),
      });
      if (hash !== r.entry_hash) return bad();
      expectedPrev = hash;
      checked++;
    }
    return { ok: true, checked, firstBadId: null, unchainedPrefix };
  }

  private inWriteTransaction<T>(fn: () => T): T {
    // Already inside a caller's transaction on this connection: nothing else on it can interleave.
    const nested = this.db.isTransaction;
    this.db.exec(nested ? "SAVEPOINT audit_chain" : "BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec(nested ? "RELEASE audit_chain" : "COMMIT");
      return out;
    } catch (err) {
      this.db.exec(nested ? "ROLLBACK TO audit_chain; RELEASE audit_chain" : "ROLLBACK");
      throw err;
    }
  }

  /** Newest first. */
  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  }

  list(query: AuditQuery = {}): AuditEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const rows = (
      query.capabilityId
        ? this.db
            .prepare("SELECT * FROM audit_log WHERE capability_id = ? ORDER BY id DESC LIMIT ?")
            .all(query.capabilityId, limit)
        : this.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit)
    ) as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      actor: String(r.actor),
      action: String(r.action),
      ...(r.capability_id ? { capabilityId: String(r.capability_id) } : {}),
      decision: r.decision as AuditDecision,
      details: JSON.parse(String(r.details)) as Record<string, unknown>,
    }));
  }
}
