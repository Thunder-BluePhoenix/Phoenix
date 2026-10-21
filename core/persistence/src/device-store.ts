// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "./database";

export interface PairedDevice {
  id: string;
  name: string;
  /** ECDSA P-256 SubjectPublicKeyInfo, DER-encoded then base64 encoded. */
  publicKey: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

interface DeviceRow {
  id: string;
  name: string;
  public_key: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

const row = (value: DeviceRow): PairedDevice => ({
  id: value.id,
  name: value.name,
  publicKey: value.public_key,
  createdAt: value.created_at,
  lastSeenAt: value.last_seen_at,
  revokedAt: value.revoked_at,
});

/** Persistent public device identities. Private keys and pairing codes are never stored here. */
export class DeviceStore {
  constructor(private readonly db: Database) {}

  create(device: PairedDevice): void {
    this.db
      .prepare(
        "INSERT INTO paired_devices (id, name, public_key, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        device.id,
        device.name,
        device.publicKey,
        device.createdAt,
        device.lastSeenAt,
        device.revokedAt,
      );
  }

  get(id: string): PairedDevice | undefined {
    const found = this.db
      .prepare(
        "SELECT id, name, public_key, created_at, last_seen_at, revoked_at FROM paired_devices WHERE id = ?",
      )
      .get(id) as DeviceRow | undefined;
    return found ? row(found) : undefined;
  }

  list(): PairedDevice[] {
    return (
      this.db
        .prepare(
          "SELECT id, name, public_key, created_at, last_seen_at, revoked_at FROM paired_devices ORDER BY created_at DESC",
        )
        .all() as unknown as DeviceRow[]
    ).map(row);
  }

  touch(id: string, seenAt: string): void {
    this.db.prepare("UPDATE paired_devices SET last_seen_at = ? WHERE id = ?").run(seenAt, id);
  }

  revoke(id: string, revokedAt: string): boolean {
    return (
      this.db
        .prepare("UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .run(revokedAt, id).changes > 0
    );
  }

  deleteAll(): number {
    return Number(this.db.prepare("DELETE FROM paired_devices").run().changes);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM paired_devices").get() as { n: number }).n;
  }
}
