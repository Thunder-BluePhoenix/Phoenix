// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Secret guard, Core side: the limits on what a session-token holder can make it record. A real
// in-memory database and audit log, an injected clock, approval rows written the way
// AgentApprovals writes them. No Core, no network.
import { createHash } from "node:crypto";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import { AuditLog } from "@phoenix/permissions";
import { openDatabase, type Database } from "@phoenix/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PER_MINUTE, SecretGuard } from "../src/secret-guard";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");
const HASH = hashOf("content");
const SESSION_A = "session-aaaa";
const SESSION_B = "session-bbbb";

function setup() {
  const db = openDatabase(":memory:");
  dbs.push(db);
  let at = Date.parse("2026-10-22T09:00:00Z");
  const audit = new AuditLog(db, () => at);
  const guard = new SecretGuard({
    db,
    bus: new EventBus(),
    audit,
    logger: silentLogger,
    now: () => at,
  });
  let n = 0;
  /** An approval row exactly as AgentApprovals audits a decided SecretGuard card. */
  const approve = (hash: string, session: string, decidedBy = "user") =>
    audit.record({
      actor: "user:test",
      action: "agent_approval.resolved",
      decision: "allowed",
      details: {
        id: `approval-${++n}`,
        agent: "claude-code",
        tool: "SecretGuard",
        outcome: "allow",
        decided_by: decidedBy,
        detail: JSON.stringify({ blocked_tool: "Bash", content_hash: hash, session_id: session }),
      },
    });
  return {
    guard,
    approve,
    advance: (ms: number) => void (at += ms),
  };
}

const report = (over: Record<string, unknown> = {}) => ({
  outcome: "blocked",
  agent: "claude-code",
  session_id: SESSION_A,
  tool: "Bash",
  findings: [{ kind: "github_token", location: "tool_input.command" }],
  content_hash: HASH,
  scope: null,
  ...over,
});
const overridden = (over: Record<string, unknown> = {}) =>
  report({ outcome: "overridden", ...over });
const allowedReport = () => report({ outcome: "allowed", findings: [] });

describe("rate limit on blocked and allowed rows", () => {
  it("refuses results past the per-minute budget and accepts again a minute later", () => {
    const { guard, advance } = setup();
    for (let i = 0; i < MAX_PER_MINUTE; i++)
      expect(guard.record(i % 2 === 0 ? report() : allowedReport())).toEqual({ recorded: true });
    expect(() => guard.record(report())).toThrow(/Too many/);
    expect(() => guard.record(allowedReport())).toThrow(/Too many/);
    expect(guard.status().blocked + guard.status().allowed).toBe(MAX_PER_MINUTE);
    advance(60_001);
    expect(guard.record(report())).toEqual({ recorded: true });
  });
});

describe("an override proof is single use and bound to the session", () => {
  it("records one override per approval; a replay is refused", () => {
    const { guard, approve } = setup();
    approve(HASH, SESSION_A);
    expect(guard.record(overridden())).toEqual({ recorded: true });
    expect(() => guard.record(overridden())).toThrow(/No unused owner approval/);
    expect(guard.status().overridden).toBe(1);
  });

  it("two approvals allow two overrides, no more", () => {
    const { guard, approve } = setup();
    approve(HASH, SESSION_A);
    approve(HASH, SESSION_A);
    guard.record(overridden());
    guard.record(overridden());
    expect(() => guard.record(overridden())).toThrow();
  });

  it("an approval of another session does not cover this one", () => {
    const { guard, approve } = setup();
    approve(HASH, SESSION_B);
    expect(() => guard.record(overridden({ session_id: SESSION_A }))).toThrow(
      /No unused owner approval/,
    );
    expect(guard.record(overridden({ session_id: SESSION_B }))).toEqual({ recorded: true });
  });

  it("a rule's or policy's decision is not an owner's", () => {
    const { guard, approve } = setup();
    approve(HASH, SESSION_A, "policy");
    expect(() => guard.record(overridden())).toThrow();
  });

  it("the replay is refused after a restart too (the audit row remembers)", () => {
    const first = setup();
    first.approve(HASH, SESSION_A);
    first.guard.record(overridden());
    // A fresh guard over the same database: the in-memory set is empty, the audit log is not.
    const again = new SecretGuard({
      db: dbs[0]!,
      bus: new EventBus(),
      audit: new AuditLog(dbs[0]!),
      logger: silentLogger,
    });
    expect(() => again.record(overridden())).toThrow(/No unused owner approval/);
  });

  it("overrides are not counted against the blocked/allowed budget", () => {
    const { guard, approve } = setup();
    for (let i = 0; i < MAX_PER_MINUTE; i++) guard.record(report());
    approve(HASH, SESSION_A);
    expect(guard.record(overridden())).toEqual({ recorded: true });
  });
});
