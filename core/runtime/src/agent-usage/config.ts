// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Settings of mission control: budgets, the user's agent prices and the stall limit. Reading
// tolerates damage (a bad entry is dropped, never replaced by a made-up value); writing is strict.
import { randomBytes } from "node:crypto";
import type { MissionBudgetView } from "@phoenix/api";
import { LIVE_AGENT_PATTERN } from "@phoenix/capability-agents";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { DEFAULT_STUCK_AFTER_MIN, MAX_STUCK_AFTER_MIN, MIN_STUCK_AFTER_MIN } from "./board";
import { MAX_AGENT_PRICE, MAX_AGENT_PRICES, MODEL_ID, type AgentPrices } from "./pricing";

export const PRICES_KEY = "agents.usage.prices";
export const BUDGETS_KEY = "agents.usage.budgets";
export const STUCK_KEY = "agents.usage.stuck_after_min";
export const KEEP_DAYS_KEY = "agents.usage.keep_days";
/** Last totals each agent reported, keyed by a hash (no session names); see AgentUsageRuntime. */
export const BASELINES_KEY = "agents.usage.reported";
/** Budget alerts already sent: `<day>|<budget>[|<session>]` -> thresholds. */
export const BUDGET_FIRED_KEY = "agents.usage.budget_fired";

export const MAX_BUDGETS = 20;
export const MAX_TOKEN_BUDGET = 1_000_000_000_000;
export const MAX_COST_BUDGET_USD = 1_000_000;
const BUDGET_ID = /^[a-z0-9-]{1,24}$/;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

/** Days of usage rows kept: default (about 13 months), and the bounds a setting may take. */
export const DEFAULT_KEEP_DAYS = 400;
export const MIN_KEEP_DAYS = 7;
export const MAX_KEEP_DAYS = 3_650;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function readBudget(raw: unknown): MissionBudgetView | undefined {
  if (!isObject(raw)) return undefined;
  const { id, scope, metric, limit, agent } = raw;
  if (typeof id !== "string" || !BUDGET_ID.test(id)) return undefined;
  if (scope !== "daily" && scope !== "session") return undefined;
  if (metric !== "tokens" && metric !== "cost") return undefined;
  const max = metric === "tokens" ? MAX_TOKEN_BUDGET : MAX_COST_BUDGET_USD;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || limit > max)
    return undefined;
  if (agent !== undefined && (typeof agent !== "string" || !LIVE_AGENT_PATTERN.test(agent)))
    return undefined;
  return { id, scope, metric, limit, ...(agent === undefined ? {} : { agent }) };
}

/** Budgets from settings; damaged entries are dropped, duplicates keep the first. */
export function readBudgets(raw: unknown): MissionBudgetView[] {
  if (!Array.isArray(raw)) return [];
  const out: MissionBudgetView[] = [];
  for (const item of raw.slice(0, MAX_BUDGETS)) {
    const budget = readBudget(item);
    if (budget && !out.some((b) => b.id === budget.id)) out.push(budget);
  }
  return out;
}

/** Budgets from a request: every entry must be valid; an entry without an id gets a new one. */
export function parseBudgets(raw: unknown): MissionBudgetView[] {
  if (!Array.isArray(raw)) throw invalid('"budgets" must be a list');
  if (raw.length > MAX_BUDGETS) throw invalid(`"budgets" can hold at most ${MAX_BUDGETS} budgets`);
  const out: MissionBudgetView[] = [];
  for (const item of raw) {
    if (!isObject(item)) throw invalid("A budget must be an object");
    for (const key of Object.keys(item))
      if (!["id", "scope", "metric", "limit", "agent"].includes(key))
        throw invalid(`A budget has an unknown field "${key.slice(0, 40)}"`);
    const withId = { ...item, id: item.id ?? `b-${randomBytes(4).toString("hex")}` };
    const budget = readBudget(withId);
    if (!budget)
      throw invalid(
        'A budget needs scope "daily" or "session", metric "tokens" or "cost", a positive limit within range, and an optional agent id',
      );
    if (out.some((b) => b.id === budget.id)) throw invalid("Budget ids must be unique");
    out.push(budget);
  }
  return out;
}

/** Strict price table for a request. */
export function parsePrices(raw: unknown): AgentPrices {
  if (!isObject(raw)) throw invalid('"prices" must be an object');
  const entries = Object.entries(raw);
  if (entries.length > MAX_AGENT_PRICES)
    throw invalid(`"prices" can hold at most ${MAX_AGENT_PRICES} models`);
  const out: AgentPrices = Object.create(null) as AgentPrices;
  for (const [model, price] of entries) {
    if (!MODEL_ID.test(model)) throw invalid("A price key must be a model id");
    if (!isObject(price)) throw invalid("A price must be an object");
    for (const key of Object.keys(price))
      if (key !== "input_per_mtok" && key !== "output_per_mtok")
        throw invalid("A price has an unknown field");
    const { input_per_mtok: input, output_per_mtok: output } = price;
    if (
      typeof input !== "number" ||
      typeof output !== "number" ||
      !Number.isFinite(input) ||
      !Number.isFinite(output) ||
      input < 0 ||
      output < 0 ||
      input > MAX_AGENT_PRICE ||
      output > MAX_AGENT_PRICE
    )
      throw invalid(`Prices must be numbers from 0 to ${MAX_AGENT_PRICE} (USD per million tokens)`);
    out[model] = { input_per_mtok: input, output_per_mtok: output };
  }
  return out;
}

export function readStuckAfter(raw: unknown): number {
  return typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= MIN_STUCK_AFTER_MIN &&
    raw <= MAX_STUCK_AFTER_MIN
    ? raw
    : DEFAULT_STUCK_AFTER_MIN;
}

export function parseStuckAfter(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < MIN_STUCK_AFTER_MIN ||
    raw > MAX_STUCK_AFTER_MIN
  )
    throw invalid(
      `"stuck_after_min" must be a whole number of minutes from ${MIN_STUCK_AFTER_MIN} to ${MAX_STUCK_AFTER_MIN}`,
    );
  return raw;
}

/** The retention from settings; a damaged or out-of-range value reads as the default, never as a made-up number. */
export function readKeepDays(raw: unknown): number {
  return typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= MIN_KEEP_DAYS &&
    raw <= MAX_KEEP_DAYS
    ? raw
    : DEFAULT_KEEP_DAYS;
}

export function parseKeepDays(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < MIN_KEEP_DAYS ||
    raw > MAX_KEEP_DAYS
  )
    throw invalid(
      `"keep_days" must be a whole number of days from ${MIN_KEEP_DAYS} to ${MAX_KEEP_DAYS}`,
    );
  return raw;
}
