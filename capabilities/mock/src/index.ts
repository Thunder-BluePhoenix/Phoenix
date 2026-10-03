// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Mock capability (Phase 13): a builtin capability that plays the demo
// scenarios through the real capability path (manifest, permissions,
// declared events, commands). Registered by Phoenix Core in dev only.
import { defineCapability, type CapabilityContext } from "@phoenix/sdk";
import { SCENARIO_NAMES, SCENARIOS } from "@phoenix/sdk-events";

const running = new Set<Promise<void>>();

async function play(ctx: CapabilityContext, name: string, speed: number): Promise<number> {
  const scenario = SCENARIOS[name]!;
  let emitted = 0;
  for (const step of scenario.steps) {
    const wait = step.afterMs / speed;
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, wait);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (ctx.signal.aborted) break;
    if (ctx.emit(step.event).ok) emitted++;
  }
  return emitted;
}

export const mockCapability = defineCapability({
  manifest: {
    id: "mock",
    name: "Mock",
    version: "0.1.0",
    description:
      "Plays demo scenarios (builds, agents, deploys, meetings) so you can see Fawkes react.",
    license: "GPL-3.0-or-later",
    events: ["build.*", "test.*", "agent.*", "deploy.*", "git.*", "kage.*", "frappe.*"],
    permissions: [],
    data_categories: [],
    commands: [
      {
        name: "simulate",
        description: "Play a demo scenario",
        side_effect: "none",
        input_schema: {
          type: "object",
          required: ["scenario"],
          additionalProperties: false,
          properties: {
            scenario: { enum: SCENARIO_NAMES },
            wait: { type: "boolean", description: "Resolve when the scenario finishes" },
          },
        },
        timeout_ms: 120_000,
      },
      { name: "ping", description: "Check the mock capability responds", side_effect: "none" },
    ],
    config_schema: {
      type: "object",
      additionalProperties: false,
      properties: { speed: { type: "number", minimum: 0.1, maximum: 1000 } },
    },
  },
  commands: {
    async simulate(input, ctx) {
      const { scenario, wait } = input as { scenario: string; wait?: boolean };
      const speed = typeof ctx.config.speed === "number" ? ctx.config.speed : 1;
      const run = play(ctx, scenario, speed);
      if (wait) return { scenario, emitted: await run };
      const tracked = run.then(() => undefined);
      running.add(tracked);
      void tracked.finally(() => running.delete(tracked));
      return { scenario, started: true };
    },
    ping: () => "pong",
  },
  health: () => ({ status: "healthy" }),
});
