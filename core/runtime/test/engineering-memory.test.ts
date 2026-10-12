// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CapabilityModule } from "@phoenix/capability-manager";
import { createEvent, type NewEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startCore } from "./helpers";

const github: CapabilityModule = {
  manifest: {
    id: "github",
    name: "GitHub (test double)",
    version: "0.0.1",
    description: "Event producer for engineering memory tests",
    license: "GPL-3.0-or-later",
    events: ["github.*"],
    permissions: [],
    data_categories: [],
    commands: [],
  },
};

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const runtime of running.splice(0)) await runtime.stop();
});

async function boot() {
  const core = await startCore({}, { capabilities: [github] });
  running.push(core.runtime);
  return core;
}

describe("curated GitHub engineering memory", () => {
  it("requires an enabled authenticated producer and structured identifiers", async () => {
    const core = await boot();
    const publish = async (event: NewEvent<Record<string, unknown>>) => {
      core.runtime.bus.publish(createEvent(event));
      await core.runtime.bus.drain();
    };
    const event = (
      event_type: string,
      payload: Record<string, unknown>,
      source = "github",
    ): NewEvent<Record<string, unknown>> => ({
      event_type,
      source,
      severity: "info",
      payload,
    });
    const safe = {
      repository: "phoenix/runtime",
      number: 42,
      title: "SECRET_TITLE",
      body: "SECRET_BODY",
    };

    // Registration alone does not authorize capture; naming github in the payload does not either.
    await publish(event("github.pr.merged", safe));
    await core.runtime.capabilities.enable("github");
    await publish(event("github.pr.merged", safe, "terminal"));
    for (const payload of [
      { ...safe, repository: "../../private" },
      { ...safe, repository: "phoenix/runtime/other" },
      { ...safe, repository: "phoenix/runtime\nsecret" },
      { ...safe, number: "42" },
      { ...safe, number: 0 },
      { ...safe, number: 1.5 },
    ])
      await publish(event("github.pr.merged", payload));
    await publish(event("github.pr.review_requested", safe));
    expect(core.runtime.memory.store.count()).toBe(0);

    const merged = createEvent(event("github.pr.merged", safe));
    core.runtime.bus.publish(merged);
    await core.runtime.bus.drain();
    await publish(
      event("github.ci.failed", {
        repository: "phoenix/runtime",
        run_id: 77,
        workflow: "SECRET_WORKFLOW",
        failed_job: "SECRET_JOB",
        title: "SECRET_TITLE",
      }),
    );
    await publish(
      event("github.deploy.succeeded", {
        repository: "phoenix/runtime",
        deployment_id: 91,
        environment: "SECRET_ENVIRONMENT",
        state: "untrusted-state",
        actor: "SECRET_ACTOR",
      }),
    );

    const items = core.runtime.memory.store.list({ limit: 10 });
    expect(items).toHaveLength(3);
    expect(
      items.map(({ domain, text }) => [domain, text]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual([
      ["deployment", "deployment Deployment#91: succeeded"],
      ["pr", "pr PR#42: merged"],
      ["repo", "repo CI#77: failed"],
    ]);
    for (const item of items) {
      expect(item).toMatchObject({
        source: "github",
        scope: "repo:phoenix/runtime",
        sensitivity: "internal",
        retentionDays: 90,
        freshnessTtlDays: 7,
      });
      expect(item.provenance).toEqual({
        evidence_id: item.provenance.record_id,
        record_id: item.provenance.record_id,
      });
    }
    const pr = items.find((item) => item.domain === "pr")!;
    expect(pr.provenance.record_id).toBe(merged.event_id);
    expect(pr.observedAt).toBe(merged.timestamp);
    expect(JSON.stringify(items)).not.toMatch(/SECRET_|untrusted-state/);

    // Forget is the supported deletion trigger: both memory and search index lose the event fact.
    expect((await core.api("POST", `/api/memory/${pr.id}/forget`, {})).json).toEqual({
      forgotten: true,
    });
    expect(core.runtime.memory.store.get(pr.id)?.deletedAt).not.toBeNull();
    expect(core.runtime.memory.store.count()).toBe(2);
    expect((await core.api("GET", "/api/memory/search?q=PR%2342")).json.items).toEqual([]);
    expect(core.runtime.memory.store.indexedCount()).toBe(2);
  });
});
