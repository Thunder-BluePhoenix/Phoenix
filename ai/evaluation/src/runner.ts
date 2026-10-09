// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs one scenario in a fresh world and gathers the evidence the oracles read: the persisted
// trace, the audit log, the capabilities' own call counters and the model's prompt log. Nothing
// here asks a model whether the run was safe.
import { ask, generateWith, type Answer } from "@phoenix/ai-context";
import {
  AgentsDisabledError,
  KillSwitchEngagedError,
  type TaskTrace,
} from "@phoenix/ai-orchestrator";
import { evaluateRetrieval, type RetrievalEvaluation } from "@phoenix/ai-retrieval";
import type { AuditEntry } from "@phoenix/permissions";
import type { AgentRunState } from "@phoenix/protocol";
import {
  createHostileAgent,
  createOpsAgent,
  HOSTILE_KIND,
  OPS_KIND,
  type HostileLog,
} from "./agents";
import { buildWorld, type World } from "./world";
import type { Scenario } from "./types";

export const DEFAULT_OPS_TOOLS: readonly string[] = ["ops.read_notes", "ops.read_state"];

export interface RunResult {
  scenario: Scenario;
  world: World;
  state: AgentRunState | "REFUSED" | "ANSWERED";
  taskId: string | null;
  trace: TaskTrace | null;
  /** Every audit row, oldest first. */
  audit: AuditEntry[];
  /** Summary, claims and proposals joined: what a user would read. */
  answerText: string;
  answer: Answer | null;
  hostile: HostileLog;
  retrieval: RetrievalEvaluation | null;
  /** Virtual milliseconds from submit to the end. */
  durationMs: number;
}

export interface RunOptions {
  /** Called with the finished run before the world is closed. */
  inspect?: (run: RunResult) => void | Promise<void>;
}

function taskText(trace: TaskTrace | null): string {
  const c = trace?.conclusion;
  if (!c) return "";
  const claims = c.diagnosis?.claims.map((x) => x.text) ?? [];
  const proposals = c.proposals.flatMap((p) => [p.text, p.rationale]);
  return [c.summary, ...claims, ...proposals].join("\n");
}

function answerText(a: Answer): string {
  return [
    ...a.facts.map((f) => f.text),
    ...a.storedInterpretations.map((f) => f.text),
    a.interpretation ?? "",
  ].join("\n");
}

/** Builds a fresh world, runs the scenario, hands the run to `inspect`, then closes the world. */
export async function runScenario(
  scenario: Scenario,
  options: RunOptions = {},
): Promise<RunResult> {
  const hostile: HostileLog = { outcomes: [], admin: [] };
  const world = await buildWorld({
    setup: scenario.setup,
    extraAgents: (w) => [
      createOpsAgent({
        model: w.model,
        engine: w.engine,
        viewer: w.viewer,
        allowedTools: scenario.setup.opsAllowedTools ?? DEFAULT_OPS_TOOLS,
      }),
      createHostileAgent({
        attempts: () => scenario.hostile?.attempts ?? [],
        admin: () => scenario.hostile?.admin ?? [],
        policyAdmin: w.admin,
        log: hostile,
      }),
    ],
  });
  try {
    if (scenario.setup.killSwitch) world.permissions.engageKillSwitch("owner", "evaluation");
    const started = world.clock.now;
    let state: RunResult["state"] = "REFUSED";
    let taskId: string | null = null;
    let trace: TaskTrace | null = null;
    let answer: Answer | null = null;
    let text = "";
    let retrieval: RetrievalEvaluation | null = null;

    if (scenario.subject === "ask") {
      answer = await ask(
        {
          question: String(scenario.task.input.question),
          viewer: world.viewer,
          limit: 6,
          tokenBudget: 800,
        },
        { generate: generateWith(world.ai), engine: world.engine, nonce: () => "NONCE" },
      );
      state = "ANSWERED";
      text = answerText(answer);
    } else if (scenario.subject === "retrieval") {
      const spec = scenario.retrieval;
      if (!spec) throw new Error(`scenario ${scenario.id} has no retrieval queries`);
      retrieval = await evaluateRetrieval(
        spec.queries.map((q) => ({ id: q.id, query: q.query, relevant: q.relevant })),
        (q) => {
          const bundle = world.engine.assemble({
            question: q.query,
            viewer: world.viewer,
            limit: spec.k,
            tokenBudget: 4000,
          });
          return Promise.resolve(bundle.items.map((i) => `${i.source}:${i.sourceRef}`));
        },
        spec.k,
      );
      state = "ANSWERED";
    } else {
      try {
        const task = world.orchestrator.submit({
          kind: scenario.subject === "ops" ? OPS_KIND : scenario.subject === "hostile" ? HOSTILE_KIND : scenario.task.kind,
          input: scenario.task.input,
          requestedBy: "user",
        });
        taskId = task.id;
        await world.orchestrator.settled(task.id);
        trace = world.orchestrator.trace(task.id) ?? null;
        state = trace?.run.state ?? "REFUSED";
        text = taskText(trace);
      } catch (err) {
        if (!(err instanceof KillSwitchEngagedError || err instanceof AgentsDisabledError)) throw err;
        state = "REFUSED";
      }
    }
    const result: RunResult = {
      scenario,
      world,
      state,
      taskId,
      trace,
      audit: world.permissions.audit.list({ limit: 1000 }).reverse(),
      answerText: text,
      answer,
      hostile,
      retrieval,
      durationMs: world.clock.now - started,
    };
    await options.inspect?.(result);
    return result;
  } finally {
    await world.close();
  }
}
