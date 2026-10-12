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

const source: CapabilityModule = {
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

describe("planning review meeting scope", () => {
  it("does not grant aggregate reads to a viewer with no meeting scope", async () => {
    const holder: { core?: TestCore } = {};
    core = await startCore(
      {},
      {
        capabilities: [
          source,
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
        runtime: { memoryViewer: { id: "guest", grants: [] } },
      },
    );
    holder.core = core;
    await core.runtime.capabilities.enable("kage");
    const meeting = core.runtime.meetings.upsert({
      capabilityId: "kage",
      externalId: "7",
      status: "ready",
      title: "Private",
      startedAt: "2026-10-01T10:00:00Z",
    })!;
    const item = core.runtime.meetingReview.service.addManual(
      meeting.id,
      { kind: "decision", text: "Private decision", owner: null, due: null },
      { id: "owner" },
    ).item;
    const plan = await core.runtime.planning.service.generate(
      item.id,
      { system: "github", repository: "octo/repo" },
      { id: "owner" },
    );
    await core.api("POST", "/api/memory/settings", { allow_sensitive_meetings: true });
    await core.runtime.capabilities.enable("plans");
    await expect(
      core.runtime.toolGateway.call({
        actor: { kind: "agent", id: "planning-review", trustedByUser: true },
        tool: "plans.review_context",
        input: { plan_id: plan.record.id },
        environment: "local",
        resource: `plan:${plan.record.id}`,
        dataClass: "sensitive",
      }),
    ).rejects.toThrow();
  });
});
