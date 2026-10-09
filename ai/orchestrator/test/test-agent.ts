// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PlanStep, ToolRequest } from "@phoenix/protocol";
import type { AgentDefinition, Conclusion, RunContext, ToolFailure, VerifyResult } from "../src";

export const READ_STEP = {
  index: 0,
  tool: "ops.read_state",
  input: {},
  purpose: "read the state",
};
export const RESTART_STEP = {
  index: 0,
  tool: "ops.restart",
  input: {},
  purpose: "restart the service",
};

export interface TestAgentOptions {
  /** The raw plan. Defaults to one read. May return anything: it is untrusted. */
  plan?: (rc: RunContext) => unknown;
  afterTool?: (rc: RunContext, step: PlanStep, output: unknown) => Promise<void> | void;
  toolFailure?: (rc: RunContext, step: PlanStep, failure: ToolFailure) => "continue" | "fail";
  conclude?: (rc: RunContext) => Promise<Conclusion>;
  verify?: (rc: RunContext, conclusion: Conclusion) => Promise<VerifyResult>;
  allowedTools?: readonly string[];
  allowedCapabilities?: readonly string[];
}

export const emptyConclusion = (over: Partial<Conclusion> = {}): Conclusion => ({
  summary: "done",
  proposals: [],
  aiUsed: false,
  modelCalls: 0,
  ...over,
});

/** A task kind "test" over the `ops` capability. Environment and resource are fixed in `classify`. */
export function testAgent(o: TestAgentOptions = {}): AgentDefinition {
  return {
    descriptor: { id: "test-agent", kind: "test", version: "1.0.0" },
    allowedCapabilities: o.allowedCapabilities ?? ["ops"],
    allowedTools: o.allowedTools ?? ["ops.read_state", "ops.restart"],
    classify: (task) =>
      typeof task.input.name === "string" && /^[a-z]{1,20}$/.test(task.input.name)
        ? {
            ok: true,
            title: `Test ${task.input.name}`,
            target: {
              environment: "local",
              resource: `service:${task.input.name}`,
              dataClass: "internal",
            },
          }
        : { ok: false, reason: '"name" must be 1-20 lowercase letters' },
    plan: o.plan ?? (() => ({ steps: [READ_STEP] })),
    ...(o.afterTool ? { afterTool: o.afterTool } : {}),
    ...(o.toolFailure ? { toolFailure: o.toolFailure } : {}),
    conclude: o.conclude ?? (async () => emptyConclusion()),
    verify:
      o.verify ??
      (async (_rc, conclusion) => ({
        conclusion,
        verification: { passed: true, checks: [{ name: "noop", passed: true, detail: "" }] },
      })),
  };
}

export const request = (tool: string, input: Record<string, unknown> = {}): ToolRequest => ({
  tool,
  input,
});
