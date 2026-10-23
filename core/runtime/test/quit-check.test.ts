// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 73: the quit veto as Core answers the desktop shell's Quit, through the real runtime and
// HTTP API (real manager, bus, permission gateway and the real recovery module) on a fake
// machine: the disk is a map, "processes" are a table and no sudo, pmset or launchd ever runs.
import { createAwakeCapability, type AwakeModule, type RunResult } from "@phoenix/capability-awake";
import { createRecoveryModule, SAFETY_TEXT_SHA256 } from "../../../capabilities/awake/src/power";
import { FakeProcesses, JOURNAL, MemFs } from "../../../capabilities/awake/test/power/fixtures";
import { FakeSystem } from "../../../capabilities/awake/testing/fakes";
import { afterEach, describe, expect, it } from "vitest";
import { QUIT_CHECK_LIST_LIMIT, QuitCheckService } from "../src/quit-check";
import { startCore, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const PATH = "/api/awake/quit-check";

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

async function boot(sudoRefuses = false) {
  const system = new FakeSystem({ platform: "darwin" });
  const fs = new MemFs();
  const procs = new FakeProcesses(100);
  const recovery = createRecoveryModule({
    dir: "/data",
    fs,
    probe: procs.probe(),
    pollMs: 5_000,
  });
  const holder: { core?: TestCore } = {};
  const awake = createAwakeCapability({
    env: system.env,
    battery: () => Promise.resolve({ kind: "none" }),
    feed: () => holder.core?.runtime.bus,
    modules: [recovery satisfies AwakeModule],
    onQuitCheck: (check) => holder.core?.runtime.quitCheck.bind(check),
  });
  const core = await startCore({}, { capabilities: [awake] });
  holder.core = core;
  cleanups.push(() => core.runtime.stop());
  const state = { sudoRefuses };
  system.script = (file): RunResult | undefined =>
    state.sudoRefuses && file === "/usr/bin/sudo" ? { code: 1, stdout: "", stderr: "" } : undefined;
  return { core, system, fs, state };
}

const check = async (core: TestCore) => core.api("GET", PATH);

describe("the quit veto through the running Core (Phase 73)", () => {
  it("needs the session token", async () => {
    const { core } = await boot();
    expect((await fetch(`${core.base}${PATH}`)).status).toBe(401);
    // Only GET is routed: a write verb finds no such route.
    expect((await core.api("POST", PATH, {})).status).toBe(405);
  });

  it("says nothing is known, and that quitting is fine, until the capability has run", async () => {
    const { core } = await boot();
    const res = await check(core);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ available: false, can_quit: true, count: 0, pending: [] });
  });

  it("is clean once enabled, refuses while a lid-closed change is pending, and clears when it is undone", async () => {
    const { core, fs } = await boot();
    expect((await core.api("POST", "/api/capabilities/awake/enable", {})).status).toBe(200);
    expect((await check(core)).json).toEqual({
      available: true,
      can_quit: true,
      count: 0,
      pending: [],
    });

    await run(core, "safety.acknowledge", {
      acknowledge: true,
      version: 1,
      text_sha256: SAFETY_TEXT_SHA256,
    });
    await run(core, "start", { minutes: 60 });
    await run(core, "lid_closed.start", {});

    const refused = await check(core);
    expect(refused.status).toBe(200);
    expect(refused.json).toMatchObject({
      available: true,
      can_quit: false,
      count: 1,
      pending: [{ kind: "pmset.disablesleep" }],
    });
    // Kinds and times only: no journal id and no undo data leave Core.
    expect(Object.keys(refused.json.pending[0]).sort()).toEqual(["at", "kind"]);
    expect(fs.read(JOURNAL)).toBeDefined();

    await run(core, "recovery.undo_now", {});
    expect((await check(core)).json).toMatchObject({ can_quit: true, count: 0, pending: [] });
  });

  it("asking never removes or undoes a journal entry", async () => {
    const { core, fs, system } = await boot();
    await core.api("POST", "/api/capabilities/awake/enable", {});
    await run(core, "safety.acknowledge", {
      acknowledge: true,
      version: 1,
      text_sha256: SAFETY_TEXT_SHA256,
    });
    await run(core, "start", { minutes: 60 });
    await run(core, "lid_closed.start", {});
    const journal = fs.read(JOURNAL);
    const sudoRuns = () => system.runs.filter((r) => r.file === "/usr/bin/sudo").length;
    const before = sudoRuns();
    for (let i = 0; i < 3; i++) expect((await check(core)).json.can_quit).toBe(false);
    expect(fs.read(JOURNAL)).toBe(journal);
    expect(sudoRuns()).toBe(before);
  });

  it("still refuses after the capability is disabled when its undo failed (the veto is not cleared on stop)", async () => {
    const { core, state } = await boot();
    await core.api("POST", "/api/capabilities/awake/enable", {});
    await run(core, "safety.acknowledge", {
      acknowledge: true,
      version: 1,
      text_sha256: SAFETY_TEXT_SHA256,
    });
    await run(core, "start", { minutes: 60 });
    await run(core, "lid_closed.start", {});
    // The sudo rule goes away: the undo that disabling starts cannot work.
    state.sudoRefuses = true;
    expect((await core.api("POST", "/api/capabilities/awake/disable", {})).status).toBe(200);
    const res = await check(core);
    expect(res.json).toMatchObject({ available: true, can_quit: false, count: 1 });
  });

  it("rejects a query parameter without reading anything", async () => {
    const { core } = await boot();
    const res = await core.api("GET", `${PATH}?x=1`);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INVALID_REQUEST");
  });
});

describe("QuitCheckService", () => {
  const pending = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `chg_${i}`, kind: `lid.k${i}`, at: 1_000 + i }));

  it("is unavailable before it is bound and when the check throws", () => {
    const svc = new QuitCheckService();
    const none = { available: false, can_quit: true, count: 0, pending: [] };
    expect(svc.status()).toEqual(none);
    svc.bind(() => {
      throw new Error("boom");
    });
    expect(svc.status()).toEqual(none);
    svc.bind(undefined);
    expect(svc.status()).toEqual(none);
  });

  it("passes the veto through, bounds the list and keeps the true count", () => {
    const svc = new QuitCheckService();
    svc.bind(() => ({ ok: false, pending: pending(QUIT_CHECK_LIST_LIMIT + 5) }));
    const view = svc.status();
    expect(view.can_quit).toBe(false);
    expect(view.count).toBe(QUIT_CHECK_LIST_LIMIT + 5);
    expect(view.pending).toHaveLength(QUIT_CHECK_LIST_LIMIT);
    expect(view.pending[0]).toEqual({ kind: "lid.k0", at: 1_000 });
    svc.bind(() => ({ ok: true, pending: [] }));
    expect(svc.status()).toEqual({ available: true, can_quit: true, count: 0, pending: [] });
  });
});
