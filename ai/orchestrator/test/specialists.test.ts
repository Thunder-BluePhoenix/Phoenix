// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition, SpecialistContract } from "../src";
import { InvalidTaskError, specialistHandoff } from "../src";
import { boot, manualTimers, newOpsLog, opsCapability, type Booted } from "./helpers";
import { testAgent } from "./test-agent";

interface Advice {
  claim: string;
  evidence_ids: string[];
}
const contract: SpecialistContract<{ name: string }, Advice> = {
  identity: { id: "test-agent", kind: "test", version: "1.0.0" },
  tools: ["ops.read_state"],
  context: { scopes: ["repo:self"], domains: ["project"], maxSensitivity: "internal" },
  inputSchema: {
    type: "object",
    required: ["name"],
    additionalProperties: false,
    properties: { name: { type: "string" } },
  },
  parseInput(input) {
    if (
      typeof input !== "object" ||
      input === null ||
      !("name" in input) ||
      typeof input.name !== "string"
    )
      return "Invalid specialist name";
    return { name: input.name };
  },
  outputSchema: {
    type: "object",
    required: ["claim", "evidence_ids"],
    additionalProperties: false,
    properties: {
      claim: { type: "string", minLength: 1 },
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
  timeoutMs: 800,
  handoff(conclusion) {
    return {
      claim: conclusion.summary,
      evidence_ids: conclusion.proposals.flatMap((p) => p.evidenceIds),
    };
  },
  evaluate(output, ids) {
    return output.evidence_ids.every((id) => ids.has(id)) ? [] : ["Unknown evidence"];
  },
};

const agent = (changes: Partial<AgentDefinition> = {}): AgentDefinition => ({
  ...testAgent({ allowedCapabilities: ["ops"], allowedTools: ["ops.read_state"] }),
  specialist: contract,
  ...changes,
});
let rig: Booted | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

describe("specialist contracts", () => {
  it("rejects malformed input before persisting or calling a gateway", async () => {
    const log = newOpsLog();
    rig = await boot({ agents: [agent()], modules: [opsCapability(log)] });
    await rig.manager.enable("ops");
    expect(() =>
      rig!.orchestrator.submit({
        kind: "test",
        input: { name: "x", extra: true },
        requestedBy: "u",
      }),
    ).toThrow(InvalidTaskError);
    expect(log.reads).toBe(0);
    expect(rig.orchestrator.kinds()).toEqual(["test"]);
    expect(rig.orchestrator.specialists.get("test")?.specialist.timeoutMs).toBe(800);
  });

  it("denies a target outside the declared scope", async () => {
    rig = await boot({
      agents: [
        agent({
          classify: () => ({
            ok: true,
            title: "bad",
            target: { environment: "local", resource: "repo:other", dataClass: "internal" },
          }),
        }),
      ],
      modules: [opsCapability(newOpsLog())],
    });
    expect(() =>
      rig!.orchestrator.submit({ kind: "test", input: { name: "x" }, requestedBy: "u" }),
    ).toThrow(/scope/);
  });

  it("rejects a non-read plan before executing any call", async () => {
    const log = newOpsLog();
    rig = await boot({
      agents: [
        agent({
          allowedTools: ["ops.restart"],
          specialist: { ...contract, tools: ["ops.restart"] },
          plan: () => ({
            steps: [{ index: 0, tool: "ops.restart", input: {}, purpose: "restart" }],
          }),
        }),
      ],
      modules: [opsCapability(log)],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({ kind: "test", input: { name: "x" }, requestedBy: "u" });
    await rig.orchestrator.settled(task.id);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("FAILED");
    expect(log.restarts).toBe(0);
  });

  it("rejects approval-gated writes even with a permissive tool plan", async () => {
    const log = newOpsLog();
    rig = await boot({
      agents: [
        agent({
          allowedTools: ["ops.read_state", "ops.restart"],
          specialist: { ...contract, tools: ["ops.read_state", "ops.restart"], approval: "none" },
          plan: () => ({
            steps: [{ index: 0, tool: "ops.restart", input: {}, purpose: "restart" }],
          }),
        }),
      ],
      modules: [opsCapability(log)],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({ kind: "test", input: { name: "x" }, requestedBy: "u" });
    await rig.orchestrator.settled(task.id);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("FAILED");
    expect(log.restarts).toBe(0);
  });

  it("fails malformed handoff with stage audit and no published conclusion", async () => {
    const log = newOpsLog();
    rig = await boot({
      agents: [
        agent({ specialist: { ...contract, handoff: () => ({ claim: "", evidence_ids: [] }) } }),
      ],
      modules: [opsCapability(log)],
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({ kind: "test", input: { name: "x" }, requestedBy: "u" });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(trace.conclusion).toBeNull();
    expect(trace.steps.find((s) => s.name === "verify")?.stageAuditId).toEqual(expect.any(Number));
  });

  it("enforces the specialist deadline and cancellation while a gateway call is in flight", async () => {
    const log = newOpsLog();
    log.gate = Promise.withResolvers<void>();
    const timers = manualTimers();
    rig = await boot({
      agents: [agent()],
      modules: [opsCapability(log)],
      setTimer: timers.setTimer,
    });
    await rig.manager.enable("ops");
    const task = rig.orchestrator.submit({ kind: "test", input: { name: "x" }, requestedBy: "u" });
    expect(timers.scheduled).toContain(800);
    timers.fire();
    await rig.orchestrator.settled(task.id);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("FAILED");
    log.gate.resolve();
    const task2 = rig.orchestrator.submit({ kind: "test", input: { name: "x" }, requestedBy: "u" });
    rig.orchestrator.cancel(task2.id);
    await rig.orchestrator.settled(task2.id);
    expect(rig.orchestrator.trace(task2.id)?.run.state).toBe("CANCELLED");
  });

  it("does not turn unsupported citations into a handoff", () => {
    expect(() =>
      specialistHandoff(
        contract,
        {
          summary: "advice",
          proposals: [
            {
              text: "x",
              rationale: "x",
              evidenceIds: ["invented"],
              advisory: true,
              grounded: true,
            },
          ],
          aiUsed: false,
          modelCalls: 0,
        },
        new Set(),
      ),
    ).toThrow(/Unknown evidence/);
  });
});
