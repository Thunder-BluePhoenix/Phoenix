// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { definitionHash } from "../src/canonical";
import { LIMITS, type ToolCatalog, type ToolFacts, type WorkflowDefinition } from "../src";
import { requiresAuthorisation, validateDefinition } from "../src/validate";
import { deployFailedWorkflow } from "./fixtures";

const FACTS: Record<string, ToolFacts> = {
  "deploys.logs": {
    name: "deploys.logs",
    sideEffect: "read",
    permissions: [],
    idempotent: true,
    timeoutMs: 1000,
  },
  "deploys.flaky": {
    name: "deploys.flaky",
    sideEffect: "read",
    permissions: [],
    idempotent: true,
    timeoutMs: 1000,
  },
  "deploys.restart": {
    name: "deploys.restart",
    sideEffect: "write",
    permissions: ["filesystem_write"],
    idempotent: false,
    timeoutMs: 1000,
  },
  "deploys.undo_restart": {
    name: "deploys.undo_restart",
    sideEffect: "write",
    permissions: ["filesystem_write"],
    idempotent: false,
    timeoutMs: 1000,
  },
  "deploys.rollback": {
    name: "deploys.rollback",
    sideEffect: "production",
    permissions: ["production_action"],
    idempotent: false,
    timeoutMs: 1000,
  },
};
const catalog: ToolCatalog = (name) => (Object.hasOwn(FACTS, name) ? FACTS[name] : undefined);

const problemsOf = (value: unknown, c: ToolCatalog | null = catalog) => {
  const r = validateDefinition(value, c ?? undefined);
  return r.ok ? [] : r.problems;
};
const clone = (): WorkflowDefinition => structuredClone(deployFailedWorkflow());

describe("definition validation", () => {
  it("accepts the example workflow", () => {
    expect(problemsOf(deployFailedWorkflow())).toEqual([]);
  });

  it("is data: unknown fields, wrong types and non-objects are refused", () => {
    const withExtra = { ...clone(), extra: 1 };
    expect(problemsOf(withExtra).join()).toMatch(/additional properties/);
    const stepExtra = clone();
    (stepExtra.steps[0] as unknown as Record<string, unknown>)["script"] = "rm -rf /";
    expect(problemsOf(stepExtra).join()).toMatch(/additional properties/);
    for (const v of [null, 5, "x", [], {}, { steps: [] }])
      expect(problemsOf(v).length).toBeGreaterThan(0);
    const badEnv = { ...clone(), environment: "prod" };
    expect(problemsOf(badEnv).length).toBeGreaterThan(0);
  });

  it("refuses a tool that is not declared (load-time check)", () => {
    const d = clone();
    d.declares.tools = ["deploys.logs"];
    expect(problemsOf(d).join()).toMatch(/deploys\.rollback" is not listed in declares\.tools/);
  });

  it("refuses declared tools nothing uses, unknown tools and duplicates", () => {
    const d = clone();
    d.declares.tools.push("deploys.flaky");
    expect(problemsOf(d).join()).toMatch(/lists deploys\.flaky but no step uses it/);
    const e = clone();
    e.declares.tools.push("deploys.logs");
    expect(problemsOf(e).join()).toMatch(/twice/);
    const f = clone();
    f.declares.tools = ["deploys.logs", "deploys.nope"];
    (f.steps[5] as { tool: string }).tool = "deploys.nope";
    expect(problemsOf(f).join()).toMatch(/not an available tool/);
    // Without a catalog the structure is still checked.
    expect(problemsOf(f, null)).toEqual([]);
  });

  it("refuses unknown step references, cycles and unreachable steps", () => {
    const unknown = clone();
    (unknown.steps[0] as { next?: string }).next = "nowhere";
    expect(problemsOf(unknown).join()).toMatch(/unknown step "nowhere"/);

    const cycle = clone();
    (cycle.steps[2] as { next?: string }).next = "logs";
    expect(problemsOf(cycle).join()).toMatch(/cycle/);

    const self = clone();
    (self.steps[1] as { next?: string }).next = "diagnose";
    expect(problemsOf(self).join()).toMatch(/cycle/);

    const orphan = clone();
    (orphan.steps[0] as { next?: string }).next = "tell";
    expect(problemsOf(orphan).join()).toMatch(/"diagnose" can never run/);

    const dup = clone();
    dup.steps[1] = { ...dup.steps[1]!, id: "logs" } as never;
    expect(problemsOf(dup).join()).toMatch(/used twice/);
  });

  it("bounds the number of steps, the path length and every string", () => {
    const many = clone();
    many.steps = Array.from({ length: LIMITS.maxSteps + 1 }, (_, i) => ({
      id: `n${i}`,
      type: "notify" as const,
      title: "t",
      message: "m",
    }));
    expect(problemsOf(many).join()).toMatch(/must NOT have more than 32 items/);

    const longPath: WorkflowDefinition = {
      ...clone(),
      declares: { tools: [], ai: false },
      steps: Array.from({ length: LIMITS.maxPathLength + 1 }, (_, i) => ({
        id: `n${i}`,
        type: "notify" as const,
        title: "t",
        message: "m",
      })),
    };
    expect(problemsOf(longPath).join()).toMatch(/longest path is 25 steps/);

    const longName = { ...clone(), name: "x".repeat(LIMITS.maxNameLength + 1) };
    expect(problemsOf(longName).join()).toMatch(/name/);
    const longTitle = clone();
    (longTitle.steps[2] as { title: string }).title = "x".repeat(300);
    expect(problemsOf(longTitle).join()).toMatch(/title/);
    const huge = { ...clone(), name: "x".repeat(LIMITS.maxDefinitionBytes) };
    expect(problemsOf(huge).join()).toMatch(/larger than/);
  });

  it("checks expressions and templates, including what they may read", () => {
    const badExpr = clone();
    badExpr.trigger.where = "event.constructor.name == 'x'";
    expect(problemsOf(badExpr).join()).toMatch(/not allowed/);

    const badTpl = clone();
    (badTpl.steps[2] as { message: string }).message = "{{ process.env.HOME }}";
    expect(problemsOf(badTpl).join()).toMatch(/not available/);

    const future = clone();
    (future.steps[2] as { message: string }).message = "{{ steps.rollback.rolledBack }}";
    expect(problemsOf(future).join()).toMatch(/never runs before this step/);

    const unknownStep = clone();
    (unknownStep.steps[2] as { message: string }).message = "{{ steps.ghost.x }}";
    expect(problemsOf(unknownStep).join()).toMatch(/not a step/);

    const stepInWhere = clone();
    stepInWhere.trigger.where = "steps.logs.x == 1";
    expect(problemsOf(stepInWhere).join()).toMatch(/may only read "event"/);

    const proto = clone();
    (proto.steps[0] as { input: unknown }).input = JSON.parse('{"__proto__": {"x": 1}}');
    expect(problemsOf(proto).join()).toMatch(/__proto__|key/);

    const deep = clone();
    let nested: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i++) nested = { n: nested };
    (deep.steps[0] as { input: unknown }).input = nested;
    expect(problemsOf(deep).join()).toMatch(/nested deeper/);
  });

  it("refuses credentials inside a definition", () => {
    const d = clone();
    (d.steps[0] as { input: unknown }).input = { note: ["gh", "p_", "a".repeat(30)].join("") };
    expect(problemsOf(d).join()).toMatch(/credential/);
  });

  it("ai steps need declares.ai and context lookups need declares.context", () => {
    const d = clone();
    d.declares.ai = false;
    expect(problemsOf(d).join()).toMatch(/declares\.ai is false/);
    const e = clone();
    e.steps.splice(1, 0, { id: "look", type: "lookup", query: "deploy", limit: 3 });
    expect(problemsOf(e).join()).toMatch(/declares\.context is not true/);
  });

  it("only allows retries for idempotent tools, and compensation for tools that change something", () => {
    const retryWrite: WorkflowDefinition = {
      ...clone(),
      environment: "dev",
      declares: { tools: ["deploys.restart"], ai: false },
      steps: [
        { id: "gate", type: "approval", summary: "ok?" },
        { id: "go", type: "action", tool: "deploys.restart", retry: { max: 2, backoff_ms: 10 } },
      ],
    };
    expect(problemsOf(retryWrite).join()).toMatch(/not idempotent/);
    const retryRead: WorkflowDefinition = {
      ...clone(),
      declares: { tools: ["deploys.flaky"], ai: false },
      steps: [
        { id: "r", type: "action", tool: "deploys.flaky", retry: { max: 2, backoff_ms: 10 } },
      ],
    };
    expect(problemsOf(retryRead)).toEqual([]);
    const undoRead: WorkflowDefinition = {
      ...retryRead,
      declares: { tools: ["deploys.flaky", "deploys.undo_restart"], ai: false },
      steps: [
        { id: "gate", type: "approval", summary: "ok?" },
        {
          id: "r",
          type: "action",
          tool: "deploys.flaky",
          compensate: { tool: "deploys.undo_restart" },
        },
      ],
    };
    expect(problemsOf(undoRead).join()).toMatch(/only for steps that change something/);
  });
});

describe("destructive steps need a gate (Phase 40)", () => {
  const base = (): WorkflowDefinition => ({
    id: "restarter",
    name: "Restarter",
    version: 1,
    enabled: true,
    environment: "dev",
    trigger: { event: "deploy.failed" },
    declares: { tools: ["deploys.restart"], ai: false },
    steps: [{ id: "go", type: "action", tool: "deploys.restart" }],
  });

  it("fails validation when a write/execute/production tool can run before any approval", () => {
    expect(problemsOf(base()).join()).toMatch(/can run before any approval step/);
    const prod = deployFailedWorkflow();
    prod.steps = prod.steps.filter((s) => s.type !== "approval");
    expect(problemsOf(prod).join()).toMatch(
      /deploys\.rollback \(production\) and can run before any approval/,
    );
  });

  it("passes once an approval step precedes it on every path", () => {
    const ok = base();
    ok.steps.unshift({ id: "gate", type: "approval", summary: "restart?" });
    expect(problemsOf(ok)).toEqual([]);
  });

  it("a branch that skips the approval is still ungated", () => {
    const d = base();
    d.steps = [
      { id: "c", type: "condition", if: "event.payload.skip == true", then: "go", else: "gate" },
      { id: "gate", type: "approval", summary: "restart?", next: "go" },
      { id: "go", type: "action", tool: "deploys.restart" },
    ];
    expect(problemsOf(d).join()).toMatch(/can run before any approval/);
    d.steps[0] = {
      id: "c",
      type: "condition",
      if: "event.payload.skip == true",
      then: "gate",
      else: "gate",
    };
    expect(problemsOf(d)).toEqual([]);
  });

  it("is decided by the tool contract, not by anything the workflow says", () => {
    // The workflow cannot claim a tool is harmless: there is no field for it.
    const d = base() as unknown as Record<string, unknown>;
    (d["steps"] as Record<string, unknown>[])[0]!["side_effect"] = "none";
    expect(problemsOf(d).join()).toMatch(/additional properties/);
    // And a catalog that says "read" is what lets a read tool through.
    const readOnly: ToolCatalog = (n) =>
      n === "deploys.restart" ? { ...FACTS["deploys.logs"]!, name: n } : undefined;
    expect(problemsOf(base(), readOnly)).toEqual([]);
  });

  it("an undo that changes state needs its step to be gated too", () => {
    const d: WorkflowDefinition = {
      ...base(),
      declares: { tools: ["deploys.restart", "deploys.undo_restart"], ai: false },
      steps: [
        { id: "gate", type: "approval", summary: "restart?" },
        {
          id: "go",
          type: "action",
          tool: "deploys.restart",
          compensate: { tool: "deploys.undo_restart" },
        },
      ],
    };
    expect(problemsOf(d)).toEqual([]);
  });
});

describe("authorisation requirement and hash binding", () => {
  it("production environment, production tools and unknown tools need authorisation", () => {
    expect(requiresAuthorisation(deployFailedWorkflow(), catalog)).toMatchObject({
      required: true,
    });
    const dev: WorkflowDefinition = {
      ...deployFailedWorkflow(),
      environment: "dev",
      declares: { tools: ["deploys.logs"], ai: true },
      steps: deployFailedWorkflow().steps.filter(
        (s) => s.id !== "gate" && s.id !== "rollback" && s.id !== "done",
      ),
    };
    expect(requiresAuthorisation(dev, catalog)).toEqual({ required: false, reasons: [] });
    const withProdTool = structuredClone(dev);
    withProdTool.declares.tools.push("deploys.rollback");
    withProdTool.steps.push(
      { id: "gate", type: "approval", summary: "?" },
      { id: "rb", type: "action", tool: "deploys.rollback" },
    );
    expect(requiresAuthorisation(withProdTool, catalog).reasons.join()).toMatch(
      /deploys\.rollback is critical/,
    );
    expect(requiresAuthorisation(dev, () => undefined).required).toBe(true);
  });

  it("the hash covers behaviour, not enabled or version, and ignores key order", () => {
    const d = deployFailedWorkflow();
    const h = definitionHash(d);
    expect(definitionHash({ ...d, enabled: false, version: 7 })).toBe(h);
    const reordered = Object.fromEntries(
      Object.entries(d).reverse(),
    ) as unknown as WorkflowDefinition;
    expect(definitionHash(reordered)).toBe(h);
    const edited = structuredClone(d);
    (edited.steps[2] as { title: string }).title = "changed";
    expect(definitionHash(edited)).not.toBe(h);
    const toolEdit = structuredClone(d);
    toolEdit.declares.tools = [...toolEdit.declares.tools].reverse();
    expect(definitionHash(toolEdit)).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
