// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "./database";

/** One day of what one agent session reported for one model (migration 32). */
export interface AgentUsageRow {
  day: string;
  session_id: string;
  agent: string;
  /** A folder NAME, never a path. */
  project: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Millionths of a US dollar; null when neither the agent nor a user price gave a cost. */
  cost_micro: number | null;
}

export interface AgentUsageTotals {
  input_tokens: number;
  output_tokens: number;
  /** null when no row of the sum has a known cost: unknown is never turned into zero. */
  cost_micro: number | null;
  /** Rows of the sum that have tokens but no known cost: the cost above is then a lower bound. */
  unpriced_rows: number;
}

/** The `n` of a `SELECT COUNT(*) AS n` row; 0 for anything else. */
function countOf(row: unknown): number {
  if (typeof row === "object" && row !== null && "n" in row) return Number(row.n) || 0;
  return 0;
}

const SUMS = `COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o,
  SUM(cost_micro) AS c,
  COALESCE(SUM(CASE WHEN cost_micro IS NULL AND input_tokens + output_tokens > 0 THEN 1 ELSE 0 END), 0) AS u`;

function toTotals(row: unknown): AgentUsageTotals {
  if (typeof row !== "object" || row === null)
    return { input_tokens: 0, output_tokens: 0, cost_micro: null, unpriced_rows: 0 };
  const r = row as Record<string, unknown>;
  return {
    input_tokens: Number(r.i) || 0,
    output_tokens: Number(r.o) || 0,
    cost_micro: r.c === null || r.c === undefined ? null : Number(r.c),
    unpriced_rows: Number(r.u) || 0,
  };
}

/**
 * Token and cost counts per day, session, agent and model, from what agents themselves report.
 * Rows hold the INCREMENT recorded on that day, so the sum over days of one session is the
 * session's reported total. No prompts, outputs, commands or file names.
 */
export class AgentUsageStore {
  constructor(private readonly db: Database) {}

  /** Adds an increment to one row, creating it. A null cost never overwrites or zeroes a known one. */
  add(row: AgentUsageRow): void {
    this.db
      .prepare(
        `INSERT INTO agent_usage (day, session_id, agent, project, model, input_tokens, output_tokens, cost_micro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, session_id, agent, model) DO UPDATE SET
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           project = CASE WHEN excluded.project = '' THEN project ELSE excluded.project END,
           cost_micro = CASE
             WHEN excluded.cost_micro IS NULL THEN cost_micro
             WHEN cost_micro IS NULL THEN excluded.cost_micro
             ELSE cost_micro + excluded.cost_micro END`,
      )
      .run(
        row.day,
        row.session_id,
        row.agent,
        row.project,
        row.model,
        row.input_tokens,
        row.output_tokens,
        row.cost_micro,
      );
  }

  /** The row of one (day, agent, session, model), if there is one. */
  row(day: string, agent: string, sessionId: string, model: string): AgentUsageRow | undefined {
    return this.db
      .prepare(
        `SELECT day, session_id, agent, project, model, input_tokens, output_tokens, cost_micro
         FROM agent_usage WHERE day = ? AND agent = ? AND session_id = ? AND model = ?`,
      )
      .get(day, agent, sessionId, model) as unknown as AgentUsageRow | undefined;
  }

  /** The sum over all days and models of one session: what Core already holds of its reported total. */
  sessionTotals(agent: string, sessionId: string): AgentUsageTotals {
    return toTotals(
      this.db
        .prepare(`SELECT ${SUMS} FROM agent_usage WHERE agent = ? AND session_id = ?`)
        .get(agent, sessionId),
    );
  }

  /** One session's sum on one day, over its models. */
  sessionDayTotals(day: string, agent: string, sessionId: string): AgentUsageTotals {
    return toTotals(
      this.db
        .prepare(`SELECT ${SUMS} FROM agent_usage WHERE day = ? AND agent = ? AND session_id = ?`)
        .get(day, agent, sessionId),
    );
  }

  /** One day's sum, optionally for one agent. */
  dayTotals(day: string, agent?: string): AgentUsageTotals {
    return toTotals(
      agent === undefined
        ? this.db.prepare(`SELECT ${SUMS} FROM agent_usage WHERE day = ?`).get(day)
        : this.db
            .prepare(`SELECT ${SUMS} FROM agent_usage WHERE day = ? AND agent = ?`)
            .get(day, agent),
    );
  }

  /** Every distinct (agent, session) pair that has a stored row, on any day. */
  sessionKeys(): { agent: string; session_id: string }[] {
    return this.db
      .prepare("SELECT DISTINCT agent, session_id FROM agent_usage")
      .all() as unknown as { agent: string; session_id: string }[];
  }

  /** Distinct (agent, session) pairs with a row on `day`. */
  sessionsOn(day: string): number {
    return countOf(
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM (SELECT DISTINCT agent, session_id FROM agent_usage WHERE day = ?)",
        )
        .get(day),
    );
  }

  /** The agents with a row on `day`. */
  agentsOn(day: string): string[] {
    return (
      this.db
        .prepare("SELECT DISTINCT agent FROM agent_usage WHERE day = ?")
        .all(day) as unknown as { agent: string }[]
    ).map((r) => r.agent);
  }

  /** Rows of one session on one day (one per model). */
  modelsOn(day: string, agent: string, sessionId: string): number {
    return countOf(
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM agent_usage WHERE day = ? AND agent = ? AND session_id = ?",
        )
        .get(day, agent, sessionId),
    );
  }

  /** Every row from `from` to `to` (both inclusive, YYYY-MM-DD). */
  range(from: string, to: string): AgentUsageRow[] {
    return this.db
      .prepare(
        `SELECT day, session_id, agent, project, model, input_tokens, output_tokens, cost_micro
         FROM agent_usage WHERE day >= ? AND day <= ? ORDER BY day, agent, session_id, model`,
      )
      .all(from, to) as unknown as AgentUsageRow[];
  }

  count(): number {
    return countOf(this.db.prepare("SELECT COUNT(*) AS n FROM agent_usage").get());
  }

  /** Drops every row from a day before `day` (YYYY-MM-DD). */
  deleteBefore(day: string): number {
    return Number(this.db.prepare("DELETE FROM agent_usage WHERE day < ?").run(day).changes);
  }

  /**
   * "Delete all agent usage": returns how many rows went. Like the recap counts, the freed cells
   * are zeroed (`secure_delete` for this one delete) and the write-ahead log is folded in.
   */
  deleteAll(): number {
    const current = this.db.prepare("PRAGMA secure_delete").get();
    const before = Number(current?.secure_delete ?? 0);
    this.db.exec("PRAGMA secure_delete = ON");
    try {
      const removed = Number(this.db.prepare("DELETE FROM agent_usage").run().changes);
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return removed;
    } finally {
      this.db.exec(`PRAGMA secure_delete = ${before === 2 ? "FAST" : before}`);
    }
  }
}
