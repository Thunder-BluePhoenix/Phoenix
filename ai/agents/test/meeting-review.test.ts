// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { defineCapability } from "@phoenix/sdk";
import { specialistHandoff } from "@phoenix/ai-orchestrator";
import { createMeetingReviewAgent } from "../src";
import { boot, type Booted } from "../../orchestrator/test/helpers";

let rig: Booted | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

function summaryCapability(result: unknown) {
  return defineCapability({
    manifest: {
      id: "kage",
      name: "Kage test",
      version: "1.0.0",
      description: "Read meeting summary",
      license: "GPL-3.0-or-later",
      events: ["kage.*"],
      permissions: [],
      data_categories: [],
      commands: [
        {
          name: "meeting.get_summary",
          description: "Read summary",
          side_effect: "read",
          input_schema: {
            type: "object",
            required: ["meeting_id"],
            additionalProperties: false,
            properties: { meeting_id: { type: "string" } },
          },
        },
      ],
    },
    commands: { "meeting.get_summary": () => result },
  });
}

describe("meeting decision specialist", () => {
  it("produces a bounded decision object with observed source provenance, not chat", async () => {
    const agent = createMeetingReviewAgent();
    rig = await boot({
      agents: [agent],
      modules: [
        summaryCapability({
          text: "Review launch",
          decisions: ["Ship after review"],
          action_items: ["Ask owner"],
          generated_by: "extractive",
        }),
      ],
    });
    await rig.manager.enable("kage");
    const task = rig.orchestrator.submit({
      kind: "meeting_decision_review",
      input: { meeting_id: "7" },
      requestedBy: "u",
    });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("COMPLETED");
    const handoff = specialistHandoff(
      agent.specialist,
      trace.conclusion!,
      new Set(trace.evidence.map((e) => e.id)),
    );
    expect(handoff).toEqual({
      meeting_id: "7",
      decisions: [{ text: "Ship after review", evidence_ids: [trace.evidence[0]!.id] }],
      action_items: ["Ask owner"],
      provenance: { source: "kage.meeting.get_summary", evidence_id: trace.evidence[0]!.id },
    });
    expect(trace.steps.filter((s) => s.kind === "tool_call").map((s) => s.name)).toEqual([
      "kage.meeting.get_summary",
    ]);
  });

  it("rejects malformed or additional input before gateway access", async () => {
    rig = await boot({ agents: [createMeetingReviewAgent()], modules: [summaryCapability(null)] });
    await rig.manager.enable("kage");
    expect(() =>
      rig!.orchestrator.submit({
        kind: "meeting_decision_review",
        input: { meeting_id: "7", transcript: "ungranted" },
        requestedBy: "u",
      }),
    ).toThrow();
    expect(() =>
      rig!.orchestrator.submit({
        kind: "meeting_decision_review",
        input: { meeting_id: "../7" },
        requestedBy: "u",
      }),
    ).toThrow();
  });

  it("fails closed on missing or malformed Kage summaries and audits the failed stage", async () => {
    rig = await boot({
      agents: [createMeetingReviewAgent()],
      modules: [summaryCapability({ text: "a", decisions: "not an array", action_items: [] })],
    });
    await rig.manager.enable("kage");
    const task = rig.orchestrator.submit({
      kind: "meeting_decision_review",
      input: { meeting_id: "7" },
      requestedBy: "u",
    });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(trace.conclusion).toBeNull();
    expect(trace.steps.find((s) => s.name === "execute")?.stageAuditId).toEqual(expect.any(Number));
  });
});
