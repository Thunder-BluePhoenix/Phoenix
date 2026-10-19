// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "./database";

/** Where counts for keys past a metric's cap are collected, so a flood of names stays bounded. */
export const RECAP_OTHER_KEY = "(other)";

export interface RecapRow {
  day: string;
  metric: string;
  /** '' for a day total; an agent id or project name for the per-agent / per-project counts. */
  key: string;
  value: number;
}

export interface RecapBump {
  metric: string;
  key?: string;
  value: number;
  /** `sum` adds to the stored value (default); `max` keeps the larger of the two. */
  mode?: "sum" | "max";
  /** At most this many distinct non-empty keys per (day, metric); further keys count as `(other)`. */
  maxKeys?: number;
}

/**
 * Counts per local day (migration 28). Never holds content, file names or commands: the weekly
 * recap keeps its numbers here so they survive the capped events table.
 */
export class RecapStore {
  constructor(private readonly db: Database) {}

  /** Applies all bumps for one day together (one disk sync, all or nothing). */
  bump(day: string, bumps: readonly RecapBump[]): void {
    if (bumps.length === 0) return;
    const own = !this.db.isTransaction;
    if (own) this.db.exec("BEGIN");
    try {
      for (const bump of bumps) this.apply(day, bump);
      if (own) this.db.exec("COMMIT");
    } catch (err) {
      if (own) this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private apply(day: string, bump: RecapBump): void {
    let key = bump.key ?? "";
    if (bump.maxKeys !== undefined && key !== "" && key !== RECAP_OTHER_KEY) {
      const known = this.db
        .prepare("SELECT 1 AS yes FROM recap_daily WHERE day = ? AND metric = ? AND key = ?")
        .get(day, bump.metric, key);
      if (!known) {
        const distinct = (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM recap_daily WHERE day = ? AND metric = ? AND key <> '' AND key <> ?",
            )
            .get(day, bump.metric, RECAP_OTHER_KEY) as { n: number }
        ).n;
        if (distinct >= bump.maxKeys) key = RECAP_OTHER_KEY;
      }
    }
    const combine = bump.mode === "max" ? "MAX(value, excluded.value)" : "value + excluded.value";
    this.db
      .prepare(
        `INSERT INTO recap_daily (day, metric, key, value) VALUES (?, ?, ?, ?)
         ON CONFLICT(day, metric, key) DO UPDATE SET value = ${combine}`,
      )
      .run(day, bump.metric, key, bump.value);
  }

  /** Every row from `from` to `to` (both inclusive, YYYY-MM-DD). */
  range(from: string, to: string): RecapRow[] {
    return this.db
      .prepare(
        "SELECT day, metric, key, value FROM recap_daily WHERE day >= ? AND day <= ? ORDER BY day, metric, key",
      )
      .all(from, to) as unknown as RecapRow[];
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM recap_daily").get() as { n: number }).n;
  }

  /** Drops every row from a day before `day` (YYYY-MM-DD). */
  deleteBefore(day: string): number {
    return Number(this.db.prepare("DELETE FROM recap_daily WHERE day < ?").run(day).changes);
  }

  /** "Delete all recap statistics": returns how many rows were removed. */
  deleteAll(): number {
    return Number(this.db.prepare("DELETE FROM recap_daily").run().changes);
  }
}
