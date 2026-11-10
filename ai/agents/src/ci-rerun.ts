// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `ci_rerun` (Phase 31): the approve -> execute -> verify path for ONE write, re-running the failed
// jobs of a GitHub Actions run. It exists only as a task a PERSON submits with an explicit
// repository and run id; nothing creates this task automatically, and the `ci_failure` agent (which
// stays read-only and advisory) never hands anything to it.
//
// Nothing here weakens approval: the plan is fixed in code (one write step, no model), the agent is
// never trusted by the user, so the tool gateway rates `github.ci.rerun_failed` (side effect
// external) high risk and an agent at high risk ALWAYS needs a fresh approval; the capability then
// shows its own confirmation card with the repository and run id.
import type { AgentDefinition, Conclusion, VerifyResult } from "@phoenix/ai-orchestrator";
import { parseCiFailureInput, type CiFailureInput } from "./ci-failure";
import { label, parseFailureDetails } from "./ci-data";
import { isRecord } from "./guards";

export const CI_RERUN_KIND = "ci_rerun";
export const CI_RERUN_AGENT_ID = "ci-rerun";
export const CI_RERUN_VERSION = "1.0.0";
export const TOOL_RERUN_FAILED = "github.ci.rerun_failed";
const TOOL_FAILURE_DETAILS = "github.ci.failure_details";

/** Same as the CI-failure input, but the run id is required: a re-run names exactly one run. */
export function parseCiRerunTaskInput(
  input: unknown,
): (CiFailureInput & { run_id: number }) | string {
  const parsed = parseCiFailureInput(input);
  if (typeof parsed === "string") return parsed;
  if (parsed.run_id === undefined) return '"run_id" is required to re-run a run';
  return { repository: parsed.repository, run_id: parsed.run_id };
}

interface Requested {
  repository: string;
  runId: number;
  evidenceId: string;
}

export function createCiRerunAgent(): AgentDefinition {
  const requested = new Map<string, Requested>();

  return {
    descriptor: { id: CI_RERUN_AGENT_ID, kind: CI_RERUN_KIND, version: CI_RERUN_VERSION },
    allowedCapabilities: ["github"],
    allowedTools: [TOOL_RERUN_FAILED, TOOL_FAILURE_DETAILS],

    classify(task) {
      const input = parseCiRerunTaskInput(task.input);
      if (typeof input === "string") return { ok: false, reason: input };
      return {
        ok: true,
        title: `Re-run failed jobs of run ${input.run_id} in ${input.repository}`,
        // Trusted: fixed by the task kind and validated input. Never from a model.
        target: {
          environment: "local",
          resource: `repo:${input.repository}`,
          dataClass: "internal",
        },
      };
    },

    plan(rc) {
      const input = parseCiRerunTaskInput(rc.task.input);
      if (typeof input === "string") throw new Error(input);
      return {
        steps: [
          {
            index: 0,
            tool: TOOL_RERUN_FAILED,
            input: { repository: input.repository, run_id: input.run_id },
            purpose: "Re-run the failed jobs of this run (needs your approval)",
          },
        ],
      };
    },

    afterTool(rc, step, output) {
      if (step.tool !== TOOL_RERUN_FAILED) return;
      const input = parseCiRerunTaskInput(rc.task.input);
      if (
        typeof input === "string" ||
        !isRecord(output) ||
        output.status !== "requested" ||
        output.repository !== input.repository ||
        output.run_id !== input.run_id
      ) {
        throw new Error("github.ci.rerun_failed returned an unreadable or mismatched result");
      }
      const evidence = rc.evidence.add({
        kind: "tool_output",
        source: TOOL_RERUN_FAILED,
        text: `Re-run of failed jobs requested for run ${input.run_id} of ${input.repository}`,
      });
      requested.set(rc.runId, {
        repository: input.repository,
        runId: input.run_id,
        evidenceId: evidence.id,
      });
    },

    async conclude(rc): Promise<Conclusion> {
      const sent = requested.get(rc.runId);
      if (!sent) throw new Error("no re-run was requested");
      return {
        summary: `Re-run of the failed jobs of run ${sent.runId} in ${sent.repository} was requested after your approval.`,
        proposals: [],
        aiUsed: false,
        modelCalls: 0,
      };
    },

    // Verify re-reads the run (GET only). The required check is that the request was accepted
    // (201 and a matching result); the observed status is reported, but GitHub can lag, so a run
    // still shown as completed does not fail the run and a failed re-read is reported, not hidden.
    async verify(rc, conclusion): Promise<VerifyResult> {
      const sent = requested.get(rc.runId);
      if (!sent) {
        return {
          conclusion,
          verification: {
            passed: false,
            checks: [{ name: "rerun_requested", passed: false, detail: "no re-run was requested" }],
          },
        };
      }
      let status = "unreadable";
      let attempt = 0;
      let restarted = false;
      try {
        const read = await rc.callTool({
          tool: TOOL_FAILURE_DETAILS,
          input: { repository: sent.repository, run_id: sent.runId },
        });
        const details = parseFailureDetails(read.output);
        if (details && details.run.id === sent.runId) {
          status = label(details.run.status, 40) ?? "unknown";
          attempt = details.run.attempt;
          restarted = details.run.status !== "completed";
        }
      } catch {
        // Reported below as unreadable; the request itself was accepted.
      }
      const detail = (): string =>
        status === "unreadable"
          ? "the run could not be re-read after the request"
          : `run status after the request: ${status} (attempt ${attempt})`;
      return {
        conclusion: {
          ...conclusion,
          summary: `${conclusion.summary} ${detail()}.`,
        },
        verification: {
          passed: true,
          checks: [
            {
              name: "rerun_requested",
              passed: true,
              detail: `GitHub accepted the request (evidence ${sent.evidenceId})`,
            },
            {
              name: "run_restarted_observed",
              passed: restarted,
              detail: restarted ? detail() : `${detail()}; it may not have updated yet`,
              required: false,
            },
          ],
        },
      };
    },

    finished(runId) {
      requested.delete(runId);
    },
  };
}
