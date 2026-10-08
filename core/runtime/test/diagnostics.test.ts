// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createKageCapability } from "@phoenix/capability-kage";
import { MOCK_KAGE_KEY, startMockKage, type MockKage } from "@phoenix/capability-kage/testing";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processingRuns } from "../src/diagnostics";
import { startCore } from "./helpers";

let kage: MockKage | undefined;
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  await kage?.close();
  kage = stop = undefined;
});

describe("processingRuns", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 8, 9, 0, s)).toISOString();
  const ev = (event_type: string, s: number, correlation_id = "m1", source = "kage") => ({
    event_type,
    source,
    timestamp: at(s),
    correlation_id,
  });

  it("times each run from meeting end to summary, transcript or failure", () => {
    const runs = processingRuns([
      ev("kage.meeting.ended", 0, "a"),
      ev("kage.meeting.ended", 1, "b"),
      ev("kage.meeting.ended", 2, "c"),
      ev("kage.summary.ready", 31, "a"),
      ev("kage.transcription.completed", 11, "b"),
      ev("kage.meeting.failed", 7, "c"),
    ]);
    expect(runs).toEqual([
      { capability: "kage", outcome: "failed", duration_ms: 5_000 },
      { capability: "kage", outcome: "ready", duration_ms: 10_000 },
      { capability: "kage", outcome: "ready", duration_ms: 31_000 },
    ]);
  });

  it("works whatever order the events arrive in", () => {
    const runs = processingRuns([ev("kage.summary.ready", 20), ev("kage.meeting.ended", 5)]);
    expect(runs).toEqual([{ capability: "kage", outcome: "ready", duration_ms: 15_000 }]);
  });

  it("ignores runs that never started, never finished, or have no correlation", () => {
    expect(
      processingRuns([
        ev("kage.summary.ready", 9, "orphan"),
        ev("kage.meeting.ended", 0, "unfinished"),
        { event_type: "kage.meeting.ended", source: "kage", timestamp: at(0) },
        ev("kage.meeting.ended", 0, "bad-clock"),
        { ...ev("kage.summary.ready", 0, "bad-clock"), timestamp: "not a date" },
      ]),
    ).toEqual([]);
  });

  it("counts a run once even if the finishing event repeats", () => {
    expect(
      processingRuns([
        ev("kage.meeting.ended", 0),
        ev("kage.transcription.completed", 4),
        ev("kage.summary.ready", 9),
      ]),
    ).toEqual([{ capability: "kage", outcome: "ready", duration_ms: 4_000 }]);
  });
});

const TITLE = "Layoff planning";
const PARTICIPANTS = ["Ada", "Linus"];
const TRANSCRIPT = "We agreed to ship the Kage adapter.";

async function setup() {
  kage = await startMockKage();
  const secrets = new MemorySecretStore();
  const core = await startCore({}, { capabilities: [createKageCapability()], secrets });
  stop = () => core.runtime.stop();
  await core.api("POST", "/api/capabilities/kage/secrets/api_key", { value: MOCK_KAGE_KEY });
  await core.api("POST", "/api/capabilities/kage/config", {
    config: { base_url: kage.url, poll_ms: 250 },
  });
  expect((await core.api("POST", "/api/capabilities/kage/enable", {})).status).toBe(200);
  return core;
}

describe("GET /api/diagnostics", () => {
  it("needs the session token", async () => {
    const core = await setup();
    expect(
      (await core.api("GET", "/api/diagnostics", undefined, { authorization: "" })).status,
    ).toBe(401);
  });

  it("describes how Phoenix behaves without secrets, meeting content or local paths", async () => {
    const core = await setup();
    const m = kage!.upload(TITLE);
    kage!.advance(m.id, "summarized");
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/meetings/kage:1")).json).toMatchObject({
        has_transcript: true,
        has_summary: true,
      }),
    );
    // Sanity: the content really is stored, so its absence below means something.
    expect((await core.api("GET", "/api/meetings/kage:1")).json.participants).toEqual(PARTICIPANTS);
    expect((await core.api("GET", "/api/meetings/kage:1/transcript")).json.text).toBe(TRANSCRIPT);

    const res = await core.api("GET", "/api/diagnostics");
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.json);

    for (const private_ of [
      MOCK_KAGE_KEY,
      TITLE,
      ...PARTICIPANTS,
      TRANSCRIPT,
      "The team agreed to ship the Kage adapter this week.",
      "Write the docs",
      kage!.url, // configuration values can hold URLs and paths
      core.dataDir, // where the user keeps their data
    ]) {
      expect(text, `leaked ${private_}`).not.toContain(private_);
    }
  });

  it("reports capability state by name only", async () => {
    const core = await setup();
    const { capabilities } = (await core.api("GET", "/api/diagnostics")).json;
    expect(capabilities).toEqual([
      expect.objectContaining({
        id: "kage",
        status: "enabled",
        granted_permissions: ["meeting_recording", "network"],
        config_keys: expect.arrayContaining(["base_url", "poll_ms"]),
        secrets_set: ["api_key"],
        commands: expect.arrayContaining(["meeting.start", "meeting.get_transcript"]),
      }),
    ]);
  });

  it("times Kage processing and summarises the bus, audit trail and counts", async () => {
    const core = await setup();
    const m = kage!.upload(TITLE);
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/meetings")).json.meetings).toHaveLength(1),
    );
    kage!.advance(m.id, "summarized");
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/diagnostics")).json.processing.runs).toHaveLength(1),
    );

    const report = (await core.api("GET", "/api/diagnostics")).json;
    expect(report.processing.runs[0]).toMatchObject({ capability: "kage", outcome: "ready" });
    expect(report.processing.average_ms).toBe(report.processing.runs[0].duration_ms);
    expect(report.processing.max_ms).toBe(report.processing.runs[0].duration_ms);
    expect(report.counts).toMatchObject({ meetings: 1 });
    expect(report.counts.events).toBeGreaterThan(0);
    expect(report.bus.published).toBeGreaterThan(0);
    expect(report.recent_events[0]).toEqual({
      seq: expect.any(Number),
      type: expect.any(String),
      source: expect.any(String),
      severity: expect.any(String),
      at: expect.any(String),
    });
    expect(report.recent_audit.map((a: { action: string }) => a.action)).toContain(
      "permission.granted",
    );
    expect(report).toMatchObject({ kill_switch: false, pet: { recording: false } });
  });
});
