// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { EventBus } from "@phoenix/event-bus";
import { openDatabase } from "@phoenix/persistence";
import { StateEngine } from "@phoenix/state-engine";
import { describe, expect, it } from "vitest";
import { NotificationService, type ProactiveInsight, type ProactivePreferences } from "../src";

const insight: ProactiveInsight = {
  id: "unassigned_action:meetings:m1",
  kind: "unassigned_action",
  capabilityId: "meetings",
  subjectId: "m1",
  title: "Unassigned action item",
  body: "Action item m1 is unassigned.",
  evidenceIds: ["item:m1"],
};
function rig(iso = "2026-11-01T05:30:00Z") {
  let at = Date.parse(iso);
  const db = openDatabase(":memory:");
  const bus = new EventBus({ retryDelayMs: 0 });
  const service = new NotificationService({ db, bus, state: new StateEngine(), now: () => at });
  return {
    db,
    bus,
    service,
    setTime: (iso: string) => {
      at = Date.parse(iso);
    },
  };
}
describe("proactive policy", () => {
  it("never emits unsolicited notifications, even with valid evidence", () => {
    const { service } = rig();
    expect(service.considerInsight("alice", insight, () => true)).toBeNull();
    service.setProactivePreferences("alice", { enabled: true });
    expect(service.considerInsight("alice", insight, () => true)).toBeNull();
    expect(service.count()).toBe(0);
  });
  it("requires current source, capability opt-in, and does not repeat dismissed items", () => {
    const { service } = rig();
    service.setProactivePreferences("alice", { enabled: true, capabilities: ["meetings"] });
    expect(service.considerInsight("alice", insight, () => false)).toBeNull();
    expect(service.considerInsight("alice", insight, () => true)).not.toBeNull();
    expect(service.considerInsight("alice", insight, () => true)).toBeNull();
    service.dismissInsight("alice", insight.id);
    service.dismissInsight("alice", insight.id);
    expect(service.noiseMetrics("alice")).toEqual({
      delivered: 1,
      dismissed: 1,
      suppressed: 1,
      dismissalRate: 1,
    });
    expect(service.considerInsight("bob", insight, () => true)).toBeNull();
  });
  it("throttles noise and preserves the counters across service restarts", () => {
    const { db, bus, service, setTime } = rig();
    service.setProactivePreferences("alice", {
      enabled: true,
      capabilities: ["meetings"],
      maxPerHour: 1,
    });
    expect(service.considerInsight("alice", insight, () => true)).not.toBeNull();
    expect(
      service.considerInsight(
        "alice",
        { ...insight, id: "unassigned_action:meetings:m2", subjectId: "m2" },
        () => true,
      ),
    ).toBeNull();
    service.close();
    const reopened = new NotificationService({
      db,
      bus,
      state: new StateEngine(),
      now: () => Date.parse("2026-11-01T06:31:00Z"),
    });
    expect(reopened.noiseMetrics("alice").suppressed).toBe(1);
    setTime("2026-11-01T06:31:00Z");
    expect(
      reopened.considerInsight(
        "alice",
        { ...insight, id: "unassigned_action:meetings:m2", subjectId: "m2" },
        () => true,
      ),
    ).not.toBeNull();
    reopened.close();
  });
  it("uses local wall-clock quiet hours through DST fall-back", () => {
    const { service, setTime } = rig("2026-11-01T05:30:00Z");
    service.setProactivePreferences("alice", {
      enabled: true,
      capabilities: ["meetings"],
      quietHours: { timezone: "America/New_York", start: "01:00", end: "02:00" },
    });
    expect(service.considerInsight("alice", insight, () => true)).toBeNull(); // first 01:30 EDT
    setTime("2026-11-01T06:30:00Z");
    expect(service.considerInsight("alice", insight, () => true)).toBeNull(); // second 01:30 EST
    setTime("2026-11-01T07:01:00Z");
    expect(service.considerInsight("alice", insight, () => true)).not.toBeNull();
    expect(service.noiseMetrics("alice").suppressed).toBe(2);
  });
  it("rejects invalid timezones and handles overnight windows", () => {
    const { service, setTime } = rig("2026-10-12T23:30:00Z");
    expect(() =>
      service.setProactivePreferences("alice", {
        quietHours: { timezone: "unknown/zone", start: "22:00", end: "07:00" },
      }),
    ).toThrow();
    service.setProactivePreferences("alice", {
      enabled: true,
      capabilities: ["meetings"],
      quietHours: { timezone: "UTC", start: "22:00", end: "07:00" },
    });
    expect(service.considerInsight("alice", insight, () => true)).toBeNull();
    setTime("2026-10-13T06:30:00Z");
    expect(service.considerInsight("alice", insight, () => true)).toBeNull();
    setTime("2026-10-13T07:00:00Z");
    expect(service.considerInsight("alice", insight, () => true)).not.toBeNull();
  });
  it("requires explicit valid cadence and clears scheduling on revoked consent", () => {
    const { service, db, bus } = rig();
    expect(service.proactivePreferences("alice").cadenceMinutes).toBeNull();
    expect(() =>
      service.setProactivePreferences("alice", {
        cadenceMinutes: Number("5") as ProactivePreferences["cadenceMinutes"],
      }),
    ).toThrow();
    expect(() => service.setProactivePreferences("alice", { cadenceMinutes: 15 })).toThrow();
    service.setProactivePreferences("alice", { enabled: true, capabilities: ["kage"] });
    expect(service.setProactivePreferences("alice", { cadenceMinutes: 30 }).cadenceMinutes).toBe(
      30,
    );
    service.close();
    const reopened = new NotificationService({ db, bus, state: new StateEngine() });
    expect(reopened.proactivePreferences("alice").cadenceMinutes).toBe(30);
    expect(reopened.setProactivePreferences("alice", { enabled: false }).cadenceMinutes).toBeNull();
    expect(reopened.setProactivePreferences("alice", { enabled: true }).cadenceMinutes).toBeNull();
    reopened.setProactivePreferences("alice", { cadenceMinutes: 15 });
    expect(
      reopened.setProactivePreferences("alice", { capabilities: [] }).cadenceMinutes,
    ).toBeNull();
    reopened.close();
  });
});
