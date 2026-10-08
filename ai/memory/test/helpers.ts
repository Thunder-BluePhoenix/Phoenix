// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { openDatabase } from "@phoenix/persistence";
import {
  MemoryPipeline,
  MemoryStore,
  createDefaultPolicy,
  type MemoryPolicy,
  type RawCapture,
} from "../src";

export const T0 = "2026-10-08T10:00:00.000Z";

export interface Rig {
  store: MemoryStore;
  pipeline: MemoryPipeline;
  clock: { now: Date };
}

/** An in-memory store whose clock only moves when the test moves it. */
export function rig(policy?: MemoryPolicy): Rig {
  const clock = { now: new Date(T0) };
  let n = 0;
  const store = new MemoryStore(openDatabase(":memory:"), {
    now: () => clock.now,
    newId: () => `mem_${++n}`,
  });
  const pipeline = new MemoryPipeline({
    store,
    owner: "me",
    policy:
      policy ??
      createDefaultPolicy({
        isSourceEnabled: () => true,
        allowSensitive: () => true,
      }),
  });
  return { store, pipeline, clock };
}

export function capture(over: Partial<RawCapture> = {}): RawCapture {
  return {
    source: "git",
    sourceRef: "phoenix",
    scope: "repo:phoenix",
    contentType: "commit",
    text: "Commit abc1234 in phoenix: add database lock",
    observedAt: T0,
    dedupeKey: "git:phoenix:abc1234",
    provenance: { sha: "abc1234" },
    ...over,
  };
}
