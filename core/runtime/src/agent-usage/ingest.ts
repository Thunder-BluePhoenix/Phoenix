// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Turns what an agent REPORTS into stored per-day increments. An agent reports running totals for
// its session (all models together: Claude Code's cost is session-wide and the model may change);
// Core stores the difference since the last report on Core's own clock's day, attributed to the
// model named in that report. Core
// cannot check what an agent claims, so every number is bounded:
//   - the report itself is validated first (strict fields, whole non-negative numbers, 1e12 tokens
//     and 100000 USD at most; see validateTokenUsage),
//   - one report adds at most LIMITS.reportTokens per field / LIMITS.reportCostMicro,
//   - one session adds at most LIMITS.sessionDay* per day, all sessions together LIMITS.day*,
//   - at most LIMITS.sessionsPerDay sessions, LIMITS.agentsPerDay agents and LIMITS.modelsPerSessionDay
//     models per session are stored per day (a new one past the cap is refused).
// A total that goes DOWN is a reset (Claude Code resets its cost on /clear): the new number counts
// from zero. The cost of a report is what the agent reported (`cost_usd`), else computed from the
// user's own price for that model, else UNKNOWN (null); it is never invented and never zero.
import { createHash } from "node:crypto";
import type { TokenUsageReport } from "@phoenix/capability-agents";
import type { AgentUsageStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { dayKeyOf } from "../recap-calendar";
import { costMicro, priceFor, type AgentPrices } from "./pricing";
import type { Price } from "@phoenix/ai-models";

export const LIMITS = {
  /** Increment one report may add, per token field. */
  reportTokens: 50_000_000,
  sessionDayTokens: 500_000_000,
  dayTokens: 5_000_000_000,
  /** Millionths of a dollar. */
  reportCostMicro: 1_000_000_000,
  sessionDayCostMicro: 10_000_000_000,
  dayCostMicro: 50_000_000_000,
  sessionsPerDay: 500,
  agentsPerDay: 20,
  modelsPerSessionDay: 10,
  /** One agent's tokens per field / cost (millionths of a dollar) per day, all its sessions together. */
  agentDayTokens: 2_000_000_000,
  agentDayCostMicro: 20_000_000_000,
  /** Last-reported totals kept in memory. */
  tracked: 1_000,
  /** Delete-all marks kept (settings); the oldest are dropped past this. */
  marks: 5_000,
} as const;

interface Last {
  input?: number;
  output?: number;
  costMicro?: number;
}

/**
 * What Core had already counted of one session when "delete all" ran: the session's reported
 * running totals at that moment (tokens in, tokens out, cost in millionths of a dollar). Stored
 * under a hash of `<agent>\0<session id>` so no session name is kept. The baseline of a session
 * whose in-memory entry is gone (restart, eviction) is this mark PLUS what is stored since.
 */
export interface Mark {
  i: number;
  o: number;
  c: number;
}
export type Marks = Record<string, Mark>;

/** A short hash of the `<agent>\0<session id>` key: marks hold no session names. */
export const markKey = (rawKey: string): string =>
  createHash("sha256").update(rawKey).digest("hex").slice(0, 24);

const isMark = (v: unknown): v is Mark =>
  typeof v === "object" &&
  v !== null &&
  "i" in v &&
  "o" in v &&
  "c" in v &&
  [v.i, v.o, v.c].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);

/** Marks from settings; damaged entries are dropped (no mark = baseline from what is stored). */
export function readMarks(raw: unknown): Marks {
  const out: Marks = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [key, mark] of Object.entries(raw).slice(0, LIMITS.marks)) {
    if (/^[0-9a-f]{24}$/.test(key) && isMark(mark)) out[key] = { i: mark.i, o: mark.o, c: mark.c };
  }
  return out;
}

export interface IngestContext {
  atMs: number;
  timeZone: string;
  prices: AgentPrices;
  aiPrices: Readonly<Record<string, Price>>;
  /** A project name to use when the report has none. */
  projectFallback: string;
}

export interface IngestResult {
  day: string;
  /** Something was cut to a cap (the rest stays pending: the baseline did not move past it). */
  clamped: boolean;
  /** Rows were written (false for a report that added nothing). */
  stored: boolean;
}

const refuse = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

export class UsageIngest {
  private readonly last = new Map<string, Last>();

  constructor(
    private readonly store: AgentUsageStore,
    private readonly marks: () => Marks,
  ) {}

  record(report: TokenUsageReport, ctx: IngestContext): IngestResult {
    const day = dayKeyOf(ctx.atMs, ctx.timeZone);
    const { agent, session_id: sessionId, model } = report;
    const existing = this.store.row(day, agent, sessionId, model);
    if (!existing) this.checkRoom(day, agent, sessionId);

    // After "delete all" the baselines of live sessions are kept on purpose: only what they report
    // from then on is counted. In memory they are exact; after a Core restart (or when the entry
    // was evicted) they are rebuilt from the mark written at delete-all time plus what is stored.
    const key = `${agent}\u0000${sessionId}`;
    const before: Last = this.last.get(key) ?? this.rebuilt(key, agent, sessionId);
    const reportedMicro =
      report.cost_usd === undefined ? undefined : Math.round(report.cost_usd * 1_000_000);
    const delta = (reported: number | undefined, base: number | undefined): number =>
      reported === undefined ? 0 : reported >= (base ?? 0) ? reported - (base ?? 0) : reported;

    const sessionDay = this.store.sessionDayTotals(day, agent, sessionId);
    const agentDay = this.store.dayTotals(day, agent);
    const dayAll = this.store.dayTotals(day);
    let clamped = false;
    const cap = (wanted: number, ...limits: number[]): number => {
      const allowed = Math.max(0, Math.min(...limits));
      if (wanted > allowed) clamped = true;
      return Math.min(wanted, allowed);
    };
    const wantIn = delta(report.input_tokens, before.input);
    const wantOut = delta(report.output_tokens, before.output);
    const dIn = cap(
      wantIn,
      LIMITS.reportTokens,
      LIMITS.sessionDayTokens - sessionDay.input_tokens,
      LIMITS.agentDayTokens - agentDay.input_tokens,
      LIMITS.dayTokens - dayAll.input_tokens,
    );
    const dOut = cap(
      wantOut,
      LIMITS.reportTokens,
      LIMITS.sessionDayTokens - sessionDay.output_tokens,
      LIMITS.agentDayTokens - agentDay.output_tokens,
      LIMITS.dayTokens - dayAll.output_tokens,
    );
    const roomMicro = [
      LIMITS.reportCostMicro,
      LIMITS.sessionDayCostMicro - (sessionDay.cost_micro ?? 0),
      LIMITS.agentDayCostMicro - (agentDay.cost_micro ?? 0),
      LIMITS.dayCostMicro - (dayAll.cost_micro ?? 0),
    ];
    let dCost: number | null = null;
    let wantCost = 0;
    if (reportedMicro !== undefined) {
      wantCost = delta(reportedMicro, before.costMicro);
      dCost = cap(wantCost, ...roomMicro);
    } else {
      const price = priceFor(model, ctx.prices, ctx.aiPrices);
      // Both counts must be reported: a cost from half the tokens would pass for the whole.
      const computed = costMicro(
        report.input_tokens === undefined ? undefined : dIn,
        report.output_tokens === undefined ? undefined : dOut,
        price,
      );
      dCost = computed === null ? null : cap(computed, ...roomMicro);
    }

    // The baseline moves by what was STORED, not by what was reported: a part cut to a cap stays
    // pending (counted when there is room again) instead of being lost. A reset (a total below
    // the baseline) counts the whole new total, so the same formula holds: reported minus what
    // is still pending.
    this.remember(key, {
      ...(report.input_tokens === undefined
        ? before.input === undefined
          ? {}
          : { input: before.input }
        : { input: report.input_tokens - (wantIn - dIn) }),
      ...(report.output_tokens === undefined
        ? before.output === undefined
          ? {}
          : { output: before.output }
        : { output: report.output_tokens - (wantOut - dOut) }),
      ...(reportedMicro === undefined
        ? before.costMicro === undefined
          ? {}
          : { costMicro: before.costMicro }
        : { costMicro: reportedMicro - (wantCost - (dCost ?? 0)) }),
    });

    const stored = dIn > 0 || dOut > 0 || (dCost !== null && (dCost > 0 || !existing));
    if (stored)
      this.store.add({
        day,
        session_id: sessionId,
        agent,
        project: report.project || ctx.projectFallback,
        model,
        input_tokens: dIn,
        output_tokens: dOut,
        cost_micro: dCost,
      });
    return { day, clamped, stored };
  }

  /** The baseline of a session with no in-memory entry: its delete-all mark plus what is stored. */
  private rebuilt(rawKey: string, agent: string, sessionId: string): Last {
    const held = this.store.sessionTotals(agent, sessionId);
    const all = this.marks();
    const mark = Object.hasOwn(all, markKey(rawKey)) ? all[markKey(rawKey)] : undefined;
    return {
      input: (mark?.i ?? 0) + held.input_tokens,
      output: (mark?.o ?? 0) + held.output_tokens,
      costMicro: (mark?.c ?? 0) + (held.cost_micro ?? 0),
    };
  }

  /**
   * What to persist right BEFORE "delete all" wipes the rows: for every session the baseline it
   * would have now (in memory when tracked, else mark + stored), plus the marks of sessions that
   * have no rows. After the delete a later report of an already-counted total adds only the
   * difference, even after a restart or an eviction from memory.
   */
  snapshotMarks(): Marks {
    const out: Marks = { ...this.marks() };
    for (const { agent, session_id: sessionId } of this.store.sessionKeys()) {
      const rawKey = `${agent}\u0000${sessionId}`;
      if (this.last.has(rawKey)) continue;
      const b = this.rebuilt(rawKey, agent, sessionId);
      out[markKey(rawKey)] = { i: b.input ?? 0, o: b.output ?? 0, c: b.costMicro ?? 0 };
    }
    for (const [rawKey, l] of this.last)
      out[markKey(rawKey)] = { i: l.input ?? 0, o: l.output ?? 0, c: l.costMicro ?? 0 };
    const keys = Object.keys(out);
    for (const k of keys.slice(0, Math.max(0, keys.length - LIMITS.marks))) delete out[k];
    return out;
  }

  private checkRoom(day: string, agent: string, sessionId: string): void {
    const models = this.store.modelsOn(day, agent, sessionId);
    if (models >= LIMITS.modelsPerSessionDay)
      throw refuse("this session already reported too many different models today");
    if (models === 0 && this.store.sessionsOn(day) >= LIMITS.sessionsPerDay)
      throw refuse("too many different sessions reported usage today");
    const agents = this.store.agentsOn(day);
    if (!agents.includes(agent) && agents.length >= LIMITS.agentsPerDay)
      throw refuse("too many different agents are reporting usage");
  }

  private remember(key: string, last: Last): void {
    this.last.delete(key);
    this.last.set(key, last);
    if (this.last.size > LIMITS.tracked) this.last.delete(this.last.keys().next().value!);
  }
}
