// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition, DelegationRequest, SpecialistContract } from "../src";
import { InvalidTaskError } from "../src";
import { boot, newOpsLog, opsCapability, type Booted } from "./helpers";
import { READ_STEP, emptyConclusion, testAgent } from "./test-agent";

let rig: Booted | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

function specialist(
  kind: string,
  options: {
    delegate?: DelegationRequest;
    summary?: string;
    fail?: boolean;
    onChild?: (taskId: string) => void;
  } = {},
): AgentDefinition {
  const id = `specialist-${kind}`;
  const contract: SpecialistContract<
    { name: string },
    { summary: string; evidence_ids: string[] }
  > = {
    identity: { id, kind, version: "1.0.0" },
    tools: ["ops.read_state"],
    context: { scopes: ["repo:self"], domains: ["project"], maxSensitivity: "internal" },
    inputSchema: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: { name: { type: "string" } },
    },
    parseInput(input) {
      return typeof input === "object" &&
        input !== null &&
        "name" in input &&
        typeof input.name === "string"
        ? { name: input.name }
        : "invalid name";
    },
    outputSchema: {
      type: "object",
      required: ["summary", "evidence_ids"],
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        evidence_ids: { type: "array", items: { type: "string" } },
      },
    },
    scope: {
      resourcePrefix: "service:",
      dataClass: "internal",
      maxSteps: 1,
      maxToolCalls: 1,
      resourceFor: (input) => `service:${input.name}`,
    },
    approval: "none",
    timeoutMs: 10_000,
    handoff: (conclusion) => ({
      summary: conclusion.summary,
      evidence_ids: conclusion.proposals.flatMap((proposal) => proposal.evidenceIds),
    }),
    evaluate: () => [],
  };
  return {
    ...testAgent({
      allowedTools: ["ops.read_state"],
      plan: () => ({ steps: [READ_STEP] }),
      conclude: async (rc) => {
        if (options.delegate) {
          const result = await rc.delegate(options.delegate);
          options.onChild?.(result.taskId);
        }
        if (options.fail) throw new Error("child failed");
        return emptyConclusion({ summary: options.summary ?? kind });
      },
    }),
    descriptor: { id, kind, version: "1.0.0" },
    specialist: contract,
  };
}

describe("specialist delegation", () => {
  it("persists parent and child ownership, validated output and effective grants", async () => {
    let childTask = "";
    rig = await boot({
      agents: [
        specialist("parent", {
          delegate: { kind: "research", input: { name: "same" } },
          onChild: (id) => {
            childTask = id;
          },
        }),
        specialist("research"),
      ],
      modules: [opsCapability(newOpsLog())],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("COMPLETED");
    expect(trace.delegations).toMatchObject([
      {
        parentTaskId: task.id,
        childTaskId: childTask,
        status: "completed",
        grant: { tools: ["ops.read_state"] },
      },
    ]);
    expect(rig.orchestrator.trace(childTask)?.parent).toEqual({
      taskId: task.id,
      runId: trace.run.id,
    });
    const auditId = trace.steps.find((step) => step.name === "delegation")?.stageAuditId;
    expect(auditId).toEqual(expect.any(Number));
    expect(trace.auditIds).toContain(auditId);
    expect(rig.orchestrator.trace(childTask)?.auditIds).toContain(auditId);
    expect(
      rig.permissions.audit.list({ limit: 1000 }).find((entry) => entry.id === auditId),
    ).toMatchObject({
      action: "agent.delegation",
      details: { parentTaskId: task.id, childTaskId: childTask },
    });
  });

  it.each([
    [{ kind: "research", input: { name: "same" }, tools: ["ops.restart"] }, "tool permissions"],
    [
      { kind: "research", input: { name: "same" }, context: { scopes: ["meeting:self"] } },
      "context scope",
    ],
    [
      { kind: "research", input: { name: "same" }, context: { maxSensitivity: "sensitive" } },
      "sensitivity",
    ],
    [{ kind: "coding", input: { name: "same" } }, "Unsupported specialist"],
    [{ kind: "parent", input: { name: "same" } }, "cycle"],
    [{ kind: "research", input: { name: "other" } }, "parent scope"],
  ] as const)("refuses malicious or unsupported delegation %j", async (request, reason) => {
    let rejection = "";
    const parent = specialist("parent");
    parent.conclude = async (rc) => {
      try {
        await rc.delegate(request);
      } catch (error) {
        rejection = (error as Error).message;
      }
      return emptyConclusion();
    };
    rig = await boot({
      agents: [parent, specialist("research")],
      modules: [opsCapability(newOpsLog())],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await rig.orchestrator.settled(task.id);
    expect(rejection).toContain(reason);
    expect(rig.orchestrator.trace(task.id)?.delegations).toEqual([]);
    expect(
      rig.permissions.audit
        .list({ limit: 1000 })
        .filter((entry) => entry.action === "agent.delegation"),
    ).toHaveLength(0);
  });

  it("rejects a child handoff claiming evidence from outside its own run", async () => {
    const child = specialist("research");
    child.specialist = {
      ...child.specialist!,
      handoff: (conclusion) => ({
        summary: conclusion.summary,
        evidence_ids: ["forged-parent-evidence"],
      }),
    };
    rig = await boot({
      agents: [
        specialist("parent", { delegate: { kind: "research", input: { name: "same" } } }),
        child,
      ],
      modules: [opsCapability(newOpsLog())],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await rig.orchestrator.settled(task.id);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("FAILED");
    expect(rig.orchestrator.trace(task.id)?.delegations[0]?.status).toBe("failed");
  });

  it("preserves contradictory specialist conclusions for user review", async () => {
    const parent = specialist("parent");
    parent.conclude = async (rc) => {
      await rc.delegate({ kind: "research", input: { name: "same" } });
      await rc.delegate({ kind: "review", input: { name: "same" } });
      return emptyConclusion({ summary: "Unresolved specialist findings" });
    };
    rig = await boot({
      agents: [
        parent,
        specialist("research", { summary: "pass" }),
        specialist("review", { summary: "fail" }),
      ],
      modules: [opsCapability(newOpsLog())],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.conflicts).toMatchObject([
      {
        subject: "service:same",
        conclusions: ["pass", "fail"],
        children: [trace.delegations[0]?.childTaskId, trace.delegations[1]?.childTaskId],
      },
    ]);
    expect(trace.conclusion?.summary).toBe("Unresolved specialist findings");
  });

  it("rejects forged provenance, surfaces failures and propagates cancellation", async () => {
    const child = specialist("research", { fail: true });
    const parent = specialist("parent", {
      delegate: { kind: "research", input: { name: "same" } },
    });
    rig = await boot({ agents: [parent, child], modules: [opsCapability(newOpsLog())] });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await rig.orchestrator.settled(task.id);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("FAILED");
    expect(rig.orchestrator.trace(task.id)?.delegations[0]?.status).toBe("failed");
    await rig.close();
    rig = undefined;
    const gate = Promise.withResolvers<void>();
    const waiting = specialist("research");
    waiting.conclude = async () => {
      await gate.promise;
      return emptyConclusion();
    };
    rig = await boot({
      agents: [
        specialist("parent", { delegate: { kind: "research", input: { name: "same" } } }),
        waiting,
      ],
      modules: [opsCapability(newOpsLog())],
    });
    await rig.manager.enable("ops");
    const cancelled = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await vi.waitFor(() =>
      expect(rig!.orchestrator.trace(cancelled.id)?.delegations).toHaveLength(1),
    );
    const childId = rig.orchestrator.trace(cancelled.id)?.delegations[0]?.childTaskId;
    expect(childId).toBeTruthy();
    rig.orchestrator.cancel(cancelled.id);
    await rig.orchestrator.settled(cancelled.id);
    await rig.orchestrator.settled(childId!);
    expect(rig.orchestrator.trace(childId!)?.run.state).toBe("CANCELLED");
    gate.resolve();
  });

  it("detects identifier collisions without overwriting an existing task", async () => {
    rig = await boot({
      agents: [specialist("parent")],
      modules: [opsCapability(newOpsLog())],
      newId: (prefix) => `${prefix}_fixed`,
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({
      kind: "parent",
      input: { name: "same" },
      requestedBy: "user",
    });
    await rig.orchestrator.settled(task.id);
    expect(() =>
      rig!.orchestrator.submit({ kind: "parent", input: { name: "same" }, requestedBy: "user" }),
    ).toThrow(InvalidTaskError);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("COMPLETED");
  });
});
