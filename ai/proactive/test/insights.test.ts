// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { generateInsights, type InsightSources } from "../src";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const sources: InsightSources = {
  now: NOW,
  deployments: [
    {
      id: "d1",
      capabilityId: "deploy",
      evidenceId: "deploy:d1",
      startsAt: "2026-10-12T13:00:00Z",
      endsAt: "2026-10-12T14:00:00Z",
      serviceId: "api",
      status: "scheduled",
    },
  ],
  incidents: [
    {
      id: "i1",
      capabilityId: "deploy",
      evidenceId: "incident:i1",
      serviceId: "api",
      status: "active",
      observedAt: "2026-10-12T11:00:00Z",
    },
  ],
  items: [
    {
      id: "m1",
      capabilityId: "meetings",
      evidenceId: "item:m1",
      status: "accepted",
      kind: "action_item",
      owner: null,
      current: true,
    },
  ],
  dependencyUpdates: [
    {
      id: "u1",
      capabilityId: "dependencies",
      evidenceId: "update:u1",
      packageId: "lib",
      currentVersion: "1.0",
      availableVersion: "1.1",
      status: "available",
    },
  ],
};
describe("bounded proactive insights", () => {
  it("needs structured evidence; missing snapshots produce nothing", () => {
    expect(generateInsights({ now: NOW })).toEqual([]);
    expect(generateInsights({ ...sources, incidents: undefined }).map((i) => i.kind)).not.toContain(
      "deploy_window_risk",
    );
    expect(
      generateInsights({ ...sources, deployments: undefined }).map((i) => i.kind),
    ).not.toContain("related_incident");
  });
  it("uses only active matching incident and scheduled window", () => {
    expect(generateInsights(sources).map((i) => i.kind)).toEqual([
      "dependency_update",
      "deploy_window_risk",
      "related_incident",
      "unassigned_action",
    ]);
    expect(
      generateInsights({
        ...sources,
        incidents: [{ ...sources.incidents![0]!, status: "resolved" }],
      }).map((i) => i.kind),
    ).not.toContain("deploy_window_risk");
    expect(
      generateInsights({
        ...sources,
        deployments: [{ ...sources.deployments![0]!, startsAt: "2026-10-15T12:00:00Z" }],
      }).map((i) => i.kind),
    ).not.toContain("deploy_window_risk");
  });
  it("never resurrects revoked or unreviewed items or applied dependencies", () => {
    expect(
      generateInsights({
        ...sources,
        items: [{ ...sources.items![0]!, current: false }],
        dependencyUpdates: [{ ...sources.dependencyUpdates![0]!, status: "revoked" }],
      }).map((i) => i.kind),
    ).toEqual(["deploy_window_risk", "related_incident"]);
    expect(
      generateInsights({ ...sources, items: [{ ...sources.items![0]!, status: "proposed" }] }).map(
        (i) => i.kind,
      ),
    ).not.toContain("unassigned_action");
  });
  it("remains deterministic and capped even with noisy input", () => {
    const updates = Array.from({ length: 200 }, (_, n) => ({
      ...sources.dependencyUpdates![0]!,
      id: `u${n}`,
      evidenceId: `e${n}`,
    }));
    const result = generateInsights({ now: NOW, dependencyUpdates: updates });
    expect(result).toHaveLength(20);
    expect(result).toEqual(
      generateInsights({ now: NOW, dependencyUpdates: [...updates].reverse() }),
    );
  });
});
