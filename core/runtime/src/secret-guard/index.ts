// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Secret guard (Phase 79), Core side: receives what the guard hook reports
// (`POST /api/secret-guard/result`), puts it in the audit log, and answers `GET /api/secret-guard`.
//
// What a result may contain: an outcome, the agent and tool names, the session id, kinds and
// locations of findings, the SHA-256 of the scanned content and a scope word. NEVER content. The
// payload is validated field by field, every string is checked with the same detector the hook
// uses, and a payload in which ANY string looks like a secret is refused whole (the sender is
// broken or hostile; nothing of it is kept).
//
// An "overridden" result is only accepted when the audit log holds an approval row that a USER
// allowed for the tool `SecretGuard` and whose card carried this content hash AND this session id:
// the hook cannot claim an override that the owner never granted. One approval proves ONE override:
// the approval id is recorded in the override's audit row and a second claim with it is refused.
// `blocked` and `allowed` results are rate limited (MAX_PER_MINUTE each minute) so a token holder
// cannot fill the audit log; an `overridden` result is already bounded by the owner's approvals.
import { GUARD_KINDS, isGuardKind, safeLocation, secretPaths } from "@phoenix/capability-agents";
import type { SecretGuardApi, SecretGuardRecentView, SecretGuardStatusView } from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";

export const GUARD_AUDIT_PREFIX = "secret_guard.";
const OUTCOMES = ["blocked", "overridden", "allowed"] as const;
type Outcome = (typeof OUTCOMES)[number];
const SCOPES = ["staged changes", "working tree", "unpushed commits and staged changes"] as const;
const AGENT = /^[a-z0-9-]{1,24}$/;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const TOOL = /^[\w .:@/-]{1,100}$/u;
const HASH = /^[0-9a-f]{64}$/;
const MAX_FINDINGS = 20;
const RECENT = 20;
/** Approval rows searched for the override proof. */
const PROOF_ROWS = 500;
/** Accepted `blocked` + `allowed` results per minute; more are refused. */
export const MAX_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const KEYS = ["outcome", "agent", "session_id", "tool", "findings", "content_hash", "scope"];

export interface SecretGuardDeps {
  db: Database;
  bus: EventBus;
  audit: AuditLog;
  logger: Logger;
  /** Injected clock for the rate limit (ms). Default Date.now. */
  now?: () => number;
}

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

interface Report {
  outcome: Outcome;
  agent: string;
  session_id: string;
  tool: string;
  findings: { kind: string; location: string }[];
  content_hash: string;
  scope: string | null;
}

function parse(input: unknown): Report {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw invalid("Body must be a JSON object");
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!KEYS.includes(key)) throw invalid(`Unknown field "${key.slice(0, 40)}"`);
  }
  // Refuse a payload that carries a secret anywhere, before looking at anything else. Only JSON
  // paths are reported, never the value.
  const found = secretPaths(body);
  if (found.length > 0) {
    throw new PhoenixError(
      ErrorCode.SECURITY_POLICY_BLOCKED,
      "A secret guard result must not contain secrets",
      found.slice(0, 5),
    );
  }
  const outcome = body.outcome;
  if (!OUTCOMES.includes(outcome as Outcome))
    throw invalid('"outcome" must be blocked, overridden or allowed');
  if (typeof body.agent !== "string" || !AGENT.test(body.agent))
    throw invalid('"agent" must match [a-z0-9-]{1,24}');
  if (typeof body.session_id !== "string" || !SESSION.test(body.session_id))
    throw invalid('"session_id" must be a session id');
  if (typeof body.tool !== "string" || !TOOL.test(body.tool))
    throw invalid('"tool" must be a tool name');
  if (typeof body.content_hash !== "string" || !HASH.test(body.content_hash))
    throw invalid('"content_hash" must be a SHA-256');
  if (body.scope !== null && !(SCOPES as readonly unknown[]).includes(body.scope))
    throw invalid('"scope" is not a known scope');
  if (!Array.isArray(body.findings) || body.findings.length > MAX_FINDINGS)
    throw invalid(`"findings" must be a list of at most ${MAX_FINDINGS}`);
  const findings = body.findings.map((f, i) => {
    if (f === null || typeof f !== "object" || Array.isArray(f))
      throw invalid(`findings[${i}] must be an object`);
    const { kind, location, ...rest } = f as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw invalid(`findings[${i}] has an unknown field`);
    if (!isGuardKind(kind))
      throw invalid(`findings[${i}].kind must be one of ${GUARD_KINDS.join(", ")}`);
    if (typeof location !== "string" || location.length === 0 || location.length > 200)
      throw invalid(`findings[${i}].location must be 1-200 characters`);
    // Locations are re-cleaned: control characters flattened, anything secret-looking hidden.
    return { kind, location: safeLocation(location) };
  });
  if (outcome !== "allowed" && findings.length === 0)
    throw invalid("A block or override needs findings");
  if (outcome === "allowed" && findings.length > 0)
    throw invalid("An allowed result has no findings");
  return {
    outcome: outcome as Outcome,
    agent: body.agent,
    session_id: body.session_id,
    tool: body.tool,
    findings,
    content_hash: body.content_hash,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

export class SecretGuard implements SecretGuardApi {
  constructor(private readonly d: SecretGuardDeps) {}

  private readonly stamps: number[] = [];
  /** Approval ids already used for an override (the audit log is the durable copy). */
  private readonly consumed = new Set<string>();

  /** Counts a `blocked`/`allowed` result against the per-minute budget; false when it is spent. */
  private withinRate(): boolean {
    const now = (this.d.now ?? Date.now)();
    while (this.stamps.length > 0 && this.stamps[0]! <= now - WINDOW_MS) this.stamps.shift();
    if (this.stamps.length >= MAX_PER_MINUTE) return false;
    this.stamps.push(now);
    return true;
  }

  /** Approval ids that an earlier override already used, read from the audit log. */
  private usedApprovals(): Set<string> {
    const used = new Set(this.consumed);
    const rows = this.d.db
      .prepare(
        "SELECT details FROM audit_log WHERE action = 'secret_guard.overridden' ORDER BY id DESC LIMIT ?",
      )
      .all(PROOF_ROWS) as unknown as { details: string }[];
    for (const row of rows) {
      try {
        const id = (JSON.parse(row.details) as Record<string, unknown>).approval_id;
        if (typeof id === "string") used.add(id);
      } catch {
        // skipped
      }
    }
    return used;
  }

  /**
   * The id of a card a user allowed for the tool `SecretGuard` carrying this hash and session id
   * that no earlier override has used, or null (the audit log is the proof).
   */
  private overrideProof(agent: string, sessionId: string, hash: string): string | null {
    const used = this.usedApprovals();
    const rows = this.d.db
      .prepare(
        "SELECT details FROM audit_log WHERE action = 'agent_approval.resolved' ORDER BY id DESC LIMIT ?",
      )
      .all(PROOF_ROWS) as unknown as { details: string }[];
    for (const row of rows) {
      try {
        const d = JSON.parse(row.details) as Record<string, unknown>;
        if (
          d.tool !== "SecretGuard" ||
          d.agent !== agent ||
          d.outcome !== "allow" ||
          d.decided_by !== "user" ||
          typeof d.id !== "string" ||
          used.has(d.id) ||
          typeof d.detail !== "string"
        )
          continue;
        if (
          d.detail.includes(`"content_hash":"${hash}"`) &&
          d.detail.includes(`"session_id":${JSON.stringify(sessionId)}`)
        )
          return d.id;
      } catch {
        // A row that is not ours to read is skipped.
      }
    }
    return null;
  }

  record(input: unknown): { recorded: true } {
    const report = parse(input);
    let approvalId: string | null = null;
    if (report.outcome === "overridden") {
      approvalId = this.overrideProof(report.agent, report.session_id, report.content_hash);
      if (approvalId === null) {
        throw new PhoenixError(
          ErrorCode.PERMISSION_DENIED,
          "No unused owner approval for this content and session was found, so the override was not recorded",
        );
      }
    } else if (!this.withinRate()) {
      throw new PhoenixError(
        ErrorCode.PERMISSION_DENIED,
        "Too many secret guard results this minute; this one was not recorded",
      );
    }
    if (approvalId !== null) {
      this.consumed.add(approvalId);
      if (this.consumed.size > PROOF_ROWS)
        this.consumed.delete(this.consumed.values().next().value!);
    }
    this.d.audit.record({
      actor: report.agent,
      action: `${GUARD_AUDIT_PREFIX}${report.outcome}`,
      capabilityId: "secret_guard",
      decision: report.outcome === "blocked" ? "blocked" : "allowed",
      details: {
        agent: report.agent,
        session_id: report.session_id,
        tool: report.tool,
        findings: report.findings,
        content_hash: report.content_hash,
        scope: report.scope,
        ...(approvalId === null ? {} : { approval_id: approvalId }),
      },
    });
    const published = this.d.bus.publish(
      createEvent({
        event_type: `${GUARD_AUDIT_PREFIX}${report.outcome}`,
        source: "core",
        severity: report.outcome === "blocked" ? "warning" : "info",
        payload: {
          agent: report.agent,
          tool: report.tool,
          kinds: [...new Set(report.findings.map((f) => f.kind))],
        },
      }),
      { ephemeral: true },
    );
    if (!published.ok)
      this.d.logger.warn("secret guard event rejected", { code: published.error.code });
    return { recorded: true };
  }

  status(): SecretGuardStatusView {
    const count = (outcome: Outcome): number => {
      // node:sqlite rows are plain records; the query selects exactly this column.
      const row = this.d.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?")
        .get(`${GUARD_AUDIT_PREFIX}${outcome}`) as unknown as { n: number } | undefined;
      return row?.n ?? 0;
    };
    const first = this.d.db
      .prepare(
        "SELECT ts FROM audit_log WHERE action LIKE 'secret_guard.%' ORDER BY id ASC LIMIT 1",
      )
      .get() as unknown as { ts: string } | undefined;
    const rows = this.d.db
      .prepare(
        "SELECT ts, action, details FROM audit_log WHERE action IN ('secret_guard.blocked','secret_guard.overridden') ORDER BY id DESC LIMIT ?",
      )
      .all(RECENT) as unknown as { ts: string; action: string; details: string }[];
    const recent: SecretGuardRecentView[] = [];
    for (const row of rows) {
      try {
        const d = JSON.parse(row.details) as {
          agent?: string;
          tool?: string;
          findings?: { kind: string; location: string }[];
        };
        recent.push({
          at: row.ts,
          outcome: row.action === "secret_guard.blocked" ? "blocked" : "overridden",
          agent: String(d.agent ?? ""),
          tool: String(d.tool ?? ""),
          findings: (d.findings ?? []).map((f) => ({
            kind: String(f.kind),
            location: String(f.location),
          })),
        });
      } catch {
        // skipped
      }
    }
    return {
      allowed: count("allowed"),
      blocked: count("blocked"),
      overridden: count("overridden"),
      since: first?.ts ?? null,
      recent,
    };
  }
}
