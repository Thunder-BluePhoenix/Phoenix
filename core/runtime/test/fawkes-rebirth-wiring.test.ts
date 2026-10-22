// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { CELEBRATION_EVENT } from "../src/fawkes-rebirth/service";
import { connect, event, startCore, type HubClient, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Celebration {
  kind: string;
  id: number;
}

interface Rig {
  core: TestCore;
  /** Every celebration the bus carried, in order. */
  seen: Celebration[];
  publish(...events: ReturnType<typeof createEvent>[]): Promise<void>;
}

async function boot(): Promise<Rig> {
  const core = await startCore();
  cleanups.push(() => core.runtime.stop());
  const seen: Celebration[] = [];
  core.runtime.bus.subscribe("test-celebrations", CELEBRATION_EVENT, (e) => {
    seen.push(e.payload as unknown as Celebration);
  });
  return {
    core,
    seen,
    async publish(...events) {
      for (const e of events) {
        expect(core.runtime.bus.publish(e).ok).toBe(true);
        await core.runtime.bus.drain();
      }
    },
  };
}

async function hubOf(rig: Rig): Promise<HubClient> {
  const hub = connect(rig.core.port);
  await hub.opened;
  hub.send({ type: "subscribe", channels: ["event.created"] });
  await hub.next((m) => m.type === "subscribed");
  cleanups.push(() => hub.ws.close());
  return hub;
}

let clock = Date.now();
/** What the GitHub capability emits for a workflow run; the repository etc. are what a view must never see. */
function ci(result: "passed" | "failed", over: Record<string, unknown> = {}, source = "github") {
  clock += 1_000;
  return createEvent({
    event_type: `github.ci.${result}`,
    source,
    severity: result === "passed" ? "success" : "error",
    timestamp: new Date(clock).toISOString(),
    payload: {
      repository: "acme/secret-project",
      workflow: "build",
      branch: "main",
      title: "private commit message",
      ...over,
    },
  });
}

function merged(number: number, repository = "acme/secret-project") {
  clock += 1_000;
  return createEvent({
    event_type: "github.pr.merged",
    source: "github",
    severity: "success",
    timestamp: new Date(clock).toISOString(),
    payload: { repository, number, title: "private pull request" },
  });
}

describe("Fawkes rebirth through the running Core", () => {
  it("celebrates a fixed build once, pushes it live, and shows nothing but a kind and a number", async () => {
    const rig = await boot();
    const hub = await hubOf(rig);
    await rig.publish(ci("failed"), ci("passed"));
    const pushed = await hub.next((m) => m.data?.event?.event_type === CELEBRATION_EVENT);
    expect(pushed.data.event.payload).toEqual({ kind: "rebirth", id: expect.any(Number) });
    const text = JSON.stringify(pushed);
    for (const secret of ["acme", "secret-project", "private", "build", "main"])
      expect(text).not.toContain(secret);
    expect(rig.seen).toHaveLength(1);
    // A live push only: it is never written to the event history.
    const history = (await rig.core.api("GET", "/api/events?limit=200")).json;
    expect(JSON.stringify(history)).not.toContain(CELEBRATION_EVENT);
  });

  it("does not celebrate a first green build, a green after a green, or a fix on another branch", async () => {
    const rig = await boot();
    await rig.publish(
      ci("passed"),
      ci("passed"),
      ci("failed", { branch: "feature" }),
      ci("passed", { branch: "main" }),
      ci("passed", { branch: "feature", workflow: "other" }),
    );
    expect(rig.seen).toEqual([]);
  });

  it("ignores build outcomes that did not come from the GitHub capability", async () => {
    const rig = await boot();
    await rig.publish(
      ci("failed", {}, "terminal"),
      ci("passed", {}, "terminal"),
      ci("failed", {}, "agents"),
      ci("passed", {}, "agents"),
    );
    expect(rig.seen).toEqual([]);
    // And the session-token route cannot claim to be GitHub in the first place.
    const posted = await rig.core.api(
      "POST",
      "/api/events",
      event("github.ci.failed", { source: "github" }),
    );
    expect(posted.status).toBe(403);
  });

  it("shows milestones only after the user turns them on, and never replays one from before", async () => {
    const rig = await boot();
    await rig.publish(ci("passed", { workflow: "weekly" }), merged(1), merged(2), merged(3));
    expect(rig.seen).toEqual([]);

    expect((await rig.core.api("PUT", "/api/fawkes/rebirth", { milestones: true })).json).toEqual({
      milestones: true,
      highContrast: false,
    });
    expect(rig.seen).toEqual([]);
    // A fourth merge does not start a new streak of three; a fresh repository does.
    await rig.publish(merged(1, "acme/other"), merged(2, "acme/other"), merged(3, "acme/other"));
    expect(rig.seen.map((c) => c.kind)).toEqual(["pr-streak"]);
  });

  it("keeps milestones off by default and refuses malformed settings", async () => {
    const rig = await boot();
    expect((await rig.core.api("GET", "/api/fawkes/rebirth")).json).toEqual({
      milestones: false,
      highContrast: false,
    });
    await rig.publish(merged(1), merged(2), merged(3));
    expect(rig.seen).toEqual([]);
    for (const bad of [{}, { milestones: "yes" }, { other: true }, [], { milestones: true, x: 1 }])
      expect((await rig.core.api("PUT", "/api/fawkes/rebirth", bad)).status).toBe(400);
    expect((await fetch(`${rig.core.base}/api/fawkes/rebirth`)).status).toBe(401);
  });

  it("numbers deliveries so a view can tell a new celebration from a repeat", async () => {
    const rig = await boot();
    await rig.publish(ci("failed"), ci("passed"), ci("failed"), ci("passed"));
    expect(rig.seen).toHaveLength(2);
    expect(rig.seen[1]!.id).toBeGreaterThan(rig.seen[0]!.id);
  });
});
