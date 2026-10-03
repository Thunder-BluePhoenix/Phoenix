// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { SCENARIO_NAMES } from "@phoenix/sdk-events";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it } from "vitest";
import { mockCapability } from "../src";

let h: Harness;
afterEach(() => h?.close());

async function ready(speed = 1000) {
  h = createHarness({ modules: [mockCapability] });
  h.manager.configure("mock", { speed });
  await h.enable("mock");
  return h;
}

describe("mock capability", () => {
  it("responds to ping", async () => {
    await ready();
    expect(await h.run("mock", "ping")).toMatchObject({ status: "succeeded", result: "pong" });
  });

  it.each(SCENARIO_NAMES)("plays %s through the capability path", async (scenario) => {
    await ready();
    const op = await h.run("mock", "simulate", { scenario, wait: true });
    expect(op.status).toBe("succeeded");
    expect((op.result as { emitted: number }).emitted).toBeGreaterThan(0);
    expect(h.types("mock").length).toBe((op.result as { emitted: number }).emitted);
  });

  it("drives Fawkes: build-fail ends in ERROR, meeting shows RECORDING on the way", async () => {
    await ready();
    const seen = new Set<string>();
    h.state.onChange((s) => void seen.add(s.state));
    await h.run("mock", "simulate", { scenario: "meeting", wait: true });
    expect(seen.has("RECORDING")).toBe(true);
    await h.run("mock", "simulate", { scenario: "build-fail", wait: true });
    expect(h.state.snapshot().state).toBe("ERROR");
  });

  it("rejects unknown scenarios", async () => {
    await ready();
    expect(() => h.manager.invoke("mock", "simulate", { scenario: "nope" })).toThrow(
      /Invalid command input/,
    );
  });

  it("stops playing when disabled", async () => {
    await ready(1);
    await h.run("mock", "simulate", { scenario: "meeting" });
    await h.manager.disable("mock");
    const before = h.types("mock").length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(h.types("mock").length).toBe(before);
  });
});
