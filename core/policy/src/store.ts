// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import { validateRule, type PolicyRule } from "./rules";
import { PolicyError, type Environment } from "./types";

export interface TemporaryApproval {
  id: string;
  /** `capability.command` or `capability.*`. Never `*`. */
  toolPattern: string;
  environment: Environment;
  /** Exact resource, or a prefix ending in `*` with at least one character before it. */
  resource: string;
  /** Restricts the approval to one agent; omitted = any agent. */
  actorId?: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

interface ApprovalRow {
  id: string;
  tool_pattern: string;
  environment: string;
  resource: string;
  actor_id: string | null;
  created_by: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

interface CountRow {
  n: number;
}

interface RuleRow {
  id: string;
  rule: string;
}

/** SQLite persistence for rules and temporary approvals (tables from migration 6). */
export class PolicyStore {
  constructor(private readonly db: Database) {}

  /** Throws PolicyError when a stored rule no longer validates (the engine then fails closed). */
  rules(): PolicyRule[] {
    const rows = this.db
      .prepare("SELECT id, rule FROM policy_rules ORDER BY created_at, id")
      .all() as unknown as RuleRow[];
    return rows.map((row) => {
      try {
        return validateRule(JSON.parse(row.rule));
      } catch (err) {
        throw new PolicyError("INVALID_RULE", `Stored rule "${row.id}" is invalid`, [String(err)]);
      }
    });
  }

  ruleCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM policy_rules").get() as unknown as CountRow;
    return row.n;
  }

  insertRule(rule: PolicyRule, by: string, at: number): void {
    try {
      this.db
        .prepare("INSERT INTO policy_rules (id, rule, created_by, created_at) VALUES (?, ?, ?, ?)")
        .run(rule.id, JSON.stringify(rule), by, new Date(at).toISOString());
    } catch (err) {
      if (String(err).includes("UNIQUE"))
        throw new PolicyError("INVALID_RULE", `A rule with id "${rule.id}" already exists`);
      throw err;
    }
  }

  deleteRule(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM policy_rules WHERE id = ?").run(id).changes) > 0;
  }

  insertApproval(a: TemporaryApproval): void {
    this.db
      .prepare(
        `INSERT INTO policy_approvals
           (id, tool_pattern, environment, resource, actor_id, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.toolPattern,
        a.environment,
        a.resource,
        a.actorId ?? null,
        a.createdBy,
        a.createdAt,
        a.expiresAt,
      );
  }

  /** Approvals that are neither revoked nor expired at `now` (an approval expires AT expiresAt). */
  activeApprovals(now: number): TemporaryApproval[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM policy_approvals WHERE revoked_at IS NULL AND expires_at > ? ORDER BY created_at, id",
      )
      .all(now) as unknown as ApprovalRow[];
    return rows.map(toApproval);
  }

  revokeApproval(id: string, now: number): boolean {
    const result = this.db
      .prepare("UPDATE policy_approvals SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND expires_at > ?")
      .run(now, id, now);
    return Number(result.changes) > 0;
  }
}

function toApproval(row: ApprovalRow): TemporaryApproval {
  return {
    id: row.id,
    toolPattern: row.tool_pattern,
    environment: row.environment as Environment,
    resource: row.resource,
    ...(row.actor_id ? { actorId: row.actor_id } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}
