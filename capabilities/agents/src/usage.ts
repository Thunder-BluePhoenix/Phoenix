// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 plan usage: how much of the 5-hour and weekly plan windows an agent says it has used.
//
// Only fields that public documentation shows are read:
//  - Claude Code: the status line JSON (https://code.claude.com/docs/en/statusline) has
//    `rate_limits.five_hour` and `rate_limits.seven_day`, each `{used_percentage 0-100, resets_at
//    (Unix epoch seconds)}`. They exist only for claude.ai Pro/Max subscribers and only after the
//    first API response, and each window may be absent. Nothing else in that JSON is read.
//  - Codex: the app-server method `account/rateLimits/read` documents `primary`/`secondary`
//    `{usedPercent, windowDurationMins, resetsAt (Unix seconds)}` plus `rateLimitResetCredits
//    .availableCount`. `mapCodexRateLimits` understands that shape, but no hook or status channel
//    delivers it to Phoenix, and obtaining it means launching `codex app-server`, which Phoenix
//    does not do. Codex is therefore listed as unsupported (CODEX_UNSUPPORTED).
//
// Warnings fire BEFORE the limit, once per window per threshold (`UsageTracker`).
import { isRecord } from "./guards";
import { AGENT_ID_PATTERN } from "./report";
import { LIVE_AGENT_PATTERN } from "./steps";

export const USAGE_WINDOWS = ["5h", "weekly"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

/** Default warning thresholds (percent), configurable in Core settings. */
export const DEFAULT_THRESHOLDS: readonly number[] = [80, 95];
export const MAX_THRESHOLDS = 4;
/** A reading older than this is shown as stale. */
export const STALE_AFTER_MS = 30 * 60_000;
/** Two reset times closer than this belong to the same window (the clock may jitter). */
const SAME_WINDOW_MS = 10 * 60_000;
/** A drop of more than this many points re-arms a warning (a reset credit was used). */
const REARM_DROP = 10;
const MAX_SAMPLES = 4;
const MAX_FUTURE_MS = 60 * 86_400_000;

export const CODEX_UNSUPPORTED = {
  agent: "codex",
  reason:
    "unsupported: Codex documents rate limits only through its app-server (account/rateLimits/read), which Phoenix does not launch; no hook or status line delivers them",
} as const;

export interface UsageSample {
  agent: string;
  window: UsageWindow;
  /** 0 to 100. */
  used_pct: number;
  /** ISO time the window resets. */
  resets_at: string;
  observed_at: string;
  /** Free resets left (Codex documents `rateLimitResetCredits.availableCount`). */
  reset_credits?: number;
}

export type UsageLevel = "ok" | "warn" | "critical";

export interface UsageView extends UsageSample {
  level: UsageLevel;
  stale: boolean;
}

export interface UsageWarning {
  agent: string;
  window: UsageWindow;
  threshold: number;
  used_pct: number;
  resets_at: string;
}

const pct = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value * 10) / 10
    : undefined;

/** Epoch seconds or an ISO string, as ISO; undefined when unusable or implausibly far away. */
function resetTime(value: unknown, nowMs: number): string | undefined {
  let ms: number;
  if (typeof value === "number" && Number.isFinite(value)) ms = value < 1e11 ? value * 1000 : value;
  else if (typeof value === "string" && value.length <= 40) ms = Date.parse(value);
  else return undefined;
  if (!Number.isFinite(ms) || Math.abs(ms - nowMs) > MAX_FUTURE_MS) return undefined;
  return new Date(ms).toISOString();
}

const wholeCredits = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000
    ? value
    : undefined;

/**
 * The plan windows in Claude Code's status line JSON. Returns [] for anything else (no
 * `rate_limits`, an API-key user, malformed fields); never throws, never reads other fields.
 */
export function extractClaudeUsage(statusJson: unknown, nowMs: number): UsageSample[] {
  if (!isRecord(statusJson) || !isRecord(statusJson.rate_limits)) return [];
  const limits = statusJson.rate_limits;
  const samples: UsageSample[] = [];
  const windows: [string, UsageWindow][] = [
    ["five_hour", "5h"],
    ["seven_day", "weekly"],
  ];
  for (const [field, window] of windows) {
    const entry = limits[field];
    if (!isRecord(entry)) continue;
    const used = pct(entry.used_percentage);
    const resets = resetTime(entry.resets_at, nowMs);
    if (used === undefined || resets === undefined) continue;
    samples.push({
      agent: "claude-code",
      window,
      used_pct: used,
      resets_at: resets,
      observed_at: new Date(nowMs).toISOString(),
    });
  }
  return samples;
}

/** Codex window length in minutes → window. Only the two plan windows are understood. */
const CODEX_WINDOW_MINS: Readonly<Record<number, UsageWindow>> = { 300: "5h", 10_080: "weekly" };

/** Maps the documented `account/rateLimits/read` result (see the header). */
export function mapCodexRateLimits(result: unknown, nowMs: number): UsageSample[] {
  if (!isRecord(result) || !isRecord(result.rateLimits)) return [];
  const credits = isRecord(result.rateLimitResetCredits)
    ? wholeCredits(result.rateLimitResetCredits.availableCount)
    : undefined;
  const samples: UsageSample[] = [];
  for (const bucket of [result.rateLimits.primary, result.rateLimits.secondary]) {
    if (!isRecord(bucket) || typeof bucket.windowDurationMins !== "number") continue;
    const window = CODEX_WINDOW_MINS[bucket.windowDurationMins];
    const used = pct(bucket.usedPercent);
    const resets = resetTime(bucket.resetsAt, nowMs);
    if (!window || used === undefined || resets === undefined) continue;
    samples.push({
      agent: "codex",
      window,
      used_pct: used,
      resets_at: resets,
      observed_at: new Date(nowMs).toISOString(),
      ...(credits === undefined ? {} : { reset_credits: credits }),
    });
  }
  return samples;
}

export type UsageResult = { ok: true; samples: UsageSample[] } | { ok: false; problems: string[] };

/**
 * Validates what a statusline relay or hook sends: one sample, or `{agent, samples: [...]}`.
 * Core takes its own clock as `observed_at`: a sender cannot make a reading look fresh.
 */
export function validateUsage(input: unknown, nowMs: number): UsageResult {
  if (!isRecord(input)) return { ok: false, problems: ["usage must be an object"] };
  const agent = input.agent;
  if (typeof agent !== "string" || !LIVE_AGENT_PATTERN.test(agent))
    return { ok: false, problems: ["agent is invalid"] };
  const raw = Array.isArray(input.samples) ? input.samples : [input];
  if (raw.length === 0 || raw.length > MAX_SAMPLES)
    return { ok: false, problems: [`between 1 and ${MAX_SAMPLES} samples are expected`] };
  const problems: string[] = [];
  const samples: UsageSample[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      problems.push("sample must be an object");
      continue;
    }
    const window = item.window;
    const used = pct(item.used_pct);
    const resets = resetTime(item.resets_at, nowMs);
    if (typeof window !== "string" || !(USAGE_WINDOWS as readonly string[]).includes(window))
      problems.push("window must be 5h or weekly");
    if (used === undefined) problems.push("used_pct must be a number from 0 to 100");
    if (resets === undefined) problems.push("resets_at must be a time within 60 days");
    const credits = item.reset_credits === undefined ? undefined : wholeCredits(item.reset_credits);
    if (item.reset_credits !== undefined && credits === undefined)
      problems.push("reset_credits is invalid");
    if (problems.length === 0 && used !== undefined && resets !== undefined) {
      samples.push({
        agent,
        window: window as UsageWindow,
        used_pct: used,
        resets_at: resets,
        observed_at: new Date(nowMs).toISOString(),
        ...(credits === undefined ? {} : { reset_credits: credits }),
      });
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, samples };
}

/** Thresholds from settings or a request: whole percents 1..99, unique, ascending, at most 4. */
export function parseThresholds(input: unknown): number[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_THRESHOLDS)
    return undefined;
  const values = input.filter(
    (v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 99,
  );
  if (values.length !== input.length || new Set(values).size !== values.length) return undefined;
  return values.sort((a, b) => a - b);
}

/** What survives a restart: per window, the reset time it was last seen with and the thresholds already warned. */
export type FiredState = Record<string, { resets_at: string; thresholds: number[] }>;

export interface UsageTrackerOptions {
  now: () => number;
  thresholds: () => readonly number[];
  onWarning: (warning: UsageWarning) => void;
  /** Warnings already sent before a restart, so they are not repeated. */
  fired?: FiredState;
  /** Called with the new fired state whenever it changes. */
  persist?: (fired: FiredState) => void;
}

interface WindowState {
  resets_at: string;
  fired: Record<number, true>;
}

/** Distinct (agent, window) readings kept; a sender cannot make Core track or persist more. */
export const MAX_USAGE_KEYS = 32;

/** The latest reading per agent and window, and the one-shot warnings. */
export class UsageTracker {
  private windows: Record<string, WindowState> = {};
  private samples: Record<string, UsageSample> = {};

  constructor(private readonly o: UsageTrackerOptions) {
    for (const [key, saved] of Object.entries(o.fired ?? {}).slice(0, MAX_USAGE_KEYS)) {
      this.windows[key] = {
        resets_at: saved.resets_at,
        fired: Object.fromEntries(saved.thresholds.map((t) => [t, true as const])),
      };
    }
  }

  /** Makes room for one more (agent, window) key by dropping those whose window has ended. */
  private hasRoomFor(key: string): boolean {
    if (key in this.windows || key in this.samples) return true;
    if (Object.keys({ ...this.windows, ...this.samples }).length < MAX_USAGE_KEYS) return true;
    const nowMs = this.o.now();
    for (const [k, w] of Object.entries(this.windows)) {
      if (Date.parse(w.resets_at) < nowMs) {
        delete this.windows[k];
        delete this.samples[k];
      }
    }
    for (const [k, s] of Object.entries(this.samples)) {
      if (Date.parse(s.resets_at) < nowMs) delete this.samples[k];
    }
    return Object.keys({ ...this.windows, ...this.samples }).length < MAX_USAGE_KEYS;
  }

  /**
   * Takes one reading. Returns false (and keeps nothing) when `sample` would be the 33rd distinct
   * (agent, window) pair while all 32 are still current: a sender cannot grow this without bound.
   */
  record(sample: UsageSample): boolean {
    const key = `${sample.agent}:${sample.window}`;
    if (!this.hasRoomFor(key)) return false;
    const prev = this.windows[key];
    const sameWindow =
      prev !== undefined &&
      Math.abs(Date.parse(prev.resets_at) - Date.parse(sample.resets_at)) < SAME_WINDOW_MS;
    const fired: Record<number, true> = sameWindow ? { ...prev.fired } : {};
    const thresholds = this.o.thresholds();
    if (sameWindow) {
      for (const t of thresholds) {
        if (fired[t] && sample.used_pct < t - REARM_DROP) delete fired[t];
      }
    }
    const crossed = thresholds.filter((t) => sample.used_pct >= t && !fired[t]);
    for (const t of crossed) fired[t] = true;
    // Persisted state matters only for what has been warned: a window with nothing warned, before
    // and after, is not worth a write however often its reset time moves.
    const before = Object.keys(prev?.fired ?? {});
    const after = Object.keys(fired);
    const changed =
      (before.length > 0 || after.length > 0) &&
      (before.length !== after.length ||
        before.some((t) => !fired[Number(t)]) ||
        prev?.resets_at !== sample.resets_at);
    this.windows[key] = { resets_at: sample.resets_at, fired };
    this.samples[key] = sample;
    if (changed) this.o.persist?.(this.exportFired());
    const highest = crossed[crossed.length - 1];
    if (highest !== undefined) {
      this.o.onWarning({
        agent: sample.agent,
        window: sample.window,
        threshold: highest,
        used_pct: sample.used_pct,
        resets_at: sample.resets_at,
      });
    }
    return true;
  }

  /** Only windows with a warning already sent: the rest carry nothing worth persisting. */
  exportFired(): FiredState {
    return Object.fromEntries(
      Object.entries(this.windows)
        .filter(([, w]) => Object.keys(w.fired).length > 0)
        .map(([key, w]) => [
          key,
          {
            resets_at: w.resets_at,
            thresholds: Object.keys(w.fired)
              .map(Number)
              .sort((a, b) => a - b),
          },
        ]),
    );
  }

  levelOf(usedPct: number): UsageLevel {
    const thresholds = this.o.thresholds();
    const lowest = thresholds[0];
    const highest = thresholds[thresholds.length - 1];
    if (lowest === undefined || highest === undefined || usedPct < lowest) return "ok";
    return thresholds.length > 1 && usedPct >= highest ? "critical" : "warn";
  }

  views(): UsageView[] {
    const nowMs = this.o.now();
    return Object.values(this.samples)
      .map((sample): UsageView => {
        const stale =
          nowMs - Date.parse(sample.observed_at) > STALE_AFTER_MS ||
          Date.parse(sample.resets_at) < nowMs;
        return { ...sample, level: stale ? "ok" : this.levelOf(sample.used_pct), stale };
      })
      .sort((a, b) => a.agent.localeCompare(b.agent) || a.window.localeCompare(b.window));
  }
}

// ── Token and cost reports (Phase 78) ───────────────────────────────────────────────────────────
//
// What an agent says it has used in one session, as running TOTALS for that session (not
// increments): `{agent, session_id, model?, project?, input_tokens?, output_tokens?, cost_usd?}`.
// Core turns successive totals into per-day increments (core/runtime/src/agent-usage).
//
// Only one source is read from Claude Code's status line, and only fields the public documentation
// lists (https://code.claude.com/docs/en/statusline): `session_id`, `model.id`,
// `workspace.project_dir` / `workspace.current_dir` / `cwd` (reduced to a folder NAME) and
// `cost.total_cost_usd`, which the documentation calls an estimate computed client-side that "may
// differ from your actual bill". Its `context_window.total_*_tokens` are NOT read: the
// documentation says they count what is currently in the context window (the output tokens are
// those of the most recent response only), so they are not session totals. Claude's cumulative
// token fields are therefore not available to Phoenix; agents that report totals themselves use
// this same body on `POST /api/agent/live/usage` or the relay's `usage` op. The installed generic
// hook (agent-hook.ts, used for Codex and others) sends that body when, and only when, its payload
// carries an explicit `phoenix_usage` object (relay/generic-map.ts `mapGenericUsage`). Codex's
// native hook payload was never observed to carry token counts or cost, so Codex sends nothing
// by itself.

/** Largest running token total one report may claim; beyond it the report is refused. */
export const MAX_REPORTED_TOKENS = 1_000_000_000_000;
/** Largest running cost (USD) one report may claim; beyond it the report is refused. */
export const MAX_REPORTED_COST_USD = 100_000;
const MAX_PROJECT_NAME = 120;
const TOKEN_REPORT_KEYS: Record<string, true> = {
  agent: true,
  session_id: true,
  model: true,
  project: true,
  input_tokens: true,
  output_tokens: true,
  cost_usd: true,
};
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;
/**
 * Characters a name must not carry: control, format (bidi, zero-width, soft hyphen), line and
 * paragraph separators, and the unassigned slots of the invisible-operators block. Used here for
 * project names and by Core (`displayName` in agent-live.ts), so a name is cleaned by one rule
 * wherever it is shown. Only for `replace` (the `g` flag makes `test` stateful).
 */
export const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u180e\u2060-\u206f]/gu;

export interface TokenUsageReport {
  agent: string;
  session_id: string;
  /** '' when the agent did not name a model. */
  model: string;
  /** A folder NAME (never a path); '' when unknown. */
  project: string;
  /** Running total for the session; absent = not reported (never zero). */
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

export type TokenUsageResult =
  { ok: true; report: TokenUsageReport } | { ok: false; problems: string[] };

/** The last path segment (either separator), without control, format or bidi characters, at most 120. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p !== "");
  return (parts[parts.length - 1] ?? "").replace(UNSEEN, "").slice(0, MAX_PROJECT_NAME);
}

/** True for a body that carries a session id: a token report, not a plan-window sample. */
export function isTokenUsageBody(input: unknown): boolean {
  return isRecord(input) && "session_id" in input;
}

const wholeTokens = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_REPORTED_TOKENS
    ? value
    : undefined;

const costUsd = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= MAX_REPORTED_COST_USD
    ? value
    : undefined;

/** Strict: unknown fields, non-integers, negatives and values past the caps are refused. */
export function validateTokenUsage(input: unknown): TokenUsageResult {
  if (!isRecord(input)) return { ok: false, problems: ["usage must be an object"] };
  const problems: string[] = [];
  for (const key of Object.keys(input))
    if (!Object.hasOwn(TOKEN_REPORT_KEYS, key))
      problems.push(`unknown field "${key.slice(0, 40)}"`);
  const { agent, session_id: sessionId, model, project } = input;
  if (typeof agent !== "string" || !LIVE_AGENT_PATTERN.test(agent))
    problems.push("agent is invalid");
  if (typeof sessionId !== "string" || !AGENT_ID_PATTERN.test(sessionId))
    problems.push("session_id is invalid");
  if (model !== undefined && (typeof model !== "string" || !MODEL_PATTERN.test(model)))
    problems.push("model is invalid");
  if (project !== undefined && (typeof project !== "string" || project.length > 1_000))
    problems.push("project is invalid");
  const inTokens = input.input_tokens === undefined ? undefined : wholeTokens(input.input_tokens);
  const outTokens =
    input.output_tokens === undefined ? undefined : wholeTokens(input.output_tokens);
  const cost = input.cost_usd === undefined ? undefined : costUsd(input.cost_usd);
  if (input.input_tokens !== undefined && inTokens === undefined)
    problems.push("input_tokens must be a whole number from 0 to 1e12");
  if (input.output_tokens !== undefined && outTokens === undefined)
    problems.push("output_tokens must be a whole number from 0 to 1e12");
  if (input.cost_usd !== undefined && cost === undefined)
    problems.push("cost_usd must be a number from 0 to 100000");
  if (
    inTokens === undefined &&
    outTokens === undefined &&
    cost === undefined &&
    problems.length === 0
  )
    problems.push("input_tokens, output_tokens or cost_usd is required");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    report: {
      agent: agent as string,
      session_id: sessionId as string,
      model: typeof model === "string" ? model : "",
      project: typeof project === "string" ? folderName(project) : "",
      ...(inTokens === undefined ? {} : { input_tokens: inTokens }),
      ...(outTokens === undefined ? {} : { output_tokens: outTokens }),
      ...(cost === undefined ? {} : { cost_usd: cost }),
    },
  };
}

/**
 * The session cost Claude Code's status line shows (`cost.total_cost_usd`), with the session id,
 * model id and project folder name. Null when the session id or the cost is missing or unusable.
 * Never throws; reads no other field.
 */
export function extractClaudeCost(statusJson: unknown): TokenUsageReport | null {
  if (!isRecord(statusJson) || !isRecord(statusJson.cost)) return null;
  const cost = costUsd(statusJson.cost.total_cost_usd);
  const sessionId = statusJson.session_id;
  if (cost === undefined || typeof sessionId !== "string" || !AGENT_ID_PATTERN.test(sessionId))
    return null;
  const modelId = isRecord(statusJson.model) ? statusJson.model.id : undefined;
  const workspace = isRecord(statusJson.workspace) ? statusJson.workspace : {};
  const dir = [workspace.project_dir, workspace.current_dir, statusJson.cwd].find(
    (v): v is string => typeof v === "string" && v !== "",
  );
  return {
    agent: "claude-code",
    session_id: sessionId,
    model: typeof modelId === "string" && MODEL_PATTERN.test(modelId) ? modelId : "",
    project: dir ? folderName(dir) : "",
    cost_usd: cost,
  };
}
