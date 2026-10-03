// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
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

/** Append-only audit trail of security-relevant decisions. Details are redacted. */
export class AuditLog {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  record(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
    const ts = new Date(this.now()).toISOString();
    const details = redact(entry.details) as Record<string, unknown>;
    const result = this.db
      .prepare(
        "INSERT INTO audit_log (ts, actor, action, capability_id, decision, details) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        ts,
        entry.actor,
        entry.action,
        entry.capabilityId ?? null,
        entry.decision,
        JSON.stringify(details),
      );
    return { ...entry, details, id: Number(result.lastInsertRowid), ts };
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
