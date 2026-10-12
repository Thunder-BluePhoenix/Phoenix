// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { compileSchema } from "@phoenix/protocol";
import type { AgentDefinition, Conclusion, TrustedTarget } from "./types";

/** Explicit, trusted code-owned boundaries for an advisory specialist. */
export interface SpecialistContract<Input, Output> {
  identity: { id: string; kind: string; version: string };
  tools: readonly string[];
  context: {
    scopes: readonly string[];
    domains: readonly string[];
    maxSensitivity: "public" | "internal" | "sensitive";
  };
  inputSchema: Record<string, unknown>;
  parseInput(input: unknown): Input | string;
  outputSchema: Record<string, unknown>;
  scope: {
    resourcePrefix: string;
    dataClass: TrustedTarget["dataClass"];
    maxSteps: number;
    maxToolCalls: number;
    resourceFor(input: Input): string;
  };
  approval: "none" | "gateway";
  timeoutMs: number;
  /** Pure projection of a verified conclusion; never interpreted as executable instructions. */
  handoff(conclusion: Conclusion): Output;
  /** Additional per-agent evidence/provenance checks, run before publishing. */
  evaluate(output: Output, evidenceIds: ReadonlySet<string>): readonly string[];
}

/** Citation-bearing handoffs cannot claim evidence from another run. */
function citationProblems(output: unknown, evidenceIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "evidence_id" && (typeof item !== "string" || !evidenceIds.has(item)))
        problems.push("Handoff references foreign evidence");
      else if (
        key === "evidence_ids" &&
        (!Array.isArray(item) || item.some((id) => typeof id !== "string" || !evidenceIds.has(id)))
      )
        problems.push("Handoff references foreign evidence");
      else visit(item);
    }
  };
  visit(output);
  return problems;
}

export type RegisteredSpecialist = AgentDefinition & {
  specialist: SpecialistContract<unknown, unknown>;
};

export class SpecialistRegistry {
  private readonly definitions = new Map<string, RegisteredSpecialist>();
  private readonly validators = new Map<
    string,
    { input: (value: unknown) => string[]; output: (value: unknown) => string[] }
  >();

  register(definition: RegisteredSpecialist): void {
    const c = definition.specialist;
    if (this.definitions.has(c.identity.kind))
      throw new Error(`Duplicate specialist: ${c.identity.kind}`);
    if (
      c.identity.id !== definition.descriptor.id ||
      c.identity.kind !== definition.descriptor.kind ||
      c.identity.version !== definition.descriptor.version
    )
      throw new Error("Specialist identity differs from agent definition");
    if (
      c.tools.length !== definition.allowedTools.length ||
      c.tools.some((t) => !definition.allowedTools.includes(t))
    )
      throw new Error("Specialist tool grant differs from agent definition");
    if (
      !Number.isSafeInteger(c.timeoutMs) ||
      c.timeoutMs < 1 ||
      !Number.isSafeInteger(c.scope.maxSteps) ||
      c.scope.maxSteps < 1 ||
      !Number.isSafeInteger(c.scope.maxToolCalls) ||
      c.scope.maxToolCalls < 1
    )
      throw new Error("Invalid specialist budget");
    if (!c.scope.resourcePrefix || c.context.scopes.length === 0 || c.context.domains.length === 0)
      throw new Error("Specialist context and scope must be explicit");
    if (typeof c.scope.resourceFor !== "function")
      throw new Error("Specialist resource derivation is required");
    this.validators.set(c.identity.kind, {
      input: compileSchema(c.inputSchema),
      output: compileSchema(c.outputSchema),
    });
    this.definitions.set(c.identity.kind, definition);
  }

  get(kind: string): RegisteredSpecialist | undefined {
    return this.definitions.get(kind);
  }
  kinds(): string[] {
    return [...this.definitions.keys()];
  }
  inputProblems(kind: string, input: unknown): string[] {
    const definition = this.get(kind);
    const validator = this.validators.get(kind);
    if (!definition || !validator) return ["Unknown specialist"];
    const problems = validator.input(input);
    if (problems.length) return problems;
    const parsed = definition.specialist.parseInput(input);
    return typeof parsed === "string" ? [parsed] : [];
  }
  resource(kind: string, input: unknown): string {
    const definition = this.get(kind);
    if (!definition) throw new Error("Unknown specialist");
    const parsed = definition.specialist.parseInput(input);
    if (typeof parsed === "string") throw new Error(parsed);
    return definition.specialist.scope.resourceFor(parsed);
  }

  outputProblems(kind: string, conclusion: Conclusion, evidenceIds: ReadonlySet<string>): string[] {
    const definition = this.get(kind);
    const validator = this.validators.get(kind);
    if (!definition || !validator) return ["Unknown specialist"];
    const output = definition.specialist.handoff(conclusion);
    return [
      ...validator.output(output),
      ...citationProblems(output, evidenceIds),
      ...definition.specialist.evaluate(output, evidenceIds),
    ];
  }
}

/** Reads only an already verified conclusion; callers never receive an unverified handoff. */
export function specialistHandoff<Input, Output>(
  contract: SpecialistContract<Input, Output>,
  conclusion: Conclusion,
  evidenceIds: ReadonlySet<string>,
): Output {
  const output = contract.handoff(conclusion);
  const problems = [
    ...compileSchema(contract.outputSchema)(output),
    ...citationProblems(output, evidenceIds),
    ...contract.evaluate(output, evidenceIds),
  ];
  if (problems.length)
    throw new Error(`Invalid specialist handoff: ${problems.slice(0, 3).join("; ")}`);
  return output;
}
