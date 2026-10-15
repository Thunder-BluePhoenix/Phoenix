// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute as isPosixAbsolute, win32 } from "node:path";
import type {
  AgentApprovalCreateResult,
  AgentApprovalDecisionView,
  AgentApprovalHistoryRow,
  AgentApprovalPendingView,
  AgentApprovalQuestionView,
  AgentApprovalRuleView,
  AgentApprovalsApi,
  AgentApprovalWaitResult,
} from "@phoenix/api";
import { redactText } from "@phoenix/capability-terminal";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database } from "@phoenix/persistence";
import {
  agentPatternMatches,
  agentPatternProblem,
  agentRuleSubjectEligible,
  assessRisk,
  PolicyError,
  type Actor,
  type AgentRule,
  type AgentRuleBook,
  type Environment,
  type PolicyEngine,
  type RiskTier,
  type ToolRequest,
} from "@phoenix/policy";
import { createEvent, ErrorCode, PhoenixError, type SideEffect } from "@phoenix/protocol";
import { canonicalJson } from "@phoenix/workflows";

export const MAX_PENDING_APPROVALS = 50;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MIN_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 600_000;
export const DEFAULT_WAIT_MS = 25_000;
export const MAX_WAIT_MS = 30_000;
/** A resolved request stays answerable (waiters, duplicate decisions) for this long. */
export const SETTLED_RETENTION_MS = 10 * 60_000;
export const MAX_SETTLED_KEPT = 500;
export const EVENT_COMMAND_CHARS = 200;
const AUDIT_COMMAND_CHARS = 500;
const HISTORY_DEFAULT = 50;
const HISTORY_MAX = 200;

const LIMITS = {
  sessionId: 200,
  project: 1000,
  tool: 100,
  command: 2000,
  path: 1000,
  description: 500,
  message: 500,
  question: 500,
  header: 100,
  option: 200,
  optionDescription: 500,
  answer: 2000,
  questions: 4,
  options: 10,
} as const;

/** Time source; tests drive it by hand so nothing in a test waits on a real timer. */
export interface ApprovalClock {
  now(): number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const systemClock: ApprovalClock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export interface AgentApprovalsDeps {
  db: Database;
  bus: EventBus;
  audit: AuditLog;
  policy: PolicyEngine;
  rules: AgentRuleBook;
  isKillSwitchEngaged: () => boolean;
  logger: Logger;
  clock?: ApprovalClock;
}

type Outcome = "allow" | "deny" | "terminal" | "expired" | "cancelled";
type DecidedBy = "user" | "policy" | "rule" | "system";

type Settled =
  | {
      status: "decided";
      decision: AgentApprovalDecisionView;
      decidedBy: "user" | "policy" | "rule";
    }
  | { status: "expired" | "cancelled" | "terminal" };

interface Waiter {
  resolve: (result: AgentApprovalWaitResult) => void;
  cancelTimer: () => void;
}

interface Entry {
  id: string;
  nonce: Buffer;
  digest: string;
  kind: "permission" | "question";
  agent: string;
  project: string;
  tool: string;
  /** Redacted copy of what the agent asked to do; this is all that is ever shown or stored. */
  summary: { command?: string; path?: string; description?: string };
  questions?: AgentApprovalQuestionView[];
  /** The exact command or path, only for building an Always rule. Dropped once resolved. */
  subject: string | undefined;
  alwaysOk: boolean;
  createdAt: number;
  expiresAt: number;
  settled?: Settled;
  settledAt?: number;
  cancelExpiry: () => void;
  waiters: Set<Waiter>;
}

interface ParsedCreate {
  kind: "permission" | "question";
  agent: string;
  session_id: string;
  project: string;
  tool: string;
  input_summary: { command?: string; path?: string; description?: string };
  questions?: AgentApprovalQuestionView[];
  timeout_ms: number;
  suggestions_ok: boolean;
}

interface ParsedDecision {
  behavior: "allow" | "deny";
  message?: string;
  answers?: Record<string, string>;
  always?: { ttlMinutes: number; pattern?: string };
  terminal: boolean;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);
const notFound = () => new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Approval not found");

function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid(`"${field}" must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > max)
    throw invalid(
      `"${field}" must be a${allowEmpty ? "" : " non-empty"} string of at most ${max} characters`,
    );
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw invalid(`"${field}" must be an integer from ${min} to ${max}`);
  return value;
}

function parseQuestions(value: unknown): AgentApprovalQuestionView[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.questions)
    throw invalid(`"questions" must hold 1 to ${LIMITS.questions} questions`);
  const seen: string[] = [];
  return value.map((raw, i) => {
    const q = plainObject(raw, `questions[${i}]`);
    exactKeys(q, ["question", "header", "options", "multiSelect"]);
    const question = text(q.question, `questions[${i}].question`, LIMITS.question);
    if (seen.includes(question)) throw invalid("Question texts must be unique");
    seen.push(question);
    const header = text(q.header, `questions[${i}].header`, LIMITS.header, true);
    if (!Array.isArray(q.options) || q.options.length < 1 || q.options.length > LIMITS.options)
      throw invalid(`questions[${i}].options must hold 1 to ${LIMITS.options} options`);
    const options = q.options.map((rawOption, j) => {
      const o = plainObject(rawOption, `questions[${i}].options[${j}]`);
      exactKeys(o, ["label", "description"]);
      return {
        label: text(o.label, `questions[${i}].options[${j}].label`, LIMITS.option),
        ...(o.description === undefined
          ? {}
          : {
              description: text(
                o.description,
                `questions[${i}].options[${j}].description`,
                LIMITS.optionDescription,
                true,
              ),
            }),
      };
    });
    if (q.multiSelect !== undefined && typeof q.multiSelect !== "boolean")
      throw invalid(`questions[${i}].multiSelect must be a boolean`);
    return {
      question,
      header,
      options,
      ...(q.multiSelect === undefined ? {} : { multiSelect: q.multiSelect }),
    };
  });
}

function parseCreate(input: unknown): ParsedCreate {
  const body = plainObject(input, "body");
  exactKeys(body, [
    "kind",
    "agent",
    "session_id",
    "project",
    "tool",
    "input_summary",
    "questions",
    "timeout_ms",
    "suggestions_ok",
  ]);
  if (body.kind !== "permission" && body.kind !== "question")
    throw invalid('"kind" must be "permission" or "question"');
  if (typeof body.agent !== "string" || !/^[a-z0-9-]{1,24}$/.test(body.agent))
    throw invalid('"agent" must match [a-z0-9-]{1,24}');
  const sessionId = text(body.session_id, "session_id", LIMITS.sessionId);
  const project = text(body.project, "project", LIMITS.project);
  if (!isPosixAbsolute(project) && !win32.isAbsolute(project))
    throw invalid('"project" must be an absolute path');
  const tool = text(body.tool, "tool", LIMITS.tool);
  const rawSummary = plainObject(body.input_summary, "input_summary");
  exactKeys(rawSummary, ["command", "path", "description"]);
  const summary: ParsedCreate["input_summary"] = {};
  if (rawSummary.command !== undefined)
    summary.command = text(rawSummary.command, "input_summary.command", LIMITS.command, true);
  if (rawSummary.path !== undefined)
    summary.path = text(rawSummary.path, "input_summary.path", LIMITS.path, true);
  if (rawSummary.description !== undefined)
    summary.description = text(
      rawSummary.description,
      "input_summary.description",
      LIMITS.description,
      true,
    );
  if (body.kind === "question" && body.questions === undefined)
    throw invalid('"questions" is required for a question');
  if (body.kind === "permission" && body.questions !== undefined)
    throw invalid('"questions" is only allowed for a question');
  if (body.suggestions_ok !== undefined && typeof body.suggestions_ok !== "boolean")
    throw invalid('"suggestions_ok" must be a boolean');
  return {
    kind: body.kind,
    agent: body.agent,
    session_id: sessionId,
    project,
    tool,
    input_summary: summary,
    ...(body.questions === undefined ? {} : { questions: parseQuestions(body.questions) }),
    timeout_ms:
      body.timeout_ms === undefined
        ? DEFAULT_TIMEOUT_MS
        : integer(body.timeout_ms, "timeout_ms", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    suggestions_ok: body.suggestions_ok === true,
  };
}

function parseDecision(input: unknown): ParsedDecision {
  const body = plainObject(input, "body");
  exactKeys(body, ["behavior", "always", "answers", "message", "terminal"]);
  if (body.behavior !== "allow" && body.behavior !== "deny")
    throw invalid('"behavior" must be "allow" or "deny"');
  if (body.terminal !== undefined && body.terminal !== true)
    throw invalid('"terminal" may only be true');
  const parsed: ParsedDecision = { behavior: body.behavior, terminal: body.terminal === true };
  if (body.message !== undefined)
    parsed.message = text(body.message, "message", LIMITS.message, true);
  if (body.answers !== undefined) {
    const answers = plainObject(body.answers, "answers");
    const entries = Object.entries(answers);
    if (entries.length > LIMITS.questions) throw invalid("Too many answers");
    parsed.answers = Object.fromEntries(
      entries.map(([question, answer]) => [
        text(question, "answers key", LIMITS.question),
        text(answer, "answers value", LIMITS.answer, true),
      ]),
    );
  }
  if (body.always !== undefined) {
    const always = plainObject(body.always, "always");
    exactKeys(always, ["ttl_minutes", "pattern"]);
    parsed.always = {
      ttlMinutes: integer(always.ttl_minutes, "always.ttl_minutes", 1, 1440),
      ...(always.pattern === undefined
        ? {}
        : { pattern: text(always.pattern, "always.pattern", 200) }),
    };
  }
  if (parsed.terminal && (parsed.behavior !== "deny" || parsed.always || parsed.answers))
    throw invalid('"terminal" is only valid as a plain deny');
  if (parsed.always && parsed.behavior !== "allow")
    throw invalid('"always" is only valid with behavior "allow"');
  return parsed;
}

const PRODUCTION_SIGNAL = /\bprod(?:uction)?\b/i;

/** Maps an agent tool name onto the policy's side effects; unknown tools are treated as `execute`. */
function sideEffectOf(tool: string): SideEffect {
  const name = tool.toLowerCase();
  if (/^(read|glob|grep|ls|list|view|notebookread|todoread)/.test(name)) return "read";
  if (/^(web|fetch|search)/.test(name)) return "external";
  if (/^(edit|write|multiedit|notebookedit|apply_patch|create|delete|patch)/.test(name))
    return "write";
  return "execute";
}

const policyTool = (tool: string): string =>
  tool
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+$/, "") || "unknown";

/**
 * Risk of a request through the policy's own table. A request that touches something named
 * production (`prod`/`production` as a word in its command or path) is assessed as a production
 * action, which makes a state-changing one critical. Critical requests never get an Always rule.
 */
function riskOf(
  tool: string,
  subject: string | undefined,
): { risk: RiskTier; environment: Environment } {
  const environment: Environment =
    subject !== undefined && PRODUCTION_SIGNAL.test(subject) ? "production" : "local";
  const { risk } = assessRisk({ sideEffect: sideEffectOf(tool), permissions: [], environment });
  return { risk, environment };
}

const OWNER: Actor = { kind: "user", id: "owner", trustedByUser: true };

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const clientLabel = (client: string | undefined): string =>
  client !== undefined && /^[A-Za-z0-9 _.:-]{1,40}$/.test(client) ? client : "unknown";

function ruleView(rule: AgentRule): AgentApprovalRuleView {
  return {
    id: rule.id,
    project: rule.project,
    tool: rule.tool,
    pattern: rule.pattern,
    created_at: new Date(rule.createdAt).toISOString(),
    expires_at: new Date(rule.expiresAt).toISOString(),
    created_by: rule.createdBy,
    uses: rule.uses,
  };
}

/**
 * Phase 56: permission requests and questions raised by coding agents, answered from Fawkes.
 *
 * Pending requests live in memory only: a restart drops them and every waiting hook fails open
 * to its terminal. What happened to each request is in the audit log (`agent_approval.resolved`),
 * which backs `history()`. Only the holder of a request's id + nonce can receive its decision; the
 * decision and rule routes are plain session-token routes, not tool-gateway commands.
 */
export class AgentApprovals implements AgentApprovalsApi {
  private readonly entries = new Map<string, Entry>();
  private pendingCount = 0;
  private readonly clock: ApprovalClock;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly d: AgentApprovalsDeps) {
    this.clock = d.clock ?? systemClock;
    this.unsubscribe = d.bus.subscribe("agent-approvals", "security.kill_switch.engaged", () => {
      this.cancelAll();
    });
  }

  create(input: unknown): AgentApprovalCreateResult {
    const req = parseCreate(input);
    this.sweep();
    const digest = createHash("sha256")
      .update(
        canonicalJson({
          agent: req.agent,
          session_id: req.session_id,
          project: req.project,
          tool: req.tool,
          input_summary: req.input_summary,
        }),
      )
      .digest("hex");
    const id = `apr_${randomBytes(12).toString("hex")}`;
    const summary = {
      ...(req.input_summary.command === undefined
        ? {}
        : { command: redactText(req.input_summary.command) }),
      ...(req.input_summary.path === undefined ? {} : { path: redactText(req.input_summary.path) }),
      ...(req.input_summary.description === undefined
        ? {}
        : { description: redactText(req.input_summary.description) }),
    };
    const subject = req.input_summary.command ?? req.input_summary.path;
    const meta: AuditMeta = {
      id,
      kind: req.kind,
      agent: req.agent,
      project: req.project,
      tool: req.tool,
      summary,
    };

    if (this.closed || this.d.isKillSwitchEngaged()) {
      this.audit(meta, "terminal", "system", { reason: "kill_switch" }, false);
      return { id, digest, status: "terminal", reason: "kill_switch" };
    }

    const { risk, environment } = riskOf(req.tool, subject);
    if (req.kind === "permission") {
      const denied = this.d.policy.denyByRule(this.toolRequest(req, subject, environment), {
        agentApproval: id,
      });
      if (denied) {
        const message = truncate(
          `Denied by Phoenix policy: ${denied.decision.reasons[0] ?? "rule"}`,
          LIMITS.message,
        );
        const decision: AgentApprovalDecisionView = { behavior: "deny", message };
        this.audit(meta, "deny", "policy", { policyAuditId: denied.auditId }, true);
        this.emit("agent.approval.resolved", { id, outcome: "deny", decided_by: "policy" });
        return { id, digest, status: "decided", decision, decided_by: "policy" };
      }
      const rule =
        subject !== undefined && risk !== "critical" && redactText(subject) === subject
          ? this.d.rules.match(req.project, req.tool, subject)
          : undefined;
      if (rule && this.d.rules.recordUse(rule)) {
        this.audit(meta, "allow", "rule", { ruleId: rule.id, pattern: rule.pattern }, true);
        this.emit("agent.approval.resolved", { id, outcome: "allow", decided_by: "rule" });
        this.emit("agent.approval.rule.changed", {});
        return {
          id,
          digest,
          status: "decided",
          decision: { behavior: "allow" },
          decided_by: "rule",
        };
      }
    }

    if (this.pendingCount >= MAX_PENDING_APPROVALS) {
      this.audit(meta, "terminal", "system", { reason: "too_many_pending" }, false);
      return { id, digest, status: "terminal", reason: "too_many_pending" };
    }

    const now = this.clock.now();
    const nonce = randomBytes(16);
    const entry: Entry = {
      id,
      nonce,
      digest,
      kind: req.kind,
      agent: req.agent,
      project: req.project,
      tool: req.tool,
      summary,
      ...(req.questions ? { questions: req.questions } : {}),
      subject,
      alwaysOk:
        req.kind === "permission" &&
        req.suggestions_ok &&
        risk !== "critical" &&
        subject !== undefined &&
        agentRuleSubjectEligible(subject) &&
        redactText(subject) === subject,
      createdAt: now,
      expiresAt: now + req.timeout_ms,
      cancelExpiry: () => undefined,
      waiters: new Set(),
    };
    entry.cancelExpiry = this.clock.after(req.timeout_ms, () => {
      this.settleSystem(entry, "expired");
    });
    this.entries.set(id, entry);
    this.pendingCount++;
    this.emit("agent.approval.requested", {
      id,
      agent: req.agent,
      project: req.project,
      tool: req.tool,
      kind: req.kind,
      expires_at: new Date(entry.expiresAt).toISOString(),
      ...(summary.command === undefined
        ? {}
        : { command: truncate(summary.command, EVENT_COMMAND_CHARS) }),
    });
    return {
      id,
      nonce: nonce.toString("hex"),
      digest,
      expires_at: new Date(entry.expiresAt).toISOString(),
      status: "pending",
    };
  }

  wait(id: string, input: unknown): Promise<AgentApprovalWaitResult> {
    const body = plainObject(input, "body");
    exactKeys(body, ["nonce", "wait_ms"]);
    const nonce = text(body.nonce, "nonce", 100);
    const waitMs =
      body.wait_ms === undefined
        ? DEFAULT_WAIT_MS
        : integer(body.wait_ms, "wait_ms", 1, MAX_WAIT_MS);
    this.sweep();
    const entry = this.entries.get(id);
    const given = Buffer.from(/^[0-9a-f]+$/.test(nonce) ? nonce : "", "hex");
    // A wrong nonce and an unknown id answer identically, so a caller cannot probe for ids.
    if (
      !entry ||
      nonce.length !== entry.nonce.length * 2 ||
      given.length !== entry.nonce.length ||
      !timingSafeEqual(given, entry.nonce)
    )
      return Promise.reject(notFound());
    if (entry.settled) return Promise.resolve(this.waitResult(entry));
    const { promise, resolve } = Promise.withResolvers<AgentApprovalWaitResult>();
    const waiter: Waiter = {
      resolve,
      cancelTimer: this.clock.after(waitMs, () => {
        entry.waiters.delete(waiter);
        resolve(this.waitResult(entry));
      }),
    };
    entry.waiters.add(waiter);
    return promise;
  }

  list(): AgentApprovalPendingView[] {
    this.sweep();
    return [...this.entries.values()]
      .filter((e) => !e.settled)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        agent: e.agent,
        project: e.project,
        tool: e.tool,
        input_summary: e.summary,
        ...(e.questions ? { questions: e.questions } : {}),
        created_at: new Date(e.createdAt).toISOString(),
        expires_at: new Date(e.expiresAt).toISOString(),
        always_ok: e.alwaysOk,
      }));
  }

  decide(
    id: string,
    input: unknown,
    client?: string,
  ): { id: string; outcome: "allow" | "deny" | "terminal"; rule?: AgentApprovalRuleView } {
    const parsed = parseDecision(input);
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry) throw notFound();
    if (entry.settled)
      throw new PhoenixError(
        ErrorCode.EVENT_DUPLICATE,
        `Approval already ${entry.settled.status === "decided" ? "resolved" : entry.settled.status}`,
      );
    const label = clientLabel(client);

    if (entry.kind === "question") {
      if (parsed.always) throw invalid('"always" is only valid for a permission request');
      if (parsed.behavior === "allow" && !parsed.terminal) {
        const questions = entry.questions ?? [];
        const answers = parsed.answers ?? {};
        for (const q of questions) {
          if (answers[q.question] === undefined) throw invalid("Every question needs an answer");
        }
        if (Object.keys(answers).some((k) => !questions.some((q) => q.question === k)))
          throw invalid("Answer for a question that was not asked");
      }
    } else if (parsed.answers) {
      throw invalid('"answers" is only valid for a question');
    }

    let rule: AgentRule | undefined;
    if (parsed.always) {
      if (!entry.alwaysOk || entry.subject === undefined)
        throw invalid("An Always rule is not allowed for this request");
      const pattern = parsed.always.pattern ?? entry.subject;
      const problem = agentPatternProblem(pattern);
      if (problem) throw invalid(problem);
      if (!agentPatternMatches(pattern, entry.subject))
        throw invalid("The pattern does not cover this request");
      try {
        rule = this.d.rules.create({
          project: entry.project,
          tool: entry.tool,
          pattern,
          ttlMs: parsed.always.ttlMinutes * 60_000,
          by: OWNER,
        });
      } catch (err) {
        if (err instanceof PolicyError && err.code === "LIMIT_REACHED")
          throw new PhoenixError(ErrorCode.INVALID_REQUEST, err.message);
        throw err;
      }
    }

    const outcome = parsed.terminal ? ("terminal" as const) : parsed.behavior;
    const settled: Settled = parsed.terminal
      ? { status: "terminal" }
      : {
          status: "decided",
          decidedBy: "user",
          decision: {
            behavior: parsed.behavior,
            ...(parsed.message === undefined ? {} : { message: parsed.message }),
            ...(parsed.answers === undefined ? {} : { answers: parsed.answers }),
          },
        };
    this.settle(
      entry,
      settled,
      outcome,
      "user",
      { client: label, always: rule !== undefined, ...(rule ? { ruleId: rule.id } : {}) },
      true,
    );
    if (rule) this.emit("agent.approval.rule.changed", {});
    return { id, outcome, ...(rule ? { rule: ruleView(rule) } : {}) };
  }

  history(limit?: number): AgentApprovalHistoryRow[] {
    const n = Math.min(Math.max(limit ?? HISTORY_DEFAULT, 1), HISTORY_MAX);
    const rows = this.d.db
      .prepare(
        "SELECT ts, details FROM audit_log WHERE action = 'agent_approval.resolved' ORDER BY id DESC LIMIT ?",
      )
      .all(n) as unknown as { ts: string; details: string }[];
    const out: AgentApprovalHistoryRow[] = [];
    for (const row of rows) {
      try {
        const d = JSON.parse(row.details) as Record<string, string | undefined>;
        out.push({
          id: String(d.id),
          at: row.ts,
          agent: String(d.agent),
          project: String(d.project),
          tool: String(d.tool),
          command: d.command ?? d.path ?? "",
          outcome: String(d.outcome),
          decided_by: String(d.decided_by),
          ...(d.client === undefined ? {} : { client: d.client }),
        });
      } catch {
        // A row that is not ours to read is skipped, never fatal.
      }
    }
    return out;
  }

  rules(): AgentApprovalRuleView[] {
    return this.d.rules.list().map(ruleView);
  }

  revokeRule(id: string): void {
    try {
      this.d.rules.revoke(OWNER, id);
    } catch (err) {
      if (err instanceof PolicyError && err.code === "NOT_FOUND") throw notFound();
      throw err;
    }
    this.emit("agent.approval.rule.changed", {});
  }

  /** Cancels every pending request (emergency stop). Waiters get `cancelled`. */
  cancelAll(): void {
    for (const entry of [...this.entries.values()]) {
      if (!entry.settled) this.settleSystem(entry, "cancelled");
    }
  }

  close(): void {
    this.unsubscribe();
    this.cancelAll();
    this.closed = true;
  }

  private toolRequest(
    req: ParsedCreate,
    subject: string | undefined,
    environment: Environment,
  ): ToolRequest {
    const command = policyTool(req.tool);
    return {
      actor: { kind: "agent", id: req.agent, trustedByUser: false },
      tool: `agent_approval.${command}`,
      capabilityId: "agent_approval",
      command,
      sideEffect: sideEffectOf(req.tool),
      permissions: [],
      environment,
      ...(subject === undefined ? {} : { resource: subject }),
      at: new Date(this.clock.now()),
    };
  }

  /** Expires what is due and, with the emergency stop engaged, cancels what is pending. */
  private sweep(): void {
    const now = this.clock.now();
    const stopped = this.d.isKillSwitchEngaged();
    for (const entry of [...this.entries.values()]) {
      if (entry.settled) {
        if ((entry.settledAt ?? 0) + SETTLED_RETENTION_MS <= now) this.entries.delete(entry.id);
      } else if (stopped) this.settleSystem(entry, "cancelled");
      else if (entry.expiresAt <= now) this.settleSystem(entry, "expired");
    }
    const kept = [...this.entries.values()].filter((e) => e.settled);
    for (const old of kept.slice(0, Math.max(0, kept.length - MAX_SETTLED_KEPT)))
      this.entries.delete(old.id);
  }

  private settleSystem(entry: Entry, status: "expired" | "cancelled"): void {
    if (entry.settled) return;
    this.settle(entry, { status }, status, "system", {}, false);
  }

  private settle(
    entry: Entry,
    settled: Settled,
    outcome: Outcome,
    decidedBy: DecidedBy,
    extra: Record<string, unknown>,
    auditRequired: boolean,
  ): void {
    // Audit first: a user decision that cannot be recorded is not applied.
    this.audit(entryMeta(entry), outcome, decidedBy, extra, auditRequired);
    entry.settled = settled;
    entry.settledAt = this.clock.now();
    entry.subject = undefined;
    entry.cancelExpiry();
    this.pendingCount--;
    for (const waiter of entry.waiters) {
      waiter.cancelTimer();
      waiter.resolve(this.waitResult(entry));
    }
    entry.waiters.clear();
    this.emit("agent.approval.resolved", { id: entry.id, outcome, decided_by: decidedBy });
  }

  private waitResult(entry: Entry): AgentApprovalWaitResult {
    const s = entry.settled;
    if (!s) return { id: entry.id, digest: entry.digest, status: "pending" };
    if (s.status === "decided")
      return {
        id: entry.id,
        digest: entry.digest,
        status: "decided",
        decision: s.decision,
        decided_by: s.decidedBy,
      };
    return { id: entry.id, digest: entry.digest, status: s.status };
  }

  private audit(
    meta: AuditMeta,
    outcome: Outcome,
    decidedBy: DecidedBy,
    extra: Record<string, unknown>,
    required: boolean,
  ): void {
    const client = typeof extra.client === "string" ? extra.client : undefined;
    try {
      this.d.audit.record({
        actor: decidedBy === "user" ? `user:${client ?? "unknown"}` : decidedBy,
        action: "agent_approval.resolved",
        capabilityId: "agent_approval",
        decision:
          outcome === "allow"
            ? "allowed"
            : outcome === "deny"
              ? "denied"
              : outcome === "cancelled"
                ? "blocked"
                : "info",
        details: {
          id: meta.id,
          kind: meta.kind,
          agent: meta.agent,
          project: meta.project,
          tool: meta.tool,
          ...(meta.summary.command === undefined
            ? {}
            : { command: truncate(meta.summary.command, AUDIT_COMMAND_CHARS) }),
          ...(meta.summary.path === undefined
            ? {}
            : { path: truncate(meta.summary.path, AUDIT_COMMAND_CHARS) }),
          outcome,
          decided_by: decidedBy,
          ...extra,
        },
      });
    } catch (err) {
      if (required) throw err;
      this.d.logger.warn("agent approval could not be audited", { id: meta.id, error: err });
    }
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    const result = this.d.bus.publish(
      createEvent({ event_type: eventType, source: "core", severity: "info", payload }),
    );
    if (!result.ok)
      this.d.logger.warn("agent approval event rejected", { code: result.error.code });
  }
}

interface AuditMeta {
  id: string;
  kind: "permission" | "question";
  agent: string;
  project: string;
  tool: string;
  summary: { command?: string; path?: string; description?: string };
}

function entryMeta(entry: Entry): AuditMeta {
  return {
    id: entry.id,
    kind: entry.kind,
    agent: entry.agent,
    project: entry.project,
    tool: entry.tool,
    summary: entry.summary,
  };
}
