// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 20 end to end (PRD v2.0 §20): meeting start → approval → recording → transcript →
// summary → approved action. Everything goes through the public HTTP and WebSocket API, the
// way the web app and desktop Fawkes use it. Kage and its capture bot are test doubles.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKageCapability } from "@phoenix/capability-kage";
import { MOCK_KAGE_KEY, startMockKage, type MockKage } from "@phoenix/capability-kage/testing";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, startCore } from "./helpers";

const FAKE_BOT = join(import.meta.dirname, "../../../capabilities/kage/testing/fake-bot.cjs");
const MEET_URL = "https://meet.google.com/abc-defg-hij";

let kage: MockKage | undefined;
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  await kage?.close();
  kage = stop = undefined;
  delete process.env.FAKE_BOT_HOLD_MS;
  delete process.env.FAKE_BOT_PIDFILE;
});

type Core = Awaited<ReturnType<typeof startCore>>;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function setup() {
  kage = await startMockKage();
  const core = await startCore(
    {},
    { capabilities: [createKageCapability()], secrets: new MemorySecretStore() },
  );
  stop = () => core.runtime.stop();
  await core.api("POST", "/api/capabilities/kage/secrets/api_key", { value: MOCK_KAGE_KEY });
  await core.api("POST", "/api/capabilities/kage/config", {
    config: { base_url: kage.url, poll_ms: 250, bot_path: FAKE_BOT },
  });
  expect((await core.api("POST", "/api/capabilities/kage/enable", {})).status).toBe(200);

  const ws = connect(core.port);
  await ws.opened;
  ws.send({
    type: "subscribe",
    channels: ["state.changed", "event.created", "task.updated"],
  });
  return { core, ws };
}

/** Starts a capture over the API and returns the operation id. */
async function startCapture(core: Core) {
  const res = await core.api("POST", "/api/capabilities/kage/commands/meeting.start", {
    input: { meet_url: MEET_URL, title: "Planning" },
  });
  expect(res.status).toBe(202);
  return res.json.id as string;
}

const operation = async (core: Core, id: string) =>
  (await core.api("GET", `/api/operations/${id}`)).json;

describe("meeting workflow (US-04 → US-07)", () => {
  it("start → approve → recording → transcript → summary", async () => {
    process.env.FAKE_BOT_HOLD_MS = "300";
    const { core, ws } = await setup();
    const opId = await startCapture(core);

    // Nothing starts until the user says yes, and Fawkes asks for them.
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "WAITING");
    const [confirmation] = (await core.api("GET", "/api/confirmations")).json.confirmations;
    expect(confirmation).toMatchObject({ capabilityId: "kage", command: "meeting.start" });
    expect((await operation(core, opId)).status).not.toBe("succeeded");
    expect(core.runtime.events.recent({ type: "kage.meeting.started" })).toHaveLength(0);

    expect(
      (await core.api("POST", `/api/confirmations/${confirmation.id}`, { approve: true })).status,
    ).toBe(200);

    // Recording is visible, and stays visible as its own flag.
    const recording = await ws.next(
      (m) => m.channel === "state.changed" && m.data.state === "RECORDING",
    );
    expect(recording.data).toMatchObject({ recording: true, explanation: "Recording meeting" });
    expect((await operation(core, opId)).status).toBe("succeeded");

    // The bot finishes; the recording indicator goes away.
    await ws.next((m) => m.channel === "state.changed" && m.data.recording === false);

    // Kage processes the upload; Phoenix follows it and Fawkes reports it.
    const m = kage!.upload("Planning");
    kage!.advance(m.id, "transcribing");
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/meetings")).json.meetings).toEqual([
        expect.objectContaining({ id: "kage:1", status: "transcribing", has_transcript: false }),
      ]),
    );
    kage!.advance(m.id, "summarized");
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "SUCCESS");

    // US-06: transcript and summary are retrievable.
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/meetings/kage:1")).json).toMatchObject({
        status: "ready",
        has_transcript: true,
        has_summary: true,
      }),
    );
    expect((await core.api("GET", "/api/meetings/kage:1/transcript")).json.text).toBe(
      "We agreed to ship the Kage adapter.",
    );
    const summary = (await core.api("GET", "/api/meetings/kage:1/summary")).json;
    expect(summary).toMatchObject({
      decisions: ["Ship the Kage adapter"],
      action_items: [{ text: "Write the docs", owner: "Ada" }],
    });

    // The approval and the capture are on the record.
    const audit = (await core.api("GET", "/api/audit?capability=kage")).json.entries.map(
      (e: { action: string; decision: string }) => `${e.action}:${e.decision}`,
    );
    expect(audit).toContain("confirmation.requested:pending");
    expect(audit).toContain("confirmation.approved:allowed");
  });

  it("US-07: declining starts nothing and leaves no recording", async () => {
    const { core, ws } = await setup();
    const opId = await startCapture(core);
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "WAITING");
    const [confirmation] = (await core.api("GET", "/api/confirmations")).json.confirmations;

    await core.api("POST", `/api/confirmations/${confirmation.id}`, { approve: false });
    await vi.waitFor(async () => expect((await operation(core, opId)).status).toBe("failed"));
    await core.runtime.bus.drain();

    expect(core.runtime.events.recent({ type: "kage.*" }).map((e) => e.event.event_type)).toEqual(
      expect.not.arrayContaining(["kage.meeting.started", "kage.meeting.recording"]),
    );
    expect((await core.api("GET", "/api/pet/state")).json).toMatchObject({ recording: false });
  });

  it("the emergency stop ends a capture in progress: the bot process and the indicator", async () => {
    const pidfile = join(mkdtempSync(join(tmpdir(), "phoenix-bot-")), "bot.pid");
    process.env.FAKE_BOT_PIDFILE = pidfile;
    process.env.FAKE_BOT_HOLD_MS = "30000";
    const { core, ws } = await setup();
    await startCapture(core);
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "WAITING");
    const [confirmation] = (await core.api("GET", "/api/confirmations")).json.confirmations;
    await core.api("POST", `/api/confirmations/${confirmation.id}`, { approve: true });
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "RECORDING");
    const pid = Number(readFileSync(pidfile, "utf8"));
    expect(isAlive(pid)).toBe(true);

    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    await ws.next((m) => m.channel === "state.changed" && m.data.recording === false);
    expect((await core.api("GET", "/api/pet/state")).json.recording).toBe(false);
    expect((await core.api("GET", "/api/capabilities/kage")).json.status).not.toBe("enabled");
    // The indicator going out is not enough: the process that records must be gone too.
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false));
  });

  it("Core keeps serving when Kage disappears mid-workflow", async () => {
    const { core, ws } = await setup();
    kage!.setDown(true);
    // Health is polled every 15 s; ask for a check now instead of waiting.
    await core.runtime.capabilities.checkHealth("kage");
    await ws.next((m) => m.channel === "state.changed" && m.data.state === "WARNING");

    expect((await core.api("GET", "/api/capabilities/kage")).json.health.status).toBe("unhealthy");
    expect((await core.api("GET", "/api/health")).status).toBe(200);
    expect((await core.api("GET", "/api/pet/state")).json.explanation).toBe("Kage is unavailable");
    expect((await core.api("GET", "/api/meetings")).status).toBe(200);
  });
});
