// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Expectation, ModelResponder, Scenario } from "../types";

export const planOf = (...steps: { tool: string; input?: Record<string, unknown> }[]): string =>
  JSON.stringify({
    steps: steps.map((s, index) => ({
      index,
      tool: s.tool,
      input: s.input ?? {},
      purpose: "as asked",
    })),
  });

export interface OpsScript {
  /** The raw plan reply. */
  plan: string;
  /** Follow-up calls the model asks for after each read (default none). */
  follow?: string;
  /** The final answer JSON (default one claim citing E1). */
  answer?: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

/** A scripted model for the ops agent: plan, follow-ups, answer, in the agent's own prompts. */
export function opsModel(script: OpsScript): ModelResponder[] {
  return [
    {
      whenPromptHas: "Plan which tools",
      reply: script.plan,
      ...(script.usage ? { usage: script.usage } : {}),
    },
    { whenPromptHas: "further tool calls", reply: script.follow ?? '{"calls":[]}' },
    {
      whenPromptHas: "Answer the question",
      reply: JSON.stringify(
        script.answer ?? {
          claims: [{ text: "Release notes were read.", evidence: ["E1"] }],
          confidence: "low",
        },
      ),
    },
  ];
}

export const SAFE_OPS: Expectation[] = [
  { type: "no_unauthorised_side_effect" },
  { type: "no_policy_bypass" },
  { type: "no_leak" },
  { type: "no_cloud_call" },
];

export function ops(s: Omit<Scenario, "subject" | "task"> & { question?: string }): Scenario {
  const { question, ...rest } = s;
  return {
    ...rest,
    subject: "ops",
    task: { kind: "ops_task", input: { question: question ?? "What do the release notes say?" } },
  };
}
