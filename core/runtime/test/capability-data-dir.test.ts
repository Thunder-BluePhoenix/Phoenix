// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 73: through the real runtime, the keep-awake capability's journal lands in the directory
// Core owns for it (`<config.dataDir>/capabilities/awake`), the one the launchd backstop is told to
// watch. The disk the journal writes to is a map and the "processes" are a table: no sudo, pmset or
// launchd ever runs; only the directory Core itself makes is real (in a temp folder).
import { statSync } from "node:fs";
import { join } from "node:path";
import { createAwakeCapability, type AwakeModule } from "@phoenix/capability-awake";
import { createRecoveryModule, SAFETY_TEXT_SHA256 } from "../../../capabilities/awake/src/power";
import { FakeProcesses, MemFs } from "../../../capabilities/awake/test/power/fixtures";
import { FakeSystem } from "../../../capabilities/awake/testing/fakes";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function yieldToEventLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

/** Runs an awake command and answers its confirmation prompt like the user would. */
async function run(core: TestCore, command: string, input: unknown = {}): Promise<unknown> {
  const op = core.runtime.capabilities.invoke("awake", command, input, "user");
  for (let i = 0; i < 5_000 && (op.status === "pending" || op.status === "running"); i++) {
    for (const c of core.runtime.permissions.pendingConfirmations()) {
      core.runtime.permissions.resolveConfirmation(c.id, true);
    }
    await yieldToEventLoop();
  }
  expect(op.status).toBe("succeeded");
  return op.result;
}

describe("the awake journal lives in the directory Core owns for it", () => {
  it("is written to <dataDir>/capabilities/awake, and recovery.status reports that path", async () => {
    const system = new FakeSystem({ platform: "darwin" });
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    // No `dir`: the module must take the directory from the context Core's manager gives it.
    const recovery = createRecoveryModule({ fs, probe: procs.probe(), pollMs: 5_000 });
    const holder: { core?: TestCore } = {};
    const awake = createAwakeCapability({
      env: system.env,
      battery: () => Promise.resolve({ kind: "none" }),
      feed: () => holder.core?.runtime.bus,
      modules: [recovery satisfies AwakeModule],
    });
    const core = await startCore({}, { capabilities: [awake] });
    holder.core = core;
    cleanups.push(() => core.runtime.stop());

    expect((await core.api("POST", "/api/capabilities/awake/enable", {})).status).toBe(200);
    await run(core, "safety.acknowledge", {
      acknowledge: true,
      version: 1,
      text_sha256: SAFETY_TEXT_SHA256,
    });
    await run(core, "start", { minutes: 60 });
    await run(core, "lid_closed.start", {});

    const dir = join(core.dataDir, "capabilities", "awake");
    const journal = join(dir, "recovery-journal.jsonl");
    expect(fs.read(journal)).toBeDefined();
    expect([...fs.files.keys()].filter((p) => p.endsWith("recovery-journal.jsonl"))).toEqual([
      journal,
    ]);
    const status = (await run(core, "recovery.status", {})) as { journal_path: string };
    expect(status.journal_path).toBe(journal);
    // The directory Core made for it is real, a child of Core's own, and private to the user.
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(core.dataDir, "capabilities")).mode & 0o777).toBe(0o700);
  });
});
