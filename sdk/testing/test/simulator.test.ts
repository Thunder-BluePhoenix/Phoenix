// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { PhoenixRuntime } from "@phoenix/runtime";
import { SCENARIOS } from "@phoenix/sdk-events";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, publish, simulate } from "../src";

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function core() {
  const runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0, dataDir: mkdtempSync(join(tmpdir(), "phoenix-sim-")) },
    logger: silentLogger,
    writeTokenFile: false,
    databasePath: ":memory:",
  });
  const { port } = await runtime.start();
  stop = () => runtime.stop();
  return { runtime, target: { url: `http://127.0.0.1:${port}`, token: runtime.token } };
}

describe("simulator against a running core", () => {
  it("plays every scenario end to end", async () => {
    const { runtime, target } = await core();
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      expect(await simulate(target, name, { speed: Infinity })).toBe(scenario.steps.length);
    }
    await runtime.bus.drain();
    expect(runtime.events.count()).toBeGreaterThan(Object.keys(SCENARIOS).length);
  });

  it("build-fail leaves Fawkes in ERROR (US-03)", async () => {
    const { runtime, target } = await core();
    await simulate(target, "build-fail", { speed: Infinity });
    await runtime.bus.drain();
    expect(runtime.state.snapshot()).toMatchObject({
      state: "ERROR",
      explanation: "Build failed (terminal)",
    });
  });

  it("publishes single events and reports API errors", async () => {
    const { target } = await core();
    expect(
      await publish(target, "terminal", {
        event_type: "build.started",
        severity: "info",
        payload: {},
      }),
    ).toMatch(/^evt_/);
    await expect(
      publish(target, "core", { event_type: "build.started", severity: "info", payload: {} }),
    ).rejects.toThrow(/403/);
    await expect(simulate(target, "nope")).rejects.toThrow(/Unknown scenario/);
  });
});

describe("harness", () => {
  it("answers confirmations as the user would", async () => {
    const h = createHarness({
      modules: [
        {
          manifest: {
            id: "deployer",
            name: "Deployer",
            version: "1.0.0",
            description: "d",
            license: "GPL-3.0-or-later",
            events: ["deploy.*"],
            permissions: ["production_action"],
            commands: [
              {
                name: "ship",
                description: "Ship it",
                side_effect: "production",
                permissions: ["production_action"],
              },
            ],
          },
          commands: { ship: () => "shipped" },
        },
      ],
    });
    await h.enable("deployer");
    expect(await h.run("deployer", "ship", {}, false)).toMatchObject({
      status: "failed",
      error: { code: "PERMISSION_DENIED" },
    });
    expect(await h.run("deployer", "ship")).toMatchObject({
      status: "succeeded",
      result: "shipped",
    });
    expect(h.types("core")).toContain("security.confirmation.requested");
    await h.close();
  });
});
