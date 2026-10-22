// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineeringSignals, ProviderUnavailableError } from "@phoenix/ai-proactive/engineering";
import { EventStore, openDatabase } from "@phoenix/persistence";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  terminalHistorySource,
  unavailableAdvisoryProvider,
} from "../src/engineering-signals/providers";

const now = Date.parse("2026-10-22T12:00:00Z");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "phoenix-providers-")));
  dirs.push(dir);
  return dir;
}
function store() {
  return new EventStore(openDatabase(":memory:"));
}
let counter = 0;
function report(
  events: EventStore,
  type: string,
  payload: Record<string, unknown>,
  at: number,
  source = "terminal",
) {
  events.append(
    createEvent(
      {
        event_type: type,
        source,
        severity: type.endsWith("failed") ? "error" : "success",
        correlation_id: `run_${++counter}`,
        payload,
      },
      () => new Date(at),
    ),
  );
}

describe("terminalHistorySource", () => {
  it("maps only finished terminal build/test reports of the requested root", async () => {
    const root = await repo();
    const events = store();
    report(
      events,
      "test.passed",
      { command: "pnpm test", cwd: root, duration_ms: 1500, exit_code: 0 },
      now - 3000,
    );
    report(
      events,
      "test.failed",
      { command: "pnpm test", cwd: root, duration_ms: 1700, exit_code: 1 },
      now - 2000,
    );
    report(
      events,
      "build.passed",
      { command: "make", cwd: root, duration_ms: 900, exit_code: 0 },
      now - 1000,
    );
    // Not usable evidence: other repo, wrong source, started, plain command, inconsistent, no duration.
    report(
      events,
      "test.passed",
      { command: "pnpm test", cwd: "/elsewhere", duration_ms: 1, exit_code: 0 },
      now - 900,
    );
    report(
      events,
      "test.passed",
      { command: "pnpm test", cwd: root, duration_ms: 1, exit_code: 0 },
      now - 800,
      "git",
    );
    report(events, "test.started", { command: "pnpm test", cwd: root }, now - 700);
    report(
      events,
      "command.completed",
      { command: "ls", cwd: root, duration_ms: 1, exit_code: 0 },
      now - 600,
    );
    report(
      events,
      "test.passed",
      { command: "pnpm test", cwd: root, duration_ms: 1, exit_code: 2 },
      now - 500,
    );
    report(events, "test.failed", { command: "pnpm test", cwd: root, exit_code: 1 }, now - 400);
    report(
      events,
      "test.failed",
      { command: "pnpm test", cwd: root, duration_ms: 1, exit_code: null },
      now - 300,
    );

    const runs = await terminalHistorySource(events).list(root);
    expect(
      runs.map((r) => [r.job, r.outcome, r.durationMs, r.finishedAt, r.test, r.source, r.repo]),
    ).toEqual([
      ["make", "passed", 900, now - 1000, null, "terminal", root],
      ["pnpm test", "failed", 1700, now - 2000, null, "terminal", root],
      ["pnpm test", "passed", 1500, now - 3000, null, "terminal", root],
    ]);
  });

  it("reports an unreadable event store as unavailable instead of an empty history", async () => {
    const source = terminalHistorySource({
      recent() {
        throw new Error("database is locked: secret detail");
      },
    });
    const error = await source.list("/repo").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).message).not.toContain("secret detail");
  });

  it("feeds real terminal duration evidence into build duration trends without inventing flakiness", async () => {
    const root = await repo();
    const events = store();
    [1000, 1100, 1200, 2600, 2700, 2800].forEach((ms, i) =>
      report(
        events,
        "build.passed",
        { command: "make", cwd: root, duration_ms: ms, exit_code: 0 },
        now - (6 - i) * 1000,
      ),
    );
    const source = new EngineeringSignals({
      advisories: unavailableAdvisoryProvider(),
      history: terminalHistorySource(events),
      delivery: { enabled: () => false, consider: () => {} },
      clock: { now: () => now },
      timer: { set: () => 1, clear: () => {} },
      cadenceMs: 60_000,
    });
    await source.setWatchedRoots([root]);
    const signals = await source.scan();
    expect(signals.map((s) => [s.kind, s.subject])).toEqual([["duration_trend", "make"]]);
    expect(source.providerAvailability().history).toEqual({ available: true });
  });
});

describe("unavailableAdvisoryProvider", () => {
  it("is explicitly unavailable and manual config drift keeps working", async () => {
    const root = await repo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { alpha: "1.2.3" } }),
    );
    await writeFile(join(root, ".env.example"), "MISSING=value-must-not-escape\n");
    await writeFile(join(root, ".env"), "");
    await expect(unavailableAdvisoryProvider().lookup([])).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    const source = new EngineeringSignals({
      advisories: unavailableAdvisoryProvider(),
      history: terminalHistorySource(store()),
      delivery: { enabled: () => false, consider: () => {} },
      clock: { now: () => now },
      timer: { set: () => 1, clear: () => {} },
      cadenceMs: 60_000,
    });
    await source.setWatchedRoots([root]);
    const signals = await source.scan();
    expect(signals.map((s) => [s.kind, s.subject])).toEqual([["config_drift", "MISSING"]]);
    expect(JSON.stringify(signals)).not.toContain("value-must-not-escape");
    const availability = source.providerAvailability();
    expect(availability.advisories.available).toBe(false);
    expect(availability.advisories.reason).toMatch(/advisory database/);
    // An empty (but readable) history is available: absence of runs is not a failure.
    expect(availability.history).toEqual({ available: true });
  });
});
