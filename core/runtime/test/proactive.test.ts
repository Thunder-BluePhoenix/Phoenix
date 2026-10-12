// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityModule } from "@phoenix/capability-manager";
import type { Summary } from "@phoenix/persistence";
import { fakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

const kage: CapabilityModule = {
  manifest: {
    id: "kage",
    name: "Kage",
    version: "0.0.1",
    description: "Meeting source",
    license: "GPL-3.0-or-later",
    events: ["kage.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};
const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.runtime.stop();
});

async function boot() {
  const network = fakeNetwork({
    chat: () => {
      throw new Error("No AI calls expected");
    },
  });
  const core = await startCore({}, { capabilities: [kage], runtime: { fetch: network.fetch } });
  cores.push(core);
  return { core, network };
}

async function reviewedAction(
  core: TestCore,
  externalId = "meeting-1",
  text = "Assign release owner",
) {
  const meeting = core.runtime.meetings.upsert({
    capabilityId: "kage",
    externalId,
    status: "ready",
  })!;
  const summary: Summary = { text: "Planning", action_items: [text] };
  core.runtime.meetings.setSummary(meeting.id, summary);
  await vi.waitFor(async () => {
    expect(
      (await core.api("GET", `/api/meetings/${encodeURIComponent(meeting.id)}/items`)).json.items,
    ).toHaveLength(1);
  });
  const item = (await core.api("GET", `/api/meetings/${encodeURIComponent(meeting.id)}/items`)).json
    .items[0];
  expect((await core.api("POST", `/api/meeting-items/${item.id}/accept`, {})).status).toBe(200);
  return { meeting, item };
}
describe("trusted meeting proactive insights", () => {
  it("requires session token and explicit opt-in; never polls or calls AI", async () => {
    const { core, network } = await boot();
    expect((await fetch(`${core.base}/api/proactive`)).status).toBe(401);
    expect((await core.api("GET", "/api/proactive")).json).toMatchObject({
      preferences: { enabled: false, capabilities: [] },
      source: { capability_id: "kage", available: false, mode: "manual" },
    });
    await core.runtime.capabilities.enable("kage");
    const { item } = await reviewedAction(core);
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toMatchObject([
      {
        kind: "unassigned_action",
        subjectId: item.id,
        evidenceIds: [item.id],
        evidence: { item_id: item.id, source: "summary", quote: "Assign release owner" },
      },
    ]);
    expect((await core.api("POST", "/api/proactive/evaluate", {})).status).toBe(403);
    expect((await core.api("GET", "/api/notifications")).json.notifications).toEqual([]);
    expect(network.requests).toEqual([]);
  });

  it("rechecks reviewed action, source and evidence before notification", async () => {
    const { core, network } = await boot();
    await core.runtime.capabilities.enable("kage");
    const { meeting, item } = await reviewedAction(core);
    expect(
      (
        await core.api("POST", "/api/proactive/preferences", {
          enabled: true,
          capabilities: ["kage"],
        })
      ).json.preferences.enabled,
    ).toBe(true);
    const first = (await core.api("POST", "/api/proactive/evaluate", {})).json;
    expect(first.delivered).toHaveLength(1);
    expect(first.delivered[0].insight_id).toBe(`unassigned_action:kage:${item.id}`);
    expect(first.delivered[0].notification.eventType).toBe("insight.unassigned_action");
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json).toMatchObject({
      delivered: [],
      suppressed: 1,
    });
    expect(
      (await core.api("POST", "/api/proactive/dismiss", { id: first.delivered[0].insight_id }))
        .json,
    ).toEqual({ dismissed: first.delivered[0].insight_id });
    expect((await core.api("GET", "/api/proactive/noise")).json).toMatchObject({
      delivered: 1,
      dismissed: 1,
      suppressed: 1,
    });
    core.runtime.meetings.setSummary(meeting.id, { text: "Action removed", action_items: [] });
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    core.runtime.meetings.setSummary(meeting.id, {
      text: "Planning",
      action_items: ["Assign release owner"],
    });
    expect((await core.api("POST", `/api/meeting-items/${item.id}/reject`, {})).status).toBe(200);
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    await core.runtime.capabilities.disable("kage");
    expect((await core.api("GET", "/api/proactive")).json.source.available).toBe(false);
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json.delivered).toEqual([]);
    expect(network.requests).toEqual([]);
  });
  it("does not evaluate revoked or reassigned meeting actions", async () => {
    const { core } = await boot();
    await core.runtime.capabilities.enable("kage");
    const { meeting, item } = await reviewedAction(core);
    await core.api("POST", "/api/proactive/preferences", { enabled: true, capabilities: ["kage"] });
    const stale = core.runtime.proactive.preview().insights[0]!;
    await core.runtime.capabilities.disable("kage");
    expect(
      core.runtime.notifications.considerInsight(
        core.runtime.memory.agentContext().viewer.id,
        stale,
        () =>
          core.runtime.proactive.preview().insights.some((candidate) => candidate.id === stale.id),
      ),
    ).toBeNull();
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json.delivered).toEqual([]);
    await core.runtime.capabilities.enable("kage");
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toHaveLength(1);
    expect(
      (
        await core.api("POST", `/api/meeting-items/${item.id}/edit`, {
          text: "Assign release owner",
          owner: "Ana",
        })
      ).status,
    ).toBe(200);
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    core.runtime.meetings.archive(meeting.id);
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
  });

  it("drops a summary quote when its action changes or gains an owner", async () => {
    const { core } = await boot();
    await core.runtime.capabilities.enable("kage");
    const { meeting } = await reviewedAction(core);
    await core.api("POST", "/api/proactive/preferences", { enabled: true, capabilities: ["kage"] });

    core.runtime.meetings.setSummary(meeting.id, {
      text: "Revised planning",
      action_items: ["Assign a different release owner"],
    });
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json).toEqual({
      delivered: [],
      suppressed: 0,
    });
    core.runtime.meetings.setSummary(meeting.id, {
      text: "Assigned planning",
      action_items: [{ text: "Assign release owner", owner: "Ana" }],
    });
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json).toEqual({
      delivered: [],
      suppressed: 0,
    });
    expect((await core.api("GET", "/api/notifications")).json.notifications).toEqual([]);
  });

  it("rechecks summary, assignment and kill switch after preview before sending", async () => {
    for (const drift of ["summary", "owner", "kill-switch"] as const) {
      const { core } = await boot();
      await core.runtime.capabilities.enable("kage");
      const { meeting, item } = await reviewedAction(core, `mid-eval-${drift}`);
      await core.api("POST", "/api/proactive/preferences", {
        enabled: true,
        capabilities: ["kage"],
      });
      const notifications = core.runtime.notifications;
      const consider = notifications.considerInsight.bind(notifications);
      vi.spyOn(notifications, "considerInsight").mockImplementationOnce(
        (userId, insight, isCurrent) => {
          if (drift === "summary") {
            core.runtime.meetings.setSummary(meeting.id, {
              text: "Revised planning",
              action_items: ["Assign a different release owner"],
            });
          } else if (drift === "owner") {
            core.runtime.meetingReview.edit(item.id, {
              text: "Assign release owner",
              owner: "Ana",
            });
          } else {
            core.runtime.permissions.engageKillSwitch();
          }
          return consider(userId, insight, isCurrent);
        },
      );
      expect(core.runtime.proactive.evaluate()).toEqual({
        delivered: [],
        suppressed: 1,
      });
      expect(
        (await core.api("GET", "/api/notifications")).json.notifications.filter(
          (notification: { eventType: string }) =>
            notification.eventType === "insight.unassigned_action",
        ),
      ).toEqual([]);
    }
  });

  it("still sends an unchanged unassigned summary action", async () => {
    const { core } = await boot();
    await core.runtime.capabilities.enable("kage");
    const { item } = await reviewedAction(core);
    await core.api("POST", "/api/proactive/preferences", { enabled: true, capabilities: ["kage"] });
    const result = (await core.api("POST", "/api/proactive/evaluate", {})).json;
    expect(result.delivered).toHaveLength(1);
    expect(result.delivered[0].insight_id).toBe(`unassigned_action:kage:${item.id}`);
    expect(result.delivered[0].notification.body).toBeTruthy();
  });

  it("never invents insights from manually added items or missing Kage summary", async () => {
    const { core } = await boot();
    await core.runtime.capabilities.enable("kage");
    const meeting = core.runtime.meetings.upsert({
      capabilityId: "kage",
      externalId: "manual-only",
      status: "ready",
    })!;
    const added = await core.api("POST", `/api/meetings/${encodeURIComponent(meeting.id)}/items`, {
      kind: "action_item",
      text: "Manually noted action",
      owner: null,
    });
    expect(added.status).toBe(201);
    expect((await core.api("GET", "/api/proactive/preview")).json.insights).toEqual([]);
    expect(
      (
        await core.api("POST", "/api/proactive/preferences", {
          enabled: true,
          capabilities: ["kage"],
        })
      ).status,
    ).toBe(200);
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json).toEqual({
      delivered: [],
      suppressed: 0,
    });
  });

  it("honors quiet hours and refuses unsupported source preferences", async () => {
    const { core, network } = await boot();
    await core.runtime.capabilities.enable("kage");
    await reviewedAction(core);
    expect(
      (await core.api("POST", "/api/proactive/preferences", { capabilities: ["github"] })).status,
    ).toBe(400);
    await core.api("POST", "/api/proactive/preferences", {
      enabled: true,
      capabilities: ["kage"],
      quietHours: { timezone: "UTC", start: "00:00", end: "23:59" },
    });
    expect((await core.api("POST", "/api/proactive/evaluate", {})).json).toMatchObject({
      delivered: [],
      suppressed: 1,
    });
    expect((await core.api("GET", "/api/proactive/noise")).json).toMatchObject({
      delivered: 0,
      suppressed: 1,
    });
    expect(network.requests).toEqual([]);
  });
  it("schedules only persisted opted-in cadence and stops on disable or Core stop", async () => {
    const { core, network } = await boot();
    await core.runtime.capabilities.enable("kage");
    await reviewedAction(core);
    const scheduled = vi.spyOn(core.runtime.proactive, "evaluate");
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(scheduled).not.toHaveBeenCalled();
      core.runtime.proactive.setPreferences({ enabled: true, capabilities: ["kage"] });
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(scheduled).not.toHaveBeenCalled();
      core.runtime.proactive.setPreferences({ cadenceMinutes: 15 });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(scheduled).toHaveBeenCalledTimes(1);
      expect(
        core.runtime.notifications.noiseMetrics(core.runtime.memory.agentContext().viewer.id)
          .delivered,
      ).toBe(1);
      await core.runtime.capabilities.disable("kage");
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(scheduled).toHaveBeenCalledTimes(1);
      await core.runtime.capabilities.enable("kage");
      core.runtime.proactive.setPreferences({ enabled: false });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(scheduled).toHaveBeenCalledTimes(1);
      expect(core.runtime.proactive.status().preferences.cadenceMinutes).toBeNull();
      core.runtime.proactive.setPreferences({ enabled: true, cadenceMinutes: 15 });
      await core.runtime.stop();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(scheduled).toHaveBeenCalledTimes(1);
      expect(network.requests).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks emergency stop and current Kage source at scheduled firing", async () => {
    const { core, network } = await boot();
    await core.runtime.capabilities.enable("kage");
    const { meeting } = await reviewedAction(core);
    const scheduled = vi.spyOn(core.runtime.proactive, "evaluate");
    vi.useFakeTimers();
    try {
      core.runtime.proactive.setPreferences({
        enabled: true,
        capabilities: ["kage"],
        cadenceMinutes: 15,
      });
      core.runtime.permissions.engageKillSwitch();
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(scheduled).not.toHaveBeenCalled();
      expect(() => core.runtime.proactive.evaluate()).toThrow();
      core.runtime.permissions.disengageKillSwitch();
      await core.runtime.capabilities.enable("kage");
      core.runtime.meetings.setSummary(meeting.id, { text: "Action removed", action_items: [] });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(
        core.runtime.notifications.noiseMetrics(core.runtime.memory.agentContext().viewer.id)
          .delivered,
      ).toBe(0);
      expect(network.requests).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
