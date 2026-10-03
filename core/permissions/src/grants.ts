// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import type { Permission } from "@phoenix/protocol";

export interface Grant {
  capabilityId: string;
  permission: Permission;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
}

/** Persistent, revocable, per-capability permission grants. */
export class GrantStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  grant(capabilityId: string, permission: Permission, grantedBy: string, expiresAt?: Date): Grant {
    const g: Grant = {
      capabilityId,
      permission,
      grantedBy,
      grantedAt: new Date(this.now()).toISOString(),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO permission_grants (capability_id, permission, granted_by, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(capability_id, permission) DO UPDATE SET
           granted_by = excluded.granted_by, granted_at = excluded.granted_at, expires_at = excluded.expires_at`,
      )
      .run(capabilityId, permission, grantedBy, g.grantedAt, g.expiresAt ?? null);
    return g;
  }

  revoke(capabilityId: string, permission?: Permission): number {
    const result = permission
      ? this.db
          .prepare("DELETE FROM permission_grants WHERE capability_id = ? AND permission = ?")
          .run(capabilityId, permission)
      : this.db.prepare("DELETE FROM permission_grants WHERE capability_id = ?").run(capabilityId);
    return Number(result.changes);
  }

  /** Active (non-expired) grants. */
  list(capabilityId?: string): Grant[] {
    const rows = (
      capabilityId
        ? this.db
            .prepare("SELECT * FROM permission_grants WHERE capability_id = ? ORDER BY permission")
            .all(capabilityId)
        : this.db
            .prepare("SELECT * FROM permission_grants ORDER BY capability_id, permission")
            .all()
    ) as Record<string, string | null>[];
    const nowMs = this.now();
    return rows
      .map((r) => ({
        capabilityId: String(r.capability_id),
        permission: r.permission as Permission,
        grantedBy: String(r.granted_by),
        grantedAt: String(r.granted_at),
        ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
      }))
      .filter((g) => !g.expiresAt || Date.parse(g.expiresAt) > nowMs);
  }

  has(capabilityId: string, permission: Permission): boolean {
    return this.list(capabilityId).some((g) => g.permission === permission);
  }

  missing(capabilityId: string, permissions: readonly Permission[]): Permission[] {
    const held = new Set(this.list(capabilityId).map((g) => g.permission));
    return permissions.filter((p) => !held.has(p));
  }
}
