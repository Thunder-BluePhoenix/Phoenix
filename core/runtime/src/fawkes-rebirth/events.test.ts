// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { createCelebrationGate, type BuildOutcome, type PullRequestOutcome } from "./events";

const now = Date.UTC(2026, 9, 22);
const build = (sequence: number, result: BuildOutcome["result"], stream = "ci"):
  BuildOutcome => ({ kind: "build", stream, sequence, result, at: now });
const pull = (sequence: number, item: string, result: PullRequestOutcome["result"]):
  PullRequestOutcome => ({ kind: "pull-request", stream: "repo", sequence, item, result, at: now });

describe("Fawkes celebration event gate", () => {
  it("only emits rebirth for a fresh verified failed-to-passed pipeline transition", () => {
    const gate = createCelebrationGate({ now: () => now });
    expect(gate.accept(build(1, "passed"))).toEqual([]);
    expect(gate.accept(build(2, "failed"))).toEqual([]);
    expect(gate.accept(build(3, "passed", "other"))).toEqual([]);
    expect(gate.accept(build(2, "passed"))).toEqual([]);
    expect(gate.accept(build(3, "passed"))).toEqual([{ kind: "rebirth", stream: "ci" }]);
    expect(gate.accept(build(4, "passed"))).toEqual([]);
    gate.reset();
    expect(gate.accept(build(5, "passed"))).toEqual([]);
  });
  it("does not mistake an unknown result or stale sequence for recovery", () => {
    const gate = createCelebrationGate({ now: () => now });
    gate.accept(build(1, "failed"));
    expect(gate.accept(build(2, "unknown"))).toEqual([]);
    expect(gate.accept(build(3, "passed"))).toEqual([]);
    expect(gate.accept(build(4, "failed"))).toEqual([]);
    expect(gate.accept(build(4, "passed"))).toEqual([]);
    expect(gate.accept({ ...build(5, "passed"), at: now + 120_000 })).toEqual([]);
    expect(gate.accept(build(5, "passed"))).toEqual([{ kind: "rebirth", stream: "ci" }]);
  });
  it("keeps milestones opt-in, once per week and once per three distinct merged PRs", () => {
    const gate = createCelebrationGate({ milestones: true, now: () => now + 14 * 86_400_000 });
    expect(gate.accept(build(1, "passed"))).toEqual([{ kind: "first-green-week", stream: "ci" }]);
    expect(gate.accept(build(2, "passed"))).toEqual([]);
    expect(gate.accept({ ...build(3, "passed"), at: now + 7 * 86_400_000 })).toEqual([{ kind: "first-green-week", stream: "ci" }]);
    expect(gate.accept(pull(1, "one", "merged"))).toEqual([]);
    expect(gate.accept(pull(2, "one", "merged"))).toEqual([]);
    expect(gate.accept(pull(3, "two", "merged"))).toEqual([]);
    expect(gate.accept(pull(4, "three", "merged"))).toEqual([{ kind: "pr-streak", stream: "repo" }]);
    expect(gate.accept(pull(5, "four", "closed"))).toEqual([]);
    expect(gate.accept(pull(6, "five", "merged"))).toEqual([]);
  });
});
