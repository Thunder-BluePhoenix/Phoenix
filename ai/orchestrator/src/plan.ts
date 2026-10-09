// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ToolContract } from "@phoenix/ai-tool-gateway";
import { compileSchema, validatePlan, type Plan } from "@phoenix/protocol";

/** Text that came from a model or a tool, made safe to put in an audit record or a reason. */
export function safeText(value: unknown, max = 80): string {
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[^A-Za-z0-9_.:/@ -]/g, "?").slice(0, max);
}

export interface PlanRules {
  /** Tools registered right now (enabled capabilities only). */
  tools: readonly ToolContract[];
  allowedTools: readonly string[];
  allowedCapabilities: readonly string[];
  maxSteps: number;
}

export type PlanCheck = { ok: true; plan: Plan } | { ok: false; problems: string[] };

const MAX_PROBLEMS = 10;

/**
 * Checks a plan that may have come from a model. Nothing in a plan is trusted: it must match the
 * schema (no extra fields, so no risk, environment or approval can be smuggled in), fit the step
 * budget, use sequential indexes, and name only tools that (a) exist in the registry, (b) belong to
 * a capability this task kind may use and (c) are on the kind's tool list. Each step's input is
 * then checked against the tool's own input schema, so a bad plan is refused before step 1 runs.
 */
export function checkPlan(raw: unknown, rules: PlanRules): PlanCheck {
  const parsed = validatePlan(raw);
  if (!parsed.ok) return { ok: false, problems: parsed.problems.slice(0, MAX_PROBLEMS) };
  const { steps } = parsed.value;
  const problems: string[] = [];
  if (steps.length === 0) problems.push("the plan has no steps");
  if (steps.length > rules.maxSteps) {
    problems.push(`the plan has ${steps.length} steps; the limit is ${rules.maxSteps}`);
  }
  steps.forEach((step, position) => {
    const label = `step ${position}`;
    if (step.index !== position) problems.push(`${label}: index must be ${position}`);
    const capability = step.tool.slice(0, step.tool.indexOf("."));
    if (!rules.allowedCapabilities.includes(capability)) {
      problems.push(`${label}: capability "${safeText(capability)}" is not allowed for this task`);
      return;
    }
    if (!rules.allowedTools.includes(step.tool)) {
      problems.push(`${label}: tool "${safeText(step.tool)}" is not allowed for this task`);
      return;
    }
    const contract = rules.tools.find((t) => t.name === step.tool);
    if (!contract) {
      problems.push(`${label}: tool "${safeText(step.tool)}" is not registered`);
      return;
    }
    try {
      const issues = compileSchema(contract.inputSchema)(step.input);
      for (const issue of issues.slice(0, 3)) {
        problems.push(`${label}: input ${safeText(issue, 120)}`);
      }
    } catch {
      problems.push(`${label}: the input schema of "${safeText(step.tool)}" could not be applied`);
    }
  });
  return problems.length > 0
    ? { ok: false, problems: problems.slice(0, MAX_PROBLEMS) }
    : { ok: true, plan: parsed.value };
}
