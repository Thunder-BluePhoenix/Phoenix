// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  createTaskTracker,
  diagnosticsChanged,
  workspaceOpened,
} from "../src/events.js";

const fixed = () => new Date("2026-10-09T10:00:00.000Z");

describe("task tracker", () => {
  const clock = (() => {
    let t = 1_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  })();
  const tracker = createTaskTracker({ now: fixed, clock: clock.now });

  it("maps start → passed with exit code 0 and a duration", () => {
    const run = {};
    const started = tracker.started(run, { name: "build", source: "Workspace", type: "shell" });
    expect(started).toMatchObject({
      event_type: "editor.task.started",
      source: "editor",
      severity: "info",
      subject: "build",
      correlation_id: "editor-task:Workspace:build",
      payload: { task: "build", source: "Workspace", type: "shell" },
    });
    expect(tracker.active).toBe(1);
    clock.advance(2_500);
    const passed = tracker.ended(run, 0);
    expect(passed).toMatchObject({
      event_type: "editor.task.passed",
      severity: "success",
      correlation_id: started.correlation_id,
      payload: { exit_code: 0, duration_ms: 2_500 },
    });
    expect(tracker.active).toBe(0);
  });

  it("any non-zero exit code is a failure, and a missing code is a cancellation, not a failure", () => {
    for (const code of [1, 2, 127, 255, -1]) {
      const run = {};
      tracker.started(run, { name: "test", source: "npm" });
      expect(tracker.ended(run, code)).toMatchObject({
        event_type: "editor.task.failed",
        severity: "error",
        payload: { exit_code: code },
      });
    }
    const run = {};
    tracker.started(run, { name: "watch", source: "npm" });
    const cancelled = tracker.ended(run, undefined);
    expect(cancelled.event_type).toBe("editor.task.cancelled");
    expect(cancelled.payload).not.toHaveProperty("exit_code");
  });

  it("an end without a seen start still reports (extension activated mid-task)", () => {
    expect(tracker.ended({}, 3, { name: "lint", source: "Workspace" })).toMatchObject({
      event_type: "editor.task.failed",
      subject: "lint",
    });
  });

  it("neutralises hostile or missing task labels", () => {
    const e = tracker.started(
      {},
      { name: "a\u001b[31m\nb" + "x".repeat(400), source: "", type: undefined },
    );
    expect(e.subject).not.toMatch(/[\u0000-\u001f]/);
    expect(e.subject!.length).toBeLessThanOrEqual(120);
    expect(e.payload).toMatchObject({ source: "unknown", type: "unknown" });
    expect(tracker.started({}, {}).subject).toBe("task");
  });

  it("produces unique, schema-shaped envelopes", () => {
    const a = workspaceOpened({ name: "p" }, fixed);
    const b = workspaceOpened({ name: "p" }, fixed);
    expect(a.event_id).toMatch(/^evt_[A-Za-z0-9_-]{6,128}$/);
    expect(a.event_id).not.toBe(b.event_id);
    expect(a).toMatchObject({ version: "1.1", timestamp: "2026-10-09T10:00:00.000Z" });
  });
});

describe("workspace and diagnostics events", () => {
  it("workspace.opened carries the display name and folder count, nothing path-like", () => {
    expect(workspaceOpened({ name: "phoenix (Workspace)", folderCount: 2 }).payload).toEqual({
      workspace: "phoenix (Workspace)",
      folders: 2,
    });
    expect(workspaceOpened({}).payload).toEqual({ workspace: "(no folder)", folders: 0 });
    expect(workspaceOpened({ name: "x", folderCount: -4 }).payload).toMatchObject({ folders: 0 });
  });

  it("diagnostics.changed carries counts only", () => {
    const e = diagnosticsChanged({
      errors: 3,
      warnings: 5,
      previousErrors: 0,
      previousWarnings: 5,
    });
    expect(e.payload).toEqual({ errors: 3, warnings: 5, previous_errors: 0, previous_warnings: 5 });
    expect(e.subject).toBeUndefined();
  });
});

describe("manifest", () => {
  const manifest = buildManifest() as {
    events: string[];
    permissions: string[];
    commands: unknown[];
    state_rules: { match: string; effect: Record<string, unknown> }[];
  };
  it("declares only editor.* events, filesystem_read and no commands", () => {
    expect(manifest.events).toEqual(["editor.*"]);
    expect(manifest.permissions).toEqual(["filesystem_read"]);
    expect(manifest.commands).toEqual([]);
  });
  it("maps a running task to WORKING, a pass to brief SUCCESS and a failure to ERROR", () => {
    const rule = (m: string) => manifest.state_rules.find((r) => r.match === m)!.effect;
    expect(rule("editor.task.started")).toMatchObject({ state: "WORKING", timeoutMs: 1_800_000 });
    expect(rule("editor.task.passed")).toMatchObject({ state: "SUCCESS", ttlMs: 4_000 });
    expect(rule("editor.task.failed")).toMatchObject({ state: "ERROR" });
    expect(rule("editor.task.cancelled")).toEqual({ clear: true });
    // diagnostics counts never drive Fawkes
    expect(manifest.state_rules.some((r) => r.match.includes("diagnostics"))).toBe(false);
  });
});
