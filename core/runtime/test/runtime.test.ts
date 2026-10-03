// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { PhoenixRuntime } from "../src";

let runtime: PhoenixRuntime | undefined;
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
});

function make() {
  runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0 },
    logger: silentLogger,
    databasePath: ":memory:",
  });
  return runtime;
}

describe("PhoenixRuntime", () => {
  it("serves /api/health", async () => {
    const rt = make();
    const { port } = await rt.start();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      protocol: "1.0",
      schema_version: 1,
      pet: { state: "IDLE", recording: false },
    });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it("routes events through the bus into the state engine and history", async () => {
    const rt = make();
    await rt.start();
    const changes: string[] = [];
    rt.bus.subscribe(
      "test",
      "pet.state.changed",
      (e) => void changes.push(String(e.payload.state)),
    );

    rt.bus.publish(
      createEvent({ event_type: "build.started", source: "terminal", severity: "info" }),
    );
    await rt.bus.drain();
    rt.bus.publish(
      createEvent({ event_type: "build.failed", source: "terminal", severity: "error" }),
    );
    await rt.bus.drain();

    expect(rt.state.snapshot().state).toBe("ERROR");
    expect(changes).toEqual(["WORKING", "ERROR"]);
    // system.online + 2 builds are durable; pet.state.changed is ephemeral.
    expect(rt.events.recent().map((r) => r.event.event_type)).toEqual([
      "build.failed",
      "build.started",
      "system.online",
    ]);
  });

  it("stop is graceful and idempotent", async () => {
    const rt = make();
    await rt.start();
    await Promise.all([rt.stop(), rt.stop()]);
  });
});
