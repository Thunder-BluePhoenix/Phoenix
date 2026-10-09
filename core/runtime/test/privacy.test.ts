// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createKageCapability } from "@phoenix/capability-kage";
import { MemorySecretStore } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { startCore } from "./helpers";

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function setup() {
  const core = await startCore(
    {},
    { capabilities: [createKageCapability()], secrets: new MemorySecretStore() },
  );
  stop = () => core.runtime.stop();
  const { runtime } = core;
  // Some data in every class.
  runtime.bus.publish(
    createEvent({ event_type: "build.failed", source: "terminal", severity: "error" }),
  );
  runtime.meetings.upsert({
    capabilityId: "kage",
    externalId: "1",
    status: "ready",
    title: "Old",
    startedAt: "2026-01-01T00:00:00Z",
  });
  await runtime.bus.drain();
  return core;
}

const count = (inv: { data: { id: string; count: number }[] }, id: string) =>
  inv.data.find((d) => d.id === id)!.count;

describe("privacy API", () => {
  it("lists what Phoenix stores, where, and that nothing leaves the machine", async () => {
    const { api, dataDir } = await setup();
    await api("POST", "/api/capabilities/kage/secrets/api_key", { value: "k-123" });
    const inv = (await api("GET", "/api/privacy")).json;
    expect(inv.location).toBe(dataDir);
    expect(inv.data.map((d: { id: string }) => d.id)).toEqual([
      "events",
      "notifications",
      "meetings",
      "memory",
    ]);
    expect(count(inv, "events")).toBeGreaterThan(0);
    expect(count(inv, "notifications")).toBeGreaterThan(0); // the build failure notified
    expect(count(inv, "meetings")).toBe(1);
    expect(inv.credentials).toEqual([
      { capability: "kage", name: "api_key", stored_in: "OS keychain" },
    ]);
    expect(inv.telemetry).toBe("none");
    // Phase 29: the sentence is derived from the AI settings, so with AI off it says so.
    expect(inv.external_ai).toBe("AI is off; nothing is sent to AI providers.");
    expect(JSON.stringify(inv)).not.toContain("k-123");
  });

  it("retention prunes each class, validated and audited", async () => {
    const { api, runtime } = await setup();
    expect((await api("POST", "/api/privacy/retention", { events: 0 })).status).toBe(400);
    expect((await api("POST", "/api/privacy/retention", { photos: 7 })).status).toBe(400);
    const r = await api("POST", "/api/privacy/retention", {
      events: 30,
      notifications: 7,
      meetings: 90,
    });
    expect(r.json).toEqual({ events: 30, notifications: 7, meetings: 90 });
    // Old meeting (January) is already past 90 days; events and notifications are fresh.
    let inv = (await api("GET", "/api/privacy")).json;
    expect([count(inv, "meetings"), count(inv, "events") > 0]).toEqual([0, true]);

    runtime.privacy.prune(Date.now() + 31 * 86_400_000);
    inv = (await api("GET", "/api/privacy")).json;
    expect([count(inv, "events"), count(inv, "notifications")]).toEqual([0, 0]);
    const audit = (await api("GET", "/api/audit")).json.entries.map(
      (e: { action: string }) => e.action,
    );
    expect(audit).toContain("privacy.retention.changed");
  });

  it("delete-all needs confirmation, empties the class and is audited", async () => {
    const { api } = await setup();
    expect((await api("POST", "/api/privacy/delete", { data: "events" })).json.code).toBe(
      "ACTION_REQUIRES_CONFIRMATION",
    );
    expect(
      (await api("POST", "/api/privacy/delete", { data: "audit_log", confirm: true })).status,
    ).toBe(400);
    for (const data of ["events", "notifications", "meetings", "memory"]) {
      const r = await api("POST", "/api/privacy/delete", { data, confirm: true });
      expect(r.status).toBe(200);
    }
    const inv = (await api("GET", "/api/privacy")).json;
    expect(inv.data.map((d: { count: number }) => d.count)).toEqual([0, 0, 0, 0]);
    expect((await api("GET", "/api/meetings")).json.meetings).toEqual([]);
    const audit = (await api("GET", "/api/audit")).json.entries;
    expect(
      audit.filter((e: { action: string }) => e.action === "privacy.data.deleted"),
    ).toHaveLength(4);
  });
});

describe("pet settings", () => {
  it("defaults to following the OS and validates input", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/pet/settings")).json).toEqual({ reduced_motion: "auto" });
    expect((await api("POST", "/api/pet/settings", { reduced_motion: "sometimes" })).status).toBe(
      400,
    );
    expect((await api("POST", "/api/pet/settings", { reduced_motion: "on" })).json).toEqual({
      reduced_motion: "on",
    });
    expect((await api("GET", "/api/pet/settings")).json.reduced_motion).toBe("on");
  });
});
