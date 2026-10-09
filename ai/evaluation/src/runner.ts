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
import { createHostileAgent, createOpsAgent, HOSTILE_KIND, OPS_KIND, type HostileLog } from "./agents";
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
  startedMs: number;
}

export interface RunOptions {
  /** Keeps the world open (the caller must close it). Default false: closed after the run. */
  keepOpen?: boolean;
  /** Called with the finished run, before the world is closed. */
  inspect?: (run: RunResult) => void | Promise<void>;
}

const taskKindFor = (s: Scenario): string => {
  if (s.subject === "ops") return OPS_KIND;
  if (s.subject === "hostile") return HOSTILE_KIND;
  return s.task.kind;
};

export async function runScenario(scenario: Scenario, options: RunOptions = {}): Promise<RunResult> {
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
        policyAdmin: holder.admin!,
        log: hostile,
      }),
    ],
  }).catch((err: unknown) => {
    throw err;
  });
  void world;
  throw new Error("replaced below");
}

// `createHostileAgent` needs the world's PolicyAdmin, which exists only after the world is built.
const holder: { admin: World["admin"] | null } = { admin: null };

export async function execute(scenario: Scenario, options: RunOptions = {}): Promise<RunResult> {
  const hostile: HostileLog = { outcomes: [], admin: [] };
  const world = await buildWorld({
    setup: scenario.setup,
    extraAgents: (w) => {
      holder.admin = null;
      return [
        createOpsAgent({
          model: w.model,
          engine: w.engine,
          viewer: w.viewer,
          allowedTools: scenario.setup.opsAllowedTools ?? DEFAULT_OPS_TOOLS,
        }),
      ];
    },
  });
  void hostile;
  return finishRun(scenario, world, options);
}

async function finishRun(scenario: Scenario, world: World, options: RunOptions): Promise<RunResult> {
  void scenario;
  void world;
  void options;
  throw new Error("unreachable");
}

export { taskKindFor, ask, generateWith, evaluateRetrieval, AgentsDisabledError, KillSwitchEngagedError };
