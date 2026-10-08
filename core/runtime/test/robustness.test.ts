// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// PRD v2.0 §6.1: "Unknown events must never crash the state engine." Posts thousands of
// well-formed but hostile events (odd types, sources, payload keys and values) through the real
// runtime and checks that Core neither crashes nor ends up in an impossible state.
// Seeded, so a failure reproduces: run with the seed in the test name.
import { FAWKES_MODES, FAWKES_STATES } from "@phoenix/protocol/states";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { event, startCore } from "./helpers";

const TYPES = [
  "build.started",
  "build.progress",
  "build.failed",
  "command.started",
  "command.failed",
  "agent.waiting",
  "deploy.started",
  "deploy.progress",
  "deploy.failed",
  "kage.meeting.recording",
  "kage.meeting.ended",
  "kage.transcription.completed",
  "kage.summary.ready",
  "kage.meeting.failed",
  "kage.capture.finished",
  "git.merge_conflict",
  "git.merge_conflict_resolved",
  "frappe.site.unhealthy",
  "security.confirmation.requested",
  "security.confirmation.resolved",
  "capability.unavailable",
  "capability.available",
  "totally.unknown",
  "a.b.c.d.e",
  "x",
];
const SOURCES = ["terminal", "git", "kage", "ghost", "mock", "ci", "a-b_c", "pet"];
const VALUES: unknown[] = [
  null,
  0,
  -1,
  1e308,
  "",
  "x".repeat(5000),
  "{payload.command}",
  "{payload.__proto__}",
  "<script>alert(1)</script>",
  "\u0000",
  "\u202e",
  [],
  {},
  [1, [2, [3]]],
  { a: { b: { c: { d: 1 } } } },
  true,
  "__proto__",
];
const KEYS = [
  "command",
  "agent",
  "environment",
  "meeting_id",
  "status",
  "title",
  "name",
  "summary",
  "participants",
  "recording",
  "duration_seconds",
  "started_at",
  "files",
  "progress",
  "__proto__",
  "constructor",
  "x",
];

/** Small deterministic generator so a failing seed can be replayed. */
function generator(seed: number) {
  let s = seed >>> 0;
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  return { next, pick };
}

function hostileEvent(g: ReturnType<typeof generator>) {
  const payload: Record<string, unknown> = {};
  for (let i = 0, n = Math.floor(g.next() * 6); i < n; i++) payload[g.pick(KEYS)] = g.pick(VALUES);
  const extra: Record<string, unknown> = {
    source: g.pick(SOURCES),
    severity: g.pick(["info", "success", "warning", "error"]),
    payload,
  };
  if (g.next() < 0.6) extra.correlation_id = g.pick(["m1", "m2", "c-3", "x".repeat(300)]);
  if (g.next() < 0.5) extra.subject = g.pick(["a", "", "{payload.x}", "y".repeat(400)]);
  if (g.next() < 0.2) extra.requires_action = g.next() < 0.5;
  if (g.next() < 0.2) extra.ttl_ms = g.pick([0, 1, 5000, 1e9]);
  return event(g.pick(TYPES), extra);
}

const escaped: unknown[] = [];
const onEscape = (reason: unknown) => escaped.push(reason);
beforeEach(() => {
  escaped.length = 0;
  process.on("unhandledRejection", onEscape);
  process.on("uncaughtException", onEscape);
});
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  process.off("unhandledRejection", onEscape);
  process.off("uncaughtException", onEscape);
  await stop?.();
  stop = undefined;
});

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Core survives hostile events (PRD §6.1)", () => {
  // Seed 2 reproduced the unregistered-source crash fixed in Phase 20.
  it.each([2, 7, 13])("seed %i", async (seed) => {
    const core = await startCore();
    stop = () => core.runtime.stop();
    const g = generator(seed);
    const valid = new Set<string>([...FAWKES_STATES, ...FAWKES_MODES]);

    for (let i = 0; i < 1_500; i++) {
      const res = await core.api("POST", "/api/events", hostileEvent(g));
      // A hostile event is accepted or refused, never an internal error.
      expect([202, 400, 403, 409, 413], `event ${i}`).toContain(res.status);
      if (i % 150 === 0) {
        const pet = (await core.api("GET", "/api/pet/state")).json;
        expect(valid.has(pet.state), `state ${pet.state} after ${i} events`).toBe(true);
        expect(typeof pet.recording).toBe("boolean");
      }
    }
    await core.runtime.bus.drain();
    // Content fetches started by the last events fail on the next ticks, not synchronously.
    for (let i = 0; i < 5; i++) await nextTick();

    expect(escaped).toEqual([]);
    expect((await core.api("GET", "/api/health")).status).toBe(200);
    for (const path of [
      "/api/meetings",
      "/api/events?limit=50",
      "/api/pet/tasks",
      "/api/notifications",
      "/api/diagnostics",
      "/api/audit",
      "/api/privacy",
    ]) {
      expect((await core.api("GET", path)).status, path).toBe(200);
    }
  });
});
