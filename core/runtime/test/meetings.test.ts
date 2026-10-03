// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 15 end to end: Kage capability → events → Phoenix meeting records → Meeting API.
import { createKageCapability } from "@phoenix/capability-kage";
import { MOCK_KAGE_KEY, startMockKage, type MockKage } from "@phoenix/capability-kage/testing";
import { MemorySecretStore } from "@phoenix/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore } from "./helpers";

let kage: MockKage | undefined;
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  await kage?.close();
  kage = stop = undefined;
});

async function setup() {
  kage = await startMockKage();
  const secrets = new MemorySecretStore();
  const core = await startCore({}, { capabilities: [createKageCapability()], secrets });
  stop = () => core.runtime.stop();
  const { api } = core;
  expect(
    (await api("POST", "/api/capabilities/kage/secrets/api_key", { value: MOCK_KAGE_KEY })).status,
  ).toBe(200);
  await api("POST", "/api/capabilities/kage/config", {
    config: { base_url: kage.url, poll_ms: 250 },
  });
  expect((await api("POST", "/api/capabilities/kage/enable", {})).status).toBe(200);
  return { ...core, secrets };
}

describe("meetings API", () => {
  it("stores the API key in the secret store only, and never returns it", async () => {
    const { api, secrets, runtime } = await setup();
    expect(await secrets.get("capability.kage.api_key")).toBe(MOCK_KAGE_KEY);
    const view = (await api("GET", "/api/capabilities/kage")).json;
    expect(view.secrets).toEqual([expect.objectContaining({ name: "api_key", set: true })]);
    const row = runtime.db.prepare("SELECT * FROM credentials").all();
    expect(JSON.stringify(row)).not.toContain(MOCK_KAGE_KEY);
    expect(JSON.stringify((await api("GET", "/api/audit?capability=kage")).json)).not.toContain(
      MOCK_KAGE_KEY,
    );
    expect(
      (await api("POST", "/api/capabilities/kage/secrets/BAD NAME", { value: "x" })).status,
    ).toBe(400);
  });

  it("a processed meeting appears with transcript and summary", async () => {
    const { api } = await setup();
    const m = kage!.upload("Design review");
    kage!.advance(m.id, "transcribing");
    await vi.waitFor(async () =>
      expect((await api("GET", "/api/meetings")).json.meetings).toEqual([
        expect.objectContaining({ id: "kage:1", title: "Design review", status: "transcribing" }),
      ]),
    );
    expect((await api("GET", "/api/meetings/kage:1/transcript")).status).toBe(404);

    kage!.advance(m.id, "summarized");
    await vi.waitFor(async () =>
      expect((await api("GET", "/api/meetings/kage:1")).json).toMatchObject({
        status: "ready",
        has_transcript: true,
        has_summary: true,
        participants: ["Ada", "Linus"],
        recording: {
          location: `${kage!.url}/api/meetings/1/media/audio`,
          retention: "Stored and deleted by Kage",
        },
      }),
    );
    expect((await api("GET", "/api/meetings/kage:1/transcript")).json).toEqual({
      text: "We agreed to ship the Kage adapter.",
    });
    expect((await api("GET", "/api/meetings/kage:1/summary")).json).toMatchObject({
      generated_by: "ai",
      decisions: ["Ship the Kage adapter"],
    });
  });

  it("imports meetings that finished before Phoenix was watching", async () => {
    kage = await startMockKage();
    kage.advance(kage.upload("Yesterday").id, "summarized");
    const core = await startCore(
      {},
      { capabilities: [createKageCapability()], secrets: new MemorySecretStore() },
    );
    stop = () => core.runtime.stop();
    await core.api("POST", "/api/capabilities/kage/secrets/api_key", { value: MOCK_KAGE_KEY });
    await core.api("POST", "/api/capabilities/kage/config", {
      config: { base_url: kage.url, poll_ms: 250 },
    });
    await core.api("POST", "/api/capabilities/kage/enable", {});
    await vi.waitFor(async () =>
      expect((await core.api("GET", "/api/meetings/kage:1")).json).toMatchObject({
        has_summary: true,
      }),
    );
    const types = (
      (await core.api("GET", "/api/events?source=kage")).json.events as {
        event: { event_type: string };
      }[]
    ).map((e) => e.event.event_type);
    expect(types).toEqual(["kage.connected"]); // history is not replayed into the activity feed
  });

  it("archive hides a meeting; delete needs confirmation and is not undone by a later sync", async () => {
    const { api } = await setup();
    const m = kage!.upload("Secret plans");
    await vi.waitFor(async () =>
      expect((await api("GET", "/api/meetings/kage:1")).status).toBe(200),
    );

    await api("POST", "/api/meetings/kage:1/archive", {});
    expect((await api("GET", "/api/meetings")).json.meetings).toEqual([]);
    expect((await api("GET", "/api/meetings?archived=true")).json.meetings).toHaveLength(1);

    const refused = await api("DELETE", "/api/meetings/kage:1", {});
    expect(refused.json).toMatchObject({ code: "ACTION_REQUIRES_CONFIRMATION" });
    expect((await api("DELETE", "/api/meetings/kage:1", { confirm: true })).status).toBe(200);
    expect((await api("GET", "/api/meetings/kage:1")).status).toBe(404);

    kage!.advance(m.id, "summarized");
    await new Promise((r) => setTimeout(r, 700));
    expect((await api("GET", "/api/meetings/kage:1")).status).toBe(404);
    expect((await api("GET", "/api/meetings?archived=true")).json.meetings).toEqual([]);
  });

  it("core keeps serving when Kage is down", async () => {
    const { api, runtime } = await setup();
    kage!.upload("Kept");
    await vi.waitFor(async () =>
      expect((await api("GET", "/api/meetings/kage:1")).status).toBe(200),
    );
    kage!.setDown(true);
    const op = await runtime.capabilities.invokeAndWait("kage", "meeting.list");
    expect(op).toMatchObject({ status: "failed", error: { code: "CAPABILITY_UNAVAILABLE" } });
    expect((await api("GET", "/api/health")).json.status).toBe("ok");
    // Phoenix's own records stay readable during the outage.
    expect((await api("GET", "/api/meetings")).json.meetings).toHaveLength(1);
  });
});
