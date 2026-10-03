// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { EventBus } from "@phoenix/event-bus";
import { openDatabase } from "@phoenix/persistence";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { describe, expect, it } from "vitest";
import { NotificationService } from "../src";

function setup() {
  let t = Date.parse("2026-10-03T12:00:00Z");
  const db = openDatabase(":memory:");
  const bus = new EventBus({ retryDelayMs: 0 });
  const announced: PhoenixEvent[] = [];
  bus.subscribe("test", "notification.created", (e) => void announced.push(e));
  const service = new NotificationService({ db, bus, state: new StateEngine(), now: () => t });
  return { db, bus, service, announced, advance: (ms: number) => (t += ms) };
}

const ev = (event_type: string, extra: Partial<PhoenixEvent> = {}) =>
  createEvent({ event_type, source: "terminal", severity: "info", ...extra });

describe("which events notify", () => {
  it.each([
    ["error", ev("build.failed", { severity: "error" }), true],
    [
      "warning",
      ev("git.merge_conflict", { severity: "warning", source: "git", subject: "phoenix" }),
      true,
    ],
    [
      "requires action",
      ev("agent.waiting", { requires_action: true, payload: { agent: "Codex" } }),
      true,
    ],
    ["meeting summary", ev("kage.summary.ready", { severity: "success", source: "kage" }), true],
    ["plain info", ev("build.started"), false],
    ["plain success", ev("build.passed", { severity: "success" }), false],
    ["own bookkeeping", ev("system.warning", { severity: "warning", source: "core" }), false],
    [
      "user rejected",
      ev("capability.command.failed", {
        severity: "warning",
        source: "core",
        payload: { code: "PERMISSION_DENIED" },
      }),
      false,
    ],
  ])("%s", (_name, event, expected) => {
    const { service } = setup();
    expect(service.consider(event) !== null).toBe(expected);
  });
});

describe("notifications", () => {
  it("are stored with readable titles and announced on the bus", async () => {
    const { bus, service, announced } = setup();
    bus.publish(ev("build.failed", { severity: "error" }));
    await bus.drain();
    const { notifications, unread } = service.list();
    expect(unread).toBe(1);
    expect(notifications[0]).toMatchObject({
      title: "Build failed (terminal)",
      severity: "error",
      source: "terminal",
      read: false,
    });
    expect(announced[0]?.payload.notification).toMatchObject({ title: "Build failed (terminal)" });
  });

  it("attribute core events about a capability to that capability", () => {
    const { service } = setup();
    const n = service.consider(
      ev("capability.unavailable", {
        source: "core",
        subject: "kage",
        severity: "warning",
        payload: { name: "Kage" },
      }),
    );
    expect(n).toMatchObject({ source: "kage", title: "Kage is unavailable", body: null });
  });

  it("suppress duplicates within 30 seconds", () => {
    const { service, advance } = setup();
    expect(service.consider(ev("build.failed", { severity: "error" }))).not.toBeNull();
    advance(10_000);
    expect(service.consider(ev("build.failed", { severity: "error" }))).toBeNull();
    advance(30_000);
    expect(service.consider(ev("build.failed", { severity: "error" }))).not.toBeNull();
  });

  it("can be marked read individually or all at once", () => {
    const { service } = setup();
    const a = service.consider(ev("build.failed", { severity: "error" }))!;
    service.consider(
      ev("deploy.failed", { severity: "error", source: "ci", payload: { environment: "prod" } }),
    );
    expect(service.markRead(a.id).read).toBe(true);
    expect(service.list({ unreadOnly: true }).notifications).toHaveLength(1);
    expect(service.markAllRead()).toBe(1);
    expect(service.unreadCount()).toBe(0);
    expect(() => service.markRead("ntf_nope")).toThrow();
  });
});

describe("preferences", () => {
  it("respect enabled, minimum severity and muted sources", () => {
    const { service } = setup();
    service.setPreferences({ min_severity: "error" });
    expect(
      service.consider(ev("git.merge_conflict", { severity: "warning", source: "git" })),
    ).toBeNull();
    expect(
      service.consider(ev("agent.waiting", { severity: "warning", requires_action: true })),
    ).not.toBeNull();
    service.setPreferences({ muted_sources: ["ci", "ci"] });
    expect(service.preferences().muted_sources).toEqual(["ci"]);
    expect(service.consider(ev("deploy.failed", { severity: "error", source: "ci" }))).toBeNull();
    service.setPreferences({ enabled: false });
    expect(service.consider(ev("build.failed", { severity: "error", subject: "x" }))).toBeNull();
  });

  it("reject invalid values", () => {
    const { service } = setup();
    expect(() => service.setPreferences({ min_severity: "info" })).toThrow();
    expect(() => service.setPreferences({ enabled: "yes" })).toThrow();
    expect(() => service.setPreferences({ muted_sources: [1] })).toThrow();
    expect(() => service.setPreferences(null)).toThrow();
  });
});
