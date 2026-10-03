// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { validateEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import {
  agent,
  build,
  command,
  deploy,
  frappe,
  git,
  kage,
  test as testEvents,
  withSource,
} from "../src";

describe("event builders", () => {
  const all = [
    build.started("pnpm build"),
    build.progress(0.5),
    build.passed(),
    build.failed("tsc"),
    testEvents.started(),
    testEvents.passed(),
    testEvents.failed(3),
    command.started("ls"),
    command.completed("ls"),
    command.failed("ls", 2),
    agent.started("Codex"),
    agent.working("Codex"),
    agent.waiting("Codex", "Approve?"),
    agent.completed("Codex"),
    agent.failed("Codex"),
    deploy.started("staging"),
    deploy.progress(0.3),
    deploy.succeeded("staging"),
    deploy.failed("staging"),
    git.commitCreated("phoenix", "abc123"),
    git.mergeConflict("phoenix"),
    git.mergeConflictResolved("phoenix"),
    kage.connected(),
    kage.meetingStarted("m1", "Standup"),
    kage.recording("m1"),
    kage.ended("m1"),
    kage.transcriptionStarted("m1"),
    kage.transcriptionCompleted("m1"),
    kage.summaryStarted("m1"),
    kage.summaryReady("m1", "s1"),
    kage.failed("m1"),
    frappe.siteUnhealthy("erp.local"),
    frappe.siteHealthy("erp.local"),
  ];

  it.each(all.map((e) => [e.event_type, e] as const))("%s produces a valid envelope", (_t, e) => {
    expect(validateEvent(withSource("demo", e)).ok).toBe(true);
  });

  it("marks agent.waiting as requiring action", () => {
    expect(agent.waiting("Codex").requires_action).toBe(true);
  });

  it("links Kage events by meeting id", () => {
    expect(kage.recording("m9").correlation_id).toBe("m9");
    expect(kage.summaryReady("m9", "s").payload).toEqual({ meeting_id: "m9", summary_id: "s" });
  });
});
