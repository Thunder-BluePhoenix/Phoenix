// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Database } from "@phoenix/persistence";
import { MAX_APPROVAL_TTL_MS } from "./admin";
import { PolicyError, type Actor, type PolicyAuditSink } from "./types";

/**
 * "Always allow here" rules for coding-agent permission requests (Phase 56).
 *
 * A rule is scoped to one agent (the one that raised the request: a `claude-code` rule never
 * allows `codex`), one project (absolute path) and one tool, and to a command pattern:
 * either the exact string, or a prefix ending in ` *` (`npm test *`). Nothing else: no regex, no
 * other wildcard. Rules expire (at most 24 h), are listed and revoked by the user, and every
 * create, use and revoke is audited. Like `PolicyAdmin`, only an authenticated user actor can
 * create or revoke one; the read side (`AgentRuleBook.match`) has no mutating method except the
 * use counter.
 */
export const AGENT_RULE_MAX_PATTERN = 200;
export const MAX_AGENT_RULES = 200;

/** Shell constructs that chain or redirect a command: a prefix rule never covers these. */
const CHAINING = /;|&|\||`|\$\(|<\(|\n|\r|>/;

/** True when `subject` contains a construct that could run or write something besides the head. */
export function isChained(subject: string): boolean {
  return CHAINING.test(subject);
}

const PREFIX_SUFFIX = " *";

/** Homoglyphs and invisible characters make a command read as something else to its approver. */
const NON_ASCII = /[^\x00-\x7f]/;

/** True when `subject` has any non-ASCII character. */
export const hasNonAscii = (subject: string): boolean => NON_ASCII.test(subject);

/**
 * Whether `subject` can be the subject of a rule at all: it must fit the pattern limit, and an
 * exact pattern ending in ` *` would be read back as a prefix, so such a subject has no exact form.
 * Subjects with non-ASCII characters never qualify: the user cannot tell what they approve.
 */
export function agentRuleSubjectEligible(subject: string): boolean {
  return (
    subject.length > 0 &&
    subject.length <= AGENT_RULE_MAX_PATTERN &&
    !subject.endsWith(PREFIX_SUFFIX) &&
    !hasNonAscii(subject)
  );
}

/** Returns why `pattern` is not allowed by the grammar, or undefined when it is. */
export function agentPatternProblem(pattern: unknown): string | undefined {
  if (typeof pattern !== "string" || pattern.length === 0)
    return "pattern must be a non-empty string";
  if (pattern.length > AGENT_RULE_MAX_PATTERN)
    return `pattern must be at most ${AGENT_RULE_MAX_PATTERN} characters`;
  if (hasNonAscii(pattern)) return "pattern must be ASCII";
  if (pattern.endsWith(PREFIX_SUFFIX)) {
    const prefix = pattern.slice(0, -PREFIX_SUFFIX.length);
    if (prefix.trim().length === 0) return "a prefix pattern needs text before ` *`";
    if (isChained(prefix)) return "a prefix pattern must not contain chaining or redirection";
  }
  return undefined;
}

/**
 * Whether the rule pattern covers `subject` (the command, or the path for file tools).
 * A subject that chains or redirects is covered only by the identical exact pattern.
 */
export function agentPatternMatches(pattern: string, subject: string): boolean {
  if (pattern === subject) return !pattern.endsWith(PREFIX_SUFFIX);
  if (isChained(subject)) return false;
  if (!pattern.endsWith(PREFIX_SUFFIX)) return false;
  return subject.startsWith(pattern.slice(0, -1));
}

export interface AgentRule {
  id: string;
  agent: string;
  project: string;
  tool: string;
  pattern: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string;
  uses: number;
}

interface RuleRow {
  id: string;
  agent: string;
  project: string;
  tool: string;
  pattern: string;
  created_at: number;
  expires_at: number;
  created_by: string;
  uses: number;
}

const toRule = (row: RuleRow): AgentRule => ({
  id: row.id,
  agent: row.agent,
  project: row.project,
  tool: row.tool,
  pattern: row.pattern,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  createdBy: row.created_by,
  uses: row.uses,
});

export interface AgentRuleBookOptions {
  db: Database;
  audit: PolicyAuditSink;
  now?: () => number;
}

export interface AgentRuleRequest {
  agent: string;
  project: string;
  tool: string;
  pattern: string;
  ttlMs: number;
  by: Actor;
}

/** Storage, matching and (user-only) administration of agent Always rules (table from migration 25). */
export class AgentRuleBook {
  private readonly db: Database;
  private readonly audit: PolicyAuditSink;
  private readonly now: () => number;

  constructor(o: AgentRuleBookOptions) {
    this.db = o.db;
    this.audit = o.audit;
    this.now = o.now ?? Date.now;
  }

  /** Active rules, oldest first. */
  list(): AgentRule[] {
    return (
      this.db
        .prepare("SELECT * FROM agent_approval_rules WHERE expires_at > ? ORDER BY created_at, id")
        .all(this.now()) as unknown as RuleRow[]
    ).map(toRule);
  }

  /** The active rule for this agent, project and tool that covers `subject`, if any. */
  match(agent: string, project: string, tool: string, subject: string): AgentRule | undefined {
    const rows = this.db
      .prepare(
        "SELECT * FROM agent_approval_rules WHERE agent = ? AND project = ? AND tool = ? AND expires_at > ? ORDER BY created_at, id",
      )
      .all(agent, project, tool, this.now()) as unknown as RuleRow[];
    return rows.map(toRule).find((r) => agentPatternMatches(r.pattern, subject));
  }

  /** Counts a use and audits it. Returns false if the rule is gone or expired meanwhile. */
  recordUse(rule: AgentRule): boolean {
    const result = this.db
      .prepare("UPDATE agent_approval_rules SET uses = uses + 1 WHERE id = ? AND expires_at > ?")
      .run(rule.id, this.now());
    if (Number(result.changes) === 0) return false;
    this.record(
      { kind: "system", id: "agent-rule", trustedByUser: false },
      "agent_approval.rule.used",
      {
        ruleId: rule.id,
        agent: rule.agent,
        project: rule.project,
        tool: rule.tool,
        pattern: rule.pattern,
      },
    );
    return true;
  }

  create(request: AgentRuleRequest): AgentRule {
    const { agent, project, tool, pattern, ttlMs, by } = request;
    this.requireUser(by, "agent_approval.rule.create");
    const problems: string[] = [];
    if (typeof agent !== "string" || !/^[a-z0-9-]{1,24}$/.test(agent))
      problems.push("agent must match [a-z0-9-]{1,24}");
    if (typeof project !== "string" || project.length === 0 || project.length > 1000)
      problems.push("project must be an absolute path of at most 1000 characters");
    if (typeof tool !== "string" || tool.length === 0 || tool.length > 100)
      problems.push("tool must be a non-empty string of at most 100 characters");
    const patternProblem = agentPatternProblem(pattern);
    if (patternProblem) problems.push(patternProblem);
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) problems.push("ttlMs must be a positive integer");
    else if (ttlMs > MAX_APPROVAL_TTL_MS) problems.push("ttlMs must be at most 24 h");
    if (problems.length > 0) {
      this.record(by, "agent_approval.rule.rejected", { agent, project, tool, problems }, "denied");
      throw new PolicyError("INVALID_APPROVAL", "Invalid agent approval rule", problems);
    }

    const nowMs = this.now();
    // Expired rules carry no information the audit log does not already hold.
    this.db.prepare("DELETE FROM agent_approval_rules WHERE expires_at <= ?").run(nowMs);
    const existing = this.db
      .prepare(
        "SELECT * FROM agent_approval_rules WHERE agent = ? AND project = ? AND tool = ? AND pattern = ?",
      )
      .get(agent, project, tool, pattern) as unknown as RuleRow | undefined;
    const expiresAt = nowMs + ttlMs;
    if (existing) {
      // The same scope again refreshes the expiry instead of stacking duplicates.
      this.record(by, "agent_approval.rule.created", {
        ruleId: existing.id,
        agent,
        project,
        tool,
        pattern,
        expiresAt: new Date(expiresAt).toISOString(),
        refreshed: true,
      });
      this.db
        .prepare("UPDATE agent_approval_rules SET expires_at = ? WHERE id = ?")
        .run(expiresAt, existing.id);
      return toRule({ ...existing, expires_at: expiresAt });
    }
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM agent_approval_rules").get() as {
      n: number;
    };
    if (count.n >= MAX_AGENT_RULES)
      throw new PolicyError("LIMIT_REACHED", `At most ${MAX_AGENT_RULES} agent rules are allowed`);

    const rule: AgentRule = {
      id: `arl_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      agent,
      project,
      tool,
      pattern,
      createdAt: nowMs,
      expiresAt,
      createdBy: `${by.kind}:${by.id}`.slice(0, 120),
      uses: 0,
    };
    this.record(by, "agent_approval.rule.created", {
      ruleId: rule.id,
      agent,
      project,
      tool,
      pattern,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    this.db
      .prepare(
        `INSERT INTO agent_approval_rules (id, agent, project, tool, pattern, created_at, expires_at, created_by, uses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(rule.id, agent, project, tool, pattern, rule.createdAt, rule.expiresAt, rule.createdBy);
    return rule;
  }

  /**
   * Takes back a rule `create` just made because the decision it belonged to could not be
   * recorded: restores the previous expiry when the create only refreshed an existing rule,
   * deletes it otherwise. Never throws; the audit note is best-effort.
   */
  undo(rule: AgentRule, previousExpiresAt: number | undefined): void {
    if (previousExpiresAt === undefined)
      this.db.prepare("DELETE FROM agent_approval_rules WHERE id = ?").run(rule.id);
    else
      this.db
        .prepare("UPDATE agent_approval_rules SET expires_at = ? WHERE id = ?")
        .run(previousExpiresAt, rule.id);
    try {
      this.record(
        { kind: "system", id: "agent-rule", trustedByUser: false },
        "agent_approval.rule.rolled_back",
        { ruleId: rule.id, agent: rule.agent, project: rule.project, tool: rule.tool },
      );
    } catch {
      // The rule is already gone; nothing more can be said if the audit log is the failure.
    }
  }

  revoke(by: Actor, id: string): void {
    this.requireUser(by, "agent_approval.rule.revoke");
    this.record(by, "agent_approval.rule.revoked", { ruleId: id });
    const result = this.db
      .prepare("DELETE FROM agent_approval_rules WHERE id = ? AND expires_at > ?")
      .run(id, this.now());
    if (Number(result.changes) === 0) throw new PolicyError("NOT_FOUND", `No active rule "${id}"`);
  }

  private requireUser(by: Actor, action: string): void {
    if (by?.kind === "user" && by.trustedByUser === true && by.id.length > 0) return;
    try {
      this.record(
        by ?? { kind: "agent", id: "unknown", trustedByUser: false },
        `${action}.refused`,
        { reason: "Only an authenticated user can change agent approval rules" },
        "denied",
      );
    } catch {
      // The refusal stands even if the audit write fails.
    }
    throw new PolicyError(
      "NOT_USER_ACTOR",
      "Only an authenticated user can change agent approval rules",
    );
  }

  private record(
    by: Actor,
    action: string,
    details: Record<string, unknown>,
    decision: "info" | "denied" = "info",
  ): void {
    try {
      this.audit.record({
        actor: `${by.kind}:${by.id}`.slice(0, 120),
        action,
        capabilityId: "agent_approval",
        decision,
        details,
      });
    } catch (err) {
      throw new PolicyError("AUDIT_FAILED", "Agent rule change could not be recorded", [
        String(err),
      ]);
    }
  }
}
