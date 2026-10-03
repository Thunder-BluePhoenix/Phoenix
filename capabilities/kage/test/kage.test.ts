// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKageCapability, statusEvent, type KageMeeting } from "../src";
import { MOCK_KAGE_KEY, startMockKage, type MockKage } from "../testing/mock-kage";

const FAKE_BOT = join(import.meta.dirname, "../testing/fake-bot.cjs");
let h: Harness | undefined;
let kage: MockKage | undefined;
afterEach(async () => {
  await h?.close();
  await kage?.close();
  h = kage = undefined;
  delete process.env.FAKE_BOT_EXIT;
  delete process.env.FAKE_BOT_HOLD_MS;
});

async function ready(config: Record<string, unknown> = {}, key: string | null = MOCK_KAGE_KEY) {
  kage = await startMockKage();
  h = createHarness({ modules: [createKageCapability()] });
  h.manager.configure("kage", { base_url: kage.url, poll_ms: 250, bot_path: FAKE_BOT, ...config });
  if (key) await h.manager.setSecret("kage", "api_key", key);
  await h.enable("kage");
  return { h, kage };
}

const has = (type: string) => vi.waitFor(() => expect(h!.types("kage")).toContain(type));
const fawkes = () => h!.state.snapshot();

describe("statusEvent", () => {
  const m: KageMeeting = {
    id: 7,
    title: "Retro",
    status: "transcribing",
    created_at: "2026-10-04 09:00:00",
    duration_seconds: null,
    participants: null,
  };
  it("maps Kage statuses onto the Phoenix lifecycle", () => {
    expect(statusEvent(m, "http://k")).toMatchObject({
      event_type: "kage.transcription.started",
      correlation_id: "kage-meeting-7",
      subject: "Retro",
      payload: {
        meeting_id: "7",
        status: "transcribing",
        started_at: "2026-10-04T09:00:00Z",
        recording: { location: "http://k/api/meetings/7/media/audio" },
      },
    });
    expect(statusEvent({ ...m, status: "summarized" }, "")?.event_type).toBe("kage.summary.ready");
    expect(statusEvent({ ...m, status: "failed" }, "")?.severity).toBe("error");
    expect(statusEvent({ ...m, status: "mystery" }, "")).toBeNull();
  });
});

describe("kage capability", () => {
  it("asks for meeting_recording, keeps the API key out of config", async () => {
    await ready();
    const view = h!.manager.get("kage");
    expect(view.permissions.map((p) => p.permission)).toEqual(["meeting_recording", "network"]);
    expect(view.secrets).toEqual([expect.objectContaining({ name: "api_key", set: true })]);
    expect(JSON.stringify(view)).not.toContain(MOCK_KAGE_KEY);
    expect(() =>
      h!.manager.configure("kage", {
        base_url: kage!.url,
        api_key: "sk-abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow();
  });

  it("follows a meeting through processing and drives Fawkes", async () => {
    await ready();
    await has("kage.connected");
    const m = kage!.upload("Standup");
    await has("kage.meeting.ended");
    expect(fawkes()).toMatchObject({ state: "WORKING", explanation: "Processing meeting" });

    kage!.advance(m.id, "transcribing");
    await has("kage.transcription.started");
    kage!.advance(m.id, "transcribed");
    await has("kage.transcription.completed");
    expect(fawkes()).toMatchObject({ state: "SUCCESS", explanation: "Transcript ready: Standup" });

    kage!.advance(m.id, "summarized");
    await has("kage.summary.ready");
    const summary = await h!.run("kage", "meeting.get_summary", { meeting_id: String(m.id) });
    expect(summary.result).toMatchObject({
      generated_by: "ai",
      decisions: ["Ship the Kage adapter"],
      action_items: [{ text: "Write the docs" }],
    });
    const transcript = await h!.run("kage", "meeting.get_transcript", { meeting_id: String(m.id) });
    expect(transcript.result).toEqual({ text: "We agreed to ship the Kage adapter." });
  });

  it("falls back to Kage's extractive summary when it has no AI key", async () => {
    await ready();
    await has("kage.connected"); // settled meetings seen on the first poll count as history
    const m = kage!.upload();
    kage!.advance(m.id, "transcribed");
    await has("kage.transcription.completed");
    const op = await h!.run("kage", "meeting.get_summary", { meeting_id: String(m.id) });
    expect(op.result).toMatchObject({ text: "Ship the Kage adapter.", generated_by: "extractive" });
  });

  it("syncs past meetings quietly instead of replaying them at Fawkes", async () => {
    kage = await startMockKage();
    kage.advance(kage.upload("Old").id, "summarized");
    const live = kage.upload("Live");
    kage.advance(live.id, "transcribing");
    const url = kage.url;
    h = createHarness({ modules: [createKageCapability()] });
    h.manager.configure("kage", { base_url: url, poll_ms: 250 });
    await h.manager.setSecret("kage", "api_key", MOCK_KAGE_KEY);
    await h.enable("kage");
    await has("kage.meeting.synced");
    await has("kage.transcription.started");
    expect(h.types("kage")).not.toContain("kage.summary.ready");
    expect(h.events.find((e) => e.event_type === "kage.meeting.synced")!.payload).toMatchObject({
      title: "Old",
      status: "ready",
    });
  });

  it("core survives a Kage outage (CAPABILITY_UNAVAILABLE)", async () => {
    await ready();
    await has("kage.connected");
    kage!.setDown(true);
    await new Promise((r) => setTimeout(r, 400)); // let a poll fail too
    const view = await h!.manager.checkHealth("kage");
    expect(view.health).toMatchObject({
      status: "unhealthy",
      message: expect.stringMatching(/unreachable/),
    });
    expect(fawkes()).toMatchObject({ state: "WARNING", explanation: "Kage is unavailable" });
    const op = await h!.run("kage", "meeting.list");
    expect(op).toMatchObject({ status: "failed", error: { code: "CAPABILITY_UNAVAILABLE" } });

    kage!.setDown(false);
    await h!.manager.checkHealth("kage");
    await vi.waitFor(() =>
      expect(h!.types("kage").filter((t) => t === "kage.connected")).toHaveLength(2),
    );
    expect(fawkes().state).not.toBe("WARNING");
  });

  it("reports a missing or wrong API key without failing", async () => {
    await ready({}, null);
    expect((await h!.manager.checkHealth("kage")).health).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/no Kage API key/),
    });
    expect(await h!.run("kage", "meeting.list")).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
    await h!.manager.setSecret("kage", "api_key", "wrong");
    await vi.waitFor(async () =>
      expect((await h!.manager.checkHealth("kage")).health.message).toMatch(/rejected the API key/),
    );
  });
});

describe("meeting capture", () => {
  const start = (approve = true) =>
    h!.run(
      "kage",
      "meeting.start",
      { meet_url: "https://meet.google.com/abc-defg-hij", title: "Planning" },
      approve,
    );

  it("needs explicit approval, shows RECORDING, and clears it when the bot finishes", async () => {
    await ready();
    process.env.FAKE_BOT_HOLD_MS = "400";
    const seen: string[] = [];
    h!.state.onChange((s) => void seen.push(s.state));
    const audit = () => h!.permissions.audit.list({ capabilityId: "kage" }).map((a) => a.action);

    expect(await start(false)).toMatchObject({ status: "failed" });
    expect(h!.types("kage")).not.toContain("kage.meeting.started");

    expect(await start()).toMatchObject({ status: "succeeded" });
    expect(audit()).toContain("confirmation.requested");
    await has("kage.meeting.recording");
    expect(fawkes()).toMatchObject({ state: "RECORDING", recording: true });
    await has("kage.capture.finished");
    expect(fawkes().recording).toBe(false);
    expect(seen).toContain("RECORDING");
  });

  it("a failed capture is an ERROR with Kage's reason", async () => {
    await ready();
    process.env.FAKE_BOT_EXIT = "1";
    await start();
    await has("kage.meeting.failed");
    expect(fawkes().state).toBe("ERROR");
    expect(h!.events.find((e) => e.event_type === "kage.meeting.failed")!.payload.error).toBe(
      "upload failed: 500 boom",
    );
  });

  it("one capture at a time; refuses non-Meet URLs and a missing bot path", async () => {
    await ready();
    process.env.FAKE_BOT_HOLD_MS = "2000";
    await start();
    expect(await start()).toMatchObject({
      status: "failed",
      error: { message: /Already capturing/ },
    });
    expect(() =>
      h!.manager.invoke("kage", "meeting.start", {
        meet_url: "https://evil.example/?meet.google.com",
      }),
    ).toThrow(/Invalid command input/);
    await h!.manager.disable("kage");
    h!.manager.configure("kage", { base_url: kage!.url });
    await h!.enable("kage");
    expect(await start()).toMatchObject({ status: "failed", error: { message: /bot_path/ } });
  });

  it("disabling Kage mid-capture stops the bot and the recording indicator", async () => {
    await ready();
    process.env.FAKE_BOT_HOLD_MS = "5000";
    await start();
    await has("kage.meeting.recording");
    expect(fawkes().recording).toBe(true);
    await h!.manager.disable("kage");
    expect(fawkes()).toMatchObject({ recording: false });
    expect(fawkes().state).not.toBe("RECORDING");
  });
});
