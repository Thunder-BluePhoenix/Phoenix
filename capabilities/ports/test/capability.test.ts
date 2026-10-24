// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The capability through the real manager and permission gateway (in memory) with a pretend
// machine: stopping always asks, a declined stop signals nothing, force stop is a separate
// confirmation, signals are audited, and polling is off unless asked for and paused while nobody
// watches. Simulated: no real socket or process is touched.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPortsCapability } from "../src";
import { FakeMachine, HOME, proc, type FakeProc } from "../testing/fakes";

const NODE = `${HOME}/.nvm/versions/node/v22/bin/node`;

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

interface Rig {
  m: FakeMachine;
  p: FakeProc;
  waits: PromiseWithResolvers<void>[];
  input(patch?: Record<string, unknown>): Record<string, unknown>;
}

async function ready(
  opts: { config?: Record<string, unknown>; proc?: Partial<FakeProc>; clients?: number } = {},
): Promise<Rig> {
  const m = new FakeMachine();
  const p = m.add(proc({ pid: 4242, command: NODE, ageSeconds: 3600, ...opts.proc }), {
    port: 3000,
  });
  const waits: PromiseWithResolvers<void>[] = [];
  const env = m.env({
    sleep: (ms, signal) => {
      m.sleeps.push(ms);
      // A stop's wait advances the fake clock at once; the background poll waits for the test.
      if (ms <= 1000) return Promise.resolve();
      const wait = Promise.withResolvers<void>();
      waits.push(wait);
      signal.addEventListener("abort", () => wait.resolve(), { once: true });
      return wait.promise;
    },
  });
  h = createHarness({ modules: [createPortsCapability({ env })] });
  h.manager.presence.setClients(opts.clients ?? 1);
  if (opts.config) h.manager.configure("ports", opts.config);
  await h.enable("ports");
  return {
    m,
    p,
    waits,
    input: (patch = {}) => ({
      pid: p.pid,
      port: 3000,
      start: m.startOf(p),
      command: p.command,
      uid: p.uid,
      ...patch,
    }),
  };
}

const audits = () =>
  h!.db
    .prepare("SELECT action, decision, details FROM audit_log WHERE capability_id = 'ports'")
    .all() as {
    action: string;
    decision: string;
    details: string;
  }[];

describe("manifest", () => {
  it("lists read-only; stop_process, force_stop and restart_process are separate execute commands", async () => {
    await ready();
    const view = h!.manager.get("ports");
    expect(view.commands).toEqual([
      expect.objectContaining({ name: "list", side_effect: "read" }),
      expect.objectContaining({ name: "stop_process", side_effect: "execute" }),
      expect.objectContaining({ name: "force_stop", side_effect: "execute" }),
      expect.objectContaining({ name: "restart_process", side_effect: "execute" }),
    ]);
  });
});

describe("restart_process through the permission gateway", () => {
  const EXE = `${HOME}/bin/serve`;
  const ROOT = `${HOME}/code`;
  const CWD = `${ROOT}/app`;
  const ARGV = JSON.stringify([EXE, "--port", "3000"]);
  const config = {
    restart_roots: [ROOT],
    restart_recipes: { app: { argv: [EXE, "--port", "3000"], cwd: CWD, ports: [3000] } },
  };
  const withRecipe = async () => {
    const r = await ready({ config });
    r.m.files.set(EXE, { real: EXE, kind: "file", mode: 0o755 });
    for (const dir of [`${HOME}/bin`, ROOT, CWD]) {
      r.m.files.set(dir, { real: dir, kind: "directory", mode: 0o755 });
    }
    return {
      ...r,
      restart: (patch = {}) => ({ ...r.input(), recipe: "app", argv: ARGV, cwd: CWD, ...patch }),
    };
  };

  it("the list offers the recipe only for the declared port", async () => {
    const r = await withRecipe();
    const op = await h!.run("ports", "list");
    expect(op.result).toMatchObject({
      ports: [{ port: 3000, restart: { recipe: "app", argv: ARGV, cwd: CWD } }],
    });
    expect(r.m.signals).toEqual([]);
  });

  it("the confirmation shows the recipe name, the exact argv and the folder", async () => {
    const r = await withRecipe();
    const op = h!.manager.invoke("ports", "restart_process", r.restart());
    await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
    const pending = h!.permissions.pendingConfirmations()[0]!;
    const shown = JSON.stringify(pending);
    expect(shown).toContain("app");
    expect(shown).toContain(JSON.stringify(ARGV).slice(1, -1));
    expect(shown).toContain(CWD);
    expect(shown).toContain("4242");
    expect(r.m.signals).toEqual([]);
    h!.permissions.resolveConfirmation(pending.id, false);
    await vi.waitFor(() => expect(op.status).toBe("failed"));
    expect(r.m.signals).toEqual([]);
    expect(r.m.spawns).toEqual([]);
  });

  it("an approved restart stops, starts the recipe, emits an event without argv or folder, and is audited", async () => {
    const r = await withRecipe();
    const op = await h!.run("ports", "restart_process", r.restart());
    expect(op.status).toBe("succeeded");
    expect(op.result).toMatchObject({ started: true, exited: true, recipe: "app" });
    expect(r.m.spawns).toHaveLength(1);
    const event = h!.events.find((e) => e.event_type === "ports.process.restarted");
    expect(event?.payload).toMatchObject({ pid: 4242, port: 3000, recipe: "app", started: true });
    const text = JSON.stringify(h!.events.filter((e) => e.source === "ports"));
    expect(text).not.toContain(HOME);
    expect(audits().map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "confirmation.requested",
        "confirmation.approved",
        "action.succeeded",
      ]),
    );
  });

  it("a recipe edited in the config after the list was read is refused as changed", async () => {
    const r = await withRecipe();
    h!.manager.configure("ports", {
      ...config,
      restart_recipes: { app: { argv: [EXE, "--evil"], cwd: CWD, ports: [3000] } },
    });
    await h!.manager.disable("ports");
    await h!.enable("ports");
    const op = await h!.run("ports", "restart_process", r.restart());
    expect(op.status).toBe("failed");
    expect(r.m.signals).toEqual([]);
    expect(r.m.spawns).toEqual([]);
  });

  it("a hostile recipe in the config is dropped: nothing is offered and a restart is refused", async () => {
    const r = await ready({
      config: {
        restart_roots: [ROOT],
        restart_recipes: { app: { argv: ["/bin/sh", "-c", "evil"], cwd: CWD, ports: [3000] } },
      },
    });
    const listed = await h!.run("ports", "list");
    expect(listed.result).toMatchObject({ ports: [{ restart: null }] });
    const op = await h!.run("ports", "restart_process", {
      ...r.input(),
      recipe: "app",
      argv: JSON.stringify(["/bin/sh", "-c", "evil"]),
      cwd: CWD,
    });
    expect(op.status).toBe("failed");
    expect(r.m.signals).toEqual([]);
    expect(r.m.spawns).toEqual([]);
  });

  it("the config schema refuses an unknown recipe field and a shell-looking field set", async () => {
    await ready();
    expect(() =>
      h!.manager.configure("ports", {
        restart_roots: [ROOT],
        restart_recipes: { app: { argv: [EXE], cwd: CWD, ports: [3000], env: { A: "b" } } },
      }),
    ).toThrow();
    expect(() =>
      h!.manager.configure("ports", {
        restart_roots: [ROOT],
        restart_recipes: { app: { argv: [EXE], cwd: CWD, ports: [80] } },
      }),
    ).toThrow();
  });

  it("a restart that stops the program and cannot start the recipe is a failed operation that says so", async () => {
    const r = await withRecipe();
    r.m.spawnFails = "spawn_failed";
    const op = await h!.run("ports", "restart_process", r.restart());
    expect(op.status).toBe("failed");
    expect(JSON.stringify(op)).toContain("was stopped");
    expect(r.m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    const event = h!.events.find((e) => e.event_type === "ports.process.restarted");
    expect(event?.payload).toMatchObject({ spawn_failed: true, started: false });
  });
});

describe("list", () => {
  it("returns the snapshot through the command path", async () => {
    await ready();
    const op = await h!.run("ports", "list");
    expect(op.status).toBe("succeeded");
    expect(op.result).toMatchObject({
      platform: "darwin",
      collector: "lsof",
      ports: [expect.objectContaining({ port: 3000 })],
    });
  });
});

describe("stop_process through the permission gateway", () => {
  it("declining the confirmation signals nothing", async () => {
    const r = await ready();
    const op = await h!.run("ports", "stop_process", r.input(), false);
    expect(op.status).toBe("failed");
    expect(r.m.signals).toEqual([]);
    expect(r.m.procs.some((x) => x.pid === 4242)).toBe(true);
  });

  it("the confirmation prompt names the process and the port", async () => {
    const r = await ready();
    const op = h!.manager.invoke("ports", "stop_process", r.input());
    await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
    const pending = h!.permissions.pendingConfirmations()[0]!;
    const shown = JSON.stringify(pending);
    expect(shown).toContain("4242");
    expect(shown).toContain("3000");
    expect(shown).toContain(NODE);
    h!.permissions.resolveConfirmation(pending.id, false);
    await vi.waitFor(() => expect(op.status).toBe("failed"));
  });

  it("an approved stop sends SIGTERM only and is audited with the outcome", async () => {
    const r = await ready();
    const op = await h!.run("ports", "stop_process", r.input());
    expect(op.status).toBe("succeeded");
    expect(r.m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(h!.types("ports")).toContain("ports.process.signalled");
    expect(audits().map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "confirmation.requested",
        "confirmation.approved",
        "action.succeeded",
      ]),
    );
    // The ports.* event says what was signalled (pid, port, file name), never the executable path (the approval prompt does name it, on purpose).
    const signalled = h!.events.find((e) => e.event_type === "ports.process.signalled");
    expect(signalled?.payload).toMatchObject({
      pid: 4242,
      port: 3000,
      name: "node",
      signal: "SIGTERM",
    });
    expect(JSON.stringify(h!.events.filter((e) => e.source === "ports"))).not.toContain(HOME);
  });

  it("a refusal (Core's own process) is a failed operation and no signal", async () => {
    const r = await ready();
    const core = r.m.get(4000);
    r.m.listeners.push({ pid: 4000, port: 4870, address: "127.0.0.1" });
    const op = await h!.run("ports", "stop_process", {
      pid: 4000,
      port: 4870,
      start: r.m.startOf(core),
      command: core.command,
      uid: core.uid,
    });
    expect(op.status).toBe("failed");
    expect(r.m.signals).toEqual([]);
  });

  it("force_stop is its own confirmation: approving stop_process does not approve the kill", async () => {
    const r = await ready({ proc: { ignoresTerm: true } });
    expect((await h!.run("ports", "stop_process", r.input())).status).toBe("succeeded");
    r.m.now += 6_000;
    expect((await h!.run("ports", "force_stop", r.input(), false)).status).toBe("failed");
    expect(r.m.signals.map((s) => s.signal)).toEqual(["SIGTERM"]);
    expect((await h!.run("ports", "force_stop", r.input())).status).toBe("succeeded");
    expect(r.m.signals.map((s) => s.signal)).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("polling", () => {
  it("is off by default: nothing is read until the user asks", async () => {
    const r = await ready();
    await yieldToLoop();
    await yieldToLoop();
    expect(r.m.runs).toEqual([]);
    expect(r.waits).toEqual([]);
  });

  it("when turned on it reads only while Phoenix is watched and announces a change once", async () => {
    const r = await ready({ config: { watch: true, poll_ms: 5000 }, clients: 0 });
    await yieldToLoop();
    expect(r.m.runs).toEqual([]);
    h!.manager.presence.setClients(1);
    await vi.waitFor(() => expect(r.waits).toHaveLength(1));
    const reads = r.m.runs.length;
    expect(reads).toBeGreaterThan(0);
    expect(r.m.sleeps).toContain(5000);
    // No change: the next cycle publishes nothing new.
    h!.manager.presence.setClients(0);
    r.waits[0]!.resolve();
    await yieldToLoop();
    await yieldToLoop();
    expect(r.m.runs.length).toBe(reads);
    h!.manager.presence.setClients(1);
    await vi.waitFor(() => expect(r.m.runs.length).toBeGreaterThan(reads));
  });
});
