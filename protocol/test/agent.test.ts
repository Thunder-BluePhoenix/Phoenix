// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AGENT_RUN_STATES,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminalRunState,
  RUN_TRANSITIONS,
  validateAgentDescriptor,
  validateAgentRun,
  validateAgentTask,
  validateDiagnosis,
  validateEvidence,
  validatePlan,
  validateToolRequest,
  validateToolResult,
  validateVerification,
  type AgentRunState,
} from "../src";

/** The whole table, written out independently of RUN_TRANSITIONS. */
const LEGAL: readonly (readonly [AgentRunState, AgentRunState])[] = [
  ["CREATED", "READY"],
  ["CREATED", "FAILED"],
  ["CREATED", "CANCELLED"],
  ["READY", "RUNNING"],
  ["READY", "FAILED"],
  ["READY", "CANCELLED"],
  ["RUNNING", "WAITING_APPROVAL"],
  ["RUNNING", "VERIFYING"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "CANCELLED"],
  ["WAITING_APPROVAL", "RUNNING"],
  ["WAITING_APPROVAL", "FAILED"],
  ["WAITING_APPROVAL", "CANCELLED"],
  ["VERIFYING", "COMPLETED"],
  ["VERIFYING", "FAILED"],
  ["VERIFYING", "CANCELLED"],
];

describe("agent run state machine", () => {
  const pairs = AGENT_RUN_STATES.flatMap((from) =>
    AGENT_RUN_STATES.map((to) => [from, to] as const),
  );

  it("covers all 64 (from, to) pairs", () => {
    expect(pairs).toHaveLength(64);
  });

  it.each(pairs)("%s -> %s", (from, to) => {
    const legal = LEGAL.some(([f, t]) => f === from && t === to);
    expect(canTransition(from, to)).toBe(legal);
    if (legal) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      const err = (() => {
        try {
          assertTransition(from, to);
        } catch (e) {
          return e;
        }
        return undefined;
      })();
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect(err).toMatchObject({ from, to });
    }
  });

  it("terminal states are exactly COMPLETED, FAILED and CANCELLED and have no exits", () => {
    const terminal = AGENT_RUN_STATES.filter(isTerminalRunState);
    expect(terminal).toEqual(["COMPLETED", "FAILED", "CANCELLED"]);
    for (const s of terminal) expect(RUN_TRANSITIONS[s]).toEqual([]);
  });

  it("COMPLETED is reachable only from VERIFYING", () => {
    const into = AGENT_RUN_STATES.filter((s) => canTransition(s, "COMPLETED"));
    expect(into).toEqual(["VERIFYING"]);
  });

  it("rejects a state name that is not in the table", () => {
    expect(() => assertTransition("RUNNING", "PAUSED" as AgentRunState)).toThrow(
      InvalidTransitionError,
    );
  });
});

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

describe("agent object validation", () => {
  const task = {
    id: "task_1",
    kind: "ci_failure",
    input: { repository: "o/r" },
    requestedBy: "user",
    createdAt: "2026-10-09T10:00:00.000Z",
    correlationId: "agent_task_1",
  };

  it("accepts well-formed objects", () => {
    expect(validateAgentTask(task).ok).toBe(true);
    expect(
      validateAgentDescriptor({ id: "ci-failure", kind: "ci_failure", version: "1.0.0" }).ok,
    ).toBe(true);
    expect(
      validateAgentRun({
        id: "run_1",
        taskId: "task_1",
        agentId: "ci-failure",
        state: "CREATED",
        createdAt: task.createdAt,
        updatedAt: task.createdAt,
      }).ok,
    ).toBe(true);
    expect(
      validatePlan({
        steps: [{ index: 0, tool: "github.ci.failure_details", input: {}, purpose: "x" }],
      }).ok,
    ).toBe(true);
    expect(validateToolRequest({ tool: "git.recent_commits", input: {} }).ok).toBe(true);
    expect(validateToolResult({ tool: "git.recent_commits", ok: true, auditId: 3 }).ok).toBe(true);
    expect(
      validateEvidence({
        id: "ev_1",
        kind: "commit",
        source: "git.recent_commits",
        excerptHash: hash("x"),
        excerpt: "x",
        truncated: false,
      }).ok,
    ).toBe(true);
    expect(
      validateVerification({ passed: true, checks: [{ name: "a", passed: true, detail: "" }] }).ok,
    ).toBe(true);
    expect(
      validateDiagnosis({
        summary: "s",
        claims: [{ text: "c", evidenceIds: ["ev_1"], grounded: true }],
        evidenceCoverage: 1,
        aiUsed: false,
      }).ok,
    ).toBe(true);
  });

  it("rejects non-objects, arrays, null and primitives for every validator", () => {
    const all = [
      validateAgentTask,
      validateAgentDescriptor,
      validateAgentRun,
      validatePlan,
      validateToolRequest,
      validateToolResult,
      validateEvidence,
      validateVerification,
      validateDiagnosis,
    ];
    for (const v of all)
      for (const bad of [null, undefined, 7, "x", [], true]) expect(v(bad).ok).toBe(false);
  });

  it("rejects extra fields (a model cannot smuggle risk or approval into a plan)", () => {
    const step = { index: 0, tool: "github.ci.failure_details", input: {}, purpose: "x" };
    expect(validatePlan({ steps: [{ ...step, risk: "low" }] }).ok).toBe(false);
    expect(validatePlan({ steps: [step], approved: true }).ok).toBe(false);
    expect(validateToolRequest({ tool: "a.b", input: {}, environment: "local" }).ok).toBe(false);
    expect(validateAgentTask({ ...task, trusted: true }).ok).toBe(false);
  });

  it("rejects hostile tool names, ids, states, hashes and oversize values", () => {
    for (const tool of [
      "",
      "nodot",
      "A.b",
      "a.b c",
      "../x.y",
      "a.b\nc",
      "a".repeat(200) + ".b",
      "__proto__",
    ])
      expect(validateToolRequest({ tool, input: {} }).ok).toBe(false);
    for (const id of ["", "../x", "a b", "x".repeat(101), "-start"])
      expect(validateAgentTask({ ...task, id }).ok).toBe(false);
    expect(
      validateAgentRun({
        id: "r",
        taskId: "t",
        agentId: "a",
        state: "DONE",
        createdAt: task.createdAt,
        updatedAt: task.createdAt,
      }).ok,
    ).toBe(false);
    const ev = {
      id: "e",
      kind: "log",
      source: "s",
      excerptHash: "zz",
      excerpt: "x",
      truncated: false,
    };
    expect(validateEvidence(ev).ok).toBe(false);
    expect(validateEvidence({ ...ev, excerptHash: hash("x"), kind: "guess" }).ok).toBe(false);
    expect(validateEvidence({ ...ev, excerptHash: hash("x"), excerpt: "x".repeat(4001) }).ok).toBe(
      false,
    );
    expect(
      validatePlan({
        steps: Array.from({ length: 21 }, (_, index) => ({
          index,
          tool: "a.b",
          input: {},
          purpose: "",
        })),
      }).ok,
    ).toBe(false);
    expect(validateAgentTask({ ...task, createdAt: "yesterday" }).ok).toBe(false);
    expect(validateToolResult({ tool: "a.b", ok: true, decision: "maybe" }).ok).toBe(false);
    expect(
      validateDiagnosis({ summary: "s", claims: [], evidenceCoverage: 1.5, aiUsed: false }).ok,
    ).toBe(false);
    expect(
      validateDiagnosis({
        summary: "s",
        claims: [{ text: "c", evidenceIds: [] }],
        evidenceCoverage: 0,
        aiUsed: false,
      }).ok,
    ).toBe(false);
  });

  it("does not throw on prototype-pollution shaped input", () => {
    const hostile: unknown = JSON.parse(
      '{"__proto__":{"x":1},"id":"a","kind":"k","input":{},"requestedBy":"u","createdAt":"2026-10-09T10:00:00Z","correlationId":"c"}',
    );
    expect(() => validateAgentTask(hostile)).not.toThrow();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
