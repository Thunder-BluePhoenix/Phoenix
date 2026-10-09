// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Plan generation against a real local Ollama (llama3.2 ONLY: other models on this machine forward
// prompts off-device). Skipped unless PHOENIX_REAL_OLLAMA is set:
//   PHOENIX_REAL_OLLAMA=1 npx vitest run ai/planning/test/real-ollama.test.ts
// Creates nothing anywhere: a plan is a draft.
import { AiService, OllamaProvider, ProviderRegistry } from "@phoenix/ai-models";
import { describe, expect, it } from "vitest";
import { generatePlan } from "../src";
import { FRAPPE, GITHUB, planRig } from "./helpers";

function llamaOnly(): AiService {
  const registry = new ProviderRegistry();
  registry.register(
    new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      chatModel: "llama3.2",
      generateTimeoutMs: 200_000,
    }),
  );
  return new AiService({
    registry,
    policy: { allowed: () => false },
    settings: () => ({
      enabled: true,
      cloudOptIn: { public: false, internal: false, sensitive: false },
    }),
  });
}

describe.skipIf(!process.env.PHOENIX_REAL_OLLAMA)(
  "plan generation against real Ollama llama3.2",
  { timeout: 240_000 },
  () => {
    const ai = llamaOnly();
    for (const [label, destination] of [
      ["Frappe (Vendor Approval)", FRAPPE],
      ["GitHub", GITHUB],
    ] as const) {
      it(label, async () => {
        const r = planRig();
        const out = await generatePlan({
          item: r.decision,
          destination,
          transcriptText: r.meetings.transcript(r.meetingId)?.text ?? null,
          generate: async (request) =>
            (await ai.run({ kind: "generate", request, timeoutMs: 200_000 })).result,
        });
        const statements = [
          out.plan.summary,
          ...out.plan.acceptanceCriteria,
          ...out.plan.risks,
          ...out.plan.tasks,
        ];
        process.stderr.write(
          `\n=== ${label} ===\n` +
            JSON.stringify(
              {
                unavailable: out.unavailable,
                generatedBy: out.plan.generatedBy,
                notAiGenerated: out.plan.notAiGenerated,
                stats: out.stats,
                title: out.plan.title,
                summary: out.plan.summary,
                criteria: out.plan.acceptanceCriteria.map((s) => [s.basis, s.text, s.quote]),
                tasks: out.plan.tasks.map((t) => [t.basis, t.title, t.labels]),
                risks: out.plan.risks.map((s) => [s.basis, s.text]),
                questions: out.plan.openQuestions,
                frappe: out.plan.frappe,
              },
              null,
              2,
            ) +
            "\n",
        );
        const shown =
          `${r.decision.text}\n${r.decision.evidence?.quote ?? ""}\n${r.meetings.transcript(r.meetingId)?.text ?? ""}`.toLowerCase();
        // Whatever the 3B model wrote, every statement marked `meeting` has a verbatim quote.
        for (const s of statements.filter((x) => x.basis === "meeting")) {
          expect(shown).toContain((s.quote ?? "\0").toLowerCase());
        }
        expect(out.plan.destination).toEqual(destination);
      });
    }
  },
);
