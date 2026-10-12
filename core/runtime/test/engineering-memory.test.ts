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

const issues: CapabilityModule = {
  manifest: {
    id: "issues",
    name: "Issue trackers (test double)",
    version: "0.0.1",
    description: "Event producer for issue memory tests",
    license: "GPL-3.0-or-later",
    events: ["issues.*"],
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

  it("source uninstall and privacy delete-all remove event-derived PR facts and copied search text", async () => {
    const core = await boot();
    await core.runtime.capabilities.enable("github");
    const first = createEvent({
      event_type: "github.pr.merged",
      source: "github",
      severity: "info",
      payload: { repository: "org/repo", number: 42 },
    });
    core.runtime.bus.publish(first);
    await core.runtime.bus.drain();
    expect(core.runtime.memory.store.count()).toBe(1);
    expect(core.runtime.events.deleteBySource("github")).toBe(1);
    expect(core.runtime.memory.store.count()).toBe(0);
    expect((await core.api("GET", "/api/memory/search?q=PR%2342")).json.items).toEqual([]);
    const second = createEvent({
      event_type: "github.pr.opened",
      source: "github",
      severity: "info",
      payload: { repository: "org/repo", number: 43 },
    });
    core.runtime.bus.publish(second);
    await core.runtime.bus.drain();
    expect(core.runtime.memory.store.count()).toBe(1);
    expect(
      (await core.api("POST", "/api/privacy/delete", { data: "events", confirm: true })).status,
    ).toBe(200);
    expect(core.runtime.memory.store.count()).toBe(0);
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
    const row = core.runtime.db
      .prepare(
        "SELECT text, provenance FROM memory_items WHERE source='github' AND deleted_at IS NOT NULL ORDER BY seq DESC LIMIT 1",
      )
      .get() as { text: string; provenance: string };
    expect(row).toEqual({ text: "", provenance: "{}" });
  });
});

describe("curated issue tracker memory", () => {
  it("requires enabled durable issues events and ignores hostile prose and keys", async () => {
    const core = await startCore({}, { capabilities: [issues] });
    running.push(core.runtime);
    const publish = async (
      event_type: string,
      payload: Record<string, unknown>,
      source = "issues",
    ) => {
      const event = createEvent({ event_type, source, severity: "info", payload });
      core.runtime.bus.publish(event);
      await core.runtime.bus.drain();
      return event;
    };
    const safe = {
      tracker: "github",
      key: "org/repo#42",
      category: "done",
      from: "in_progress",
      to: "done",
      title: "SECRET_TITLE",
      status: "SECRET_STATUS",
      to_status: "SECRET_TO_STATUS",
      url: "https://example.test/SECRET_URL",
      description: "SECRET_DESCRIPTION",
      actor: "SECRET_ACTOR",
      transcript: "SECRET_TRANSCRIPT",
    };
    await publish("issues.status_changed", safe);
    await core.runtime.capabilities.enable("issues");
    await publish("issues.status_changed", safe, "terminal");
    for (const payload of [
      { ...safe, key: "../../private#42" },
      { ...safe, key: "org/repo#42\nSECRET_KEY" },
      { ...safe, tracker: "unknown" },
      { ...safe, category: "SECRET_CATEGORY" },
      { ...safe, to: "SECRET_STATE" },
      { ...safe, from: "SECRET_STATE" },
    ])
      await publish("issues.status_changed", payload);
    await publish("issues.completed", safe);
    expect(core.runtime.memory.store.count()).toBe(0);

    const changed = await publish("issues.status_changed", safe);
    const linear = await publish("issues.assigned", {
      ...safe,
      tracker: "linear",
      key: "ENG-123",
      category: "open",
    });
    await publish("issues.unassigned", { ...safe, tracker: "jira", key: "PROJ-45" });
    const items = core.runtime.memory.store.list({ limit: 10 });
    expect(items.map(({ text }) => text).sort()).toEqual([
      "issue Issue#42: completed",
      "issue Issue#ENG-123: assigned",
      "issue Issue#PROJ-45: inactive",
    ]);
    expect(items.map(({ scope }) => scope).sort()).toEqual([
      "issue:jira:PROJ-45",
      "issue:linear:ENG-123",
      "repo:org/repo",
    ]);
    for (const item of items) {
      expect(item).toMatchObject({
        domain: "issue",
        source: "issues",
        sensitivity: "internal",
        retentionDays: 90,
        freshnessTtlDays: 7,
      });
      expect(item.provenance.record_id).toBe(item.provenance.evidence_id);
    }
    expect(items.find(({ scope }) => scope === "repo:org/repo")?.provenance.record_id).toBe(
      changed.event_id,
    );
    expect(items.find(({ scope }) => scope === "issue:linear:ENG-123")?.observedAt).toBe(
      linear.timestamp,
    );
    expect(JSON.stringify(items)).not.toMatch(/SECRET_/);

    const item = items.find(({ scope }) => scope === "repo:org/repo")!;
    expect((await core.api("POST", `/api/memory/${item.id}/forget`, {})).json).toEqual({
      forgotten: true,
    });
    expect(core.runtime.memory.store.count()).toBe(2);
    const search = (await core.api("GET", "/api/memory/search?q=Issue%2342")).json.items as {
      id: string;
    }[];
    expect(search.some(({ id }) => id === item.id)).toBe(false);
    expect(core.runtime.memory.store.indexedCount()).toBe(2);
  });

  it("removes issue memories and indexed text when their source events are deleted", async () => {
    const core = await startCore({}, { capabilities: [issues] });
    running.push(core.runtime);
    await core.runtime.capabilities.enable("issues");
    const publish = async (key: string) => {
      const event = createEvent({
        event_type: "issues.assigned",
        source: "issues",
        severity: "info",
        payload: { tracker: "linear", key, category: "open" },
      });
      core.runtime.bus.publish(event);
      await core.runtime.bus.drain();
    };
    await publish("ENG-123");
    expect(core.runtime.memory.store.count()).toBe(1);
    expect(core.runtime.events.deleteBySource("issues")).toBe(1);
    expect(core.runtime.memory.store.count()).toBe(0);
    expect((await core.api("GET", "/api/memory/search?q=ENG-123")).json.items).toEqual([]);
    await publish("ENG-124");
    expect(core.runtime.memory.store.count()).toBe(1);
    expect(
      (await core.api("POST", "/api/privacy/delete", { data: "events", confirm: true })).status,
    ).toBe(200);
    expect(core.runtime.memory.store.count()).toBe(0);
    expect(core.runtime.memory.store.indexedCount()).toBe(0);
    const row = core.runtime.db
      .prepare(
        "SELECT text, provenance FROM memory_items WHERE source='issues' AND deleted_at IS NOT NULL ORDER BY seq DESC LIMIT 1",
      )
      .get() as { text: string; provenance: string };
    expect(row).toEqual({ text: "", provenance: "{}" });
  });
});
