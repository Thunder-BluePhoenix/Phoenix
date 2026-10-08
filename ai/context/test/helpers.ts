// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  MemoryPipeline,
  MemoryStore,
  createDefaultPolicy,
  ownerViewer,
  type RawCapture,
  type Viewer,
} from "@phoenix/ai-memory";
import { openDatabase } from "@phoenix/persistence";
import { ContextEngine, type Clock } from "../src";

/** Thursday 2026-10-08 12:00 UTC. */
export const NOW = new Date("2026-10-08T12:00:00.000Z");

export interface Rig {
  store: MemoryStore;
  pipeline: MemoryPipeline;
  engine: ContextEngine;
  clock: Clock;
  owner: Viewer;
  add(over: Partial<RawCapture> & { text: string; dedupeKey: string }): void;
}

export function rig(timeZone = "UTC"): Rig {
  const clock: Clock = { now: () => NOW, timeZone };
  const store = new MemoryStore(openDatabase(":memory:"), { now: clock.now });
  const pipeline = new MemoryPipeline({
    store,
    owner: "me",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
  });
  return {
    store,
    pipeline,
    clock,
    engine: new ContextEngine({ store, clock }),
    owner: ownerViewer("me"),
    add(over) {
      const out = pipeline.capture({
        source: "git",
        sourceRef: "phoenix",
        scope: "repo:phoenix",
        contentType: "commit",
        observedAt: "2026-10-07T10:00:00.000Z",
        provenance: {},
        ...over,
      });
      if (out.status !== "stored") throw new Error(`fixture not stored: ${JSON.stringify(out)}`);
    },
  };
}
