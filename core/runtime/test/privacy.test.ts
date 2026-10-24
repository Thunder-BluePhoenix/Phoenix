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
    expect((await api("GET", "/api/pet/settings")).json).toEqual({
      reduced_motion: "auto",
      follow_cursor: false,
    });
    expect((await api("POST", "/api/pet/settings", { reduced_motion: "sometimes" })).status).toBe(
      400,
    );
    expect((await api("POST", "/api/pet/settings", { reduced_motion: "on" })).json).toEqual({
      reduced_motion: "on",
      follow_cursor: false,
    });
    expect((await api("GET", "/api/pet/settings")).json.reduced_motion).toBe("on");
  });

  it("keeps following the mouse pointer off until the user turns it on (Phase 59)", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/pet/settings")).json.follow_cursor).toBe(false);
    // Only a real boolean is accepted, and an empty change is refused.
    for (const bad of [{ follow_cursor: "yes" }, { follow_cursor: 1 }, {}]) {
      expect((await api("POST", "/api/pet/settings", bad)).status).toBe(400);
    }
    expect((await api("GET", "/api/pet/settings")).json.follow_cursor).toBe(false);
    // One field at a time: turning following on leaves the motion choice alone, and the reverse.
    await api("POST", "/api/pet/settings", { reduced_motion: "on" });
    expect((await api("POST", "/api/pet/settings", { follow_cursor: true })).json).toEqual({
      reduced_motion: "on",
      follow_cursor: true,
    });
    expect((await api("POST", "/api/pet/settings", { reduced_motion: "off" })).json).toEqual({
      reduced_motion: "off",
      follow_cursor: true,
    });
    expect((await api("POST", "/api/pet/settings", { follow_cursor: false })).json).toEqual({
      reduced_motion: "off",
      follow_cursor: false,
    });
  });

  it("tells open Fawkes windows after a change and not after a refused one", async () => {
    const core = await startCore();
    const seen: unknown[] = [];
    core.runtime.bus.subscribe("test-pet", "pet.*", (e) => void seen.push(e.payload));
    await core.api("POST", "/api/pet/settings", { follow_cursor: "yes" });
    expect(seen).toEqual([]);
    await core.api("POST", "/api/pet/settings", { follow_cursor: true });
    expect(seen).toEqual([{ reduced_motion: "auto", follow_cursor: true }]);
    await core.runtime.stop();
  });
});

describe("derived data in the inventory (Phases 35-45)", () => {
  it("lists derived records and staged sync context with counts and deletion rules", async () => {
    const core = await startCore();
    const inv = (await core.api("GET", "/api/privacy")).json;
    expect(inv.derived.map((d: { id: string }) => d.id)).toEqual([
      "vectors",
      "graph",
      "meeting_items",
      "plans",
      "synced_context",
      "workflow_runs",
      "recap",
      "phone_devices",
      "mcp_clients",
      "agent_checkpoints",
      "agent_usage",
      "handoff_notes",
      "engineering_signals_roots",
      "team_webhook_sources",
      "chat_approvals_config",
      "remote_relay",
      "status_lights_devices",
      "music_connectors",
      "browser_filter_lists",
      "browser_profiles",
      "scheduled_awake",
      "team_status",
    ]);
    expect(inv.derived).toEqual([
      expect.objectContaining({ id: "vectors", count: 0, deleted_with: "memory", enabled: false }),
      expect.objectContaining({ id: "graph", count: 0, edges: 0, provenance_rows: 0 }),
      expect.objectContaining({ id: "meeting_items", count: 0, deleted_with: "meetings" }),
      expect.objectContaining({ id: "plans", count: 0, deleted_with: "meetings" }),
      expect.objectContaining({ id: "synced_context", count: 0, enabled: false }),
      expect.objectContaining({
        id: "workflow_runs",
        count: 0,
        deleted_with: "events (eligible runs); retained protected runs require review",
      }),
      expect.objectContaining({ id: "recap", count: 0 }),
      expect.objectContaining({ id: "phone_devices", count: 0 }),
      expect.objectContaining({ id: "mcp_clients", count: 0 }),
      expect.objectContaining({ id: "agent_checkpoints", count: 0 }),
      expect.objectContaining({ id: "agent_usage", count: 0 }),
      expect.objectContaining({ id: "handoff_notes", count: 0 }),
      expect.objectContaining({ id: "engineering_signals_roots", count: 0 }),
      expect.objectContaining({ id: "team_webhook_sources", count: 0 }),
      expect.objectContaining({ id: "chat_approvals_config", count: 0 }),
      expect.objectContaining({ id: "remote_relay", count: 0 }),
      expect.objectContaining({ id: "status_lights_devices", count: 0 }),
      expect.objectContaining({ id: "music_connectors", count: 0 }),
      expect.objectContaining({ id: "browser_filter_lists", count: 0 }),
      expect.objectContaining({ id: "browser_profiles", count: 0 }),
      expect.objectContaining({ id: "scheduled_awake", count: 0 }),
      expect.objectContaining({ id: "team_status", count: 0 }),
    ]);
    // With AI off the sentence is unchanged: nothing is sent anywhere.
    expect(inv.external_ai).toBe("AI is off; nothing is sent to AI providers.");
    await core.runtime.stop();
  });

  it("with AI on it says transcripts and embeddings stay on this device", async () => {
    const core = await startCore();
    await core.api("POST", "/api/ai/settings", { enabled: true });
    const sentence = (await core.api("GET", "/api/privacy")).json.external_ai as string;
    expect(sentence).toMatch(/Meeting transcripts are only read by a model on this device/);
    expect(sentence).toMatch(/embeds memory text on this device only/);
    await core.runtime.stop();
  });
});
