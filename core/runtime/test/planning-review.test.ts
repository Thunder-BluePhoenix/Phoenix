// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { createPlanningCapability } from "@phoenix/capability-planning";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

const fakeKage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage fixture",
    version: "0.1.0",
    description: "Local meeting fixture",
    license: "GPL-3.0-or-later",
    events: [],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

async function setup() {
  const holder: { core?: TestCore } = {};
  core = await startCore(
    {},
    {
      capabilities: [
        fakeKage,
        createPlanningCapability({
          services: () => ({
            reviewContext: (id) =>
              holder.core!.runtime.planning.reviewContext(
                id,
                holder.core!.runtime.memory.settings().allow_sensitive_meetings,
              ),
          }),
        }),
      ],
    },
  );
  holder.core = core;
  await core.runtime.capabilities.enable("kage");
  const meeting = core.runtime.meetings.upsert({
    capabilityId: "kage",
    externalId: "7",
    status: "ready",
    title: "Secret committee",
    startedAt: "2026-10-01T10:00:00Z",
  })!;
  core.runtime.meetings.setTranscript(meeting.id, {
    text: "Top secret meeting body and credentials",
  });
  const viewer = core.runtime.memory.agentContext().viewer;
  const actor = { id: viewer.id, viewer };
  const item = core.runtime.meetingReview.service.addManual(
    meeting.id,
    { kind: "decision", text: "Top secret implementation", owner: null, due: null },
    actor,
  ).item;
  const plan = core.runtime.planning.service.generate(
    item.id,
    { system: "github", repository: "octo/repo" },
    actor,
  );
  return { core, record: (await plan).record };
}

describe("opted-in plan review projection", () => {
  it("fails closed without opt-in and returns bounded text-free context when enabled", async () => {
    const { core: c, record } = await setup();
    await c.runtime.capabilities.enable("plans");
    const call = () =>
      c.runtime.toolGateway.call({
        actor: { kind: "agent", id: "planning-review", trustedByUser: true },
        tool: "plans.review_context",
        input: { plan_id: record.id },
        environment: "local",
        resource: `plan:${record.id}`,
        dataClass: "sensitive",
      });
    await expect(call()).rejects.toThrow();
    expect(
      (await c.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true })).status,
    ).toBe(200);
    const output = (await call()).output;
    expect(output).toMatchObject({
      plan_id: record.id,
      status: "draft",
      task_count: record.plan.tasks.length,
    });
    const serialized = JSON.stringify(output);
    for (const forbidden of [
      "Top secret",
      "body",
      "destination",
      "meeting_id",
      "idempotency",
      "quote",
      "input",
      "title",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(c.runtime.planning.service.store.runs(record.id)).toEqual([]);
    expect(c.runtime.planning.service.get(record.id).status).toBe("draft");
    expect(
      (await c.api("POST", "/api/memory/settings", { allow_sensitive_meetings: false })).status,
    ).toBe(200);
    await expect(call()).rejects.toThrow();
  });
});
