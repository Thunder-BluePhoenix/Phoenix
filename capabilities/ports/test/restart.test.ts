// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Restart recipes, with a pretend machine: no real process is signalled or started. The recipe is
// the owner's text and is matched to a process only by a declared port; a hostile config is not
// usable; a restart stops through the guarded stop path and says plainly when the start failed.
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/snapshot";
import { DEFAULT_THRESHOLDS } from "../src/policy";
import { parseRecipes, renderArgv, restartEnv, type RestartRecipe } from "../src/recipes";
import { createRestarter, type RestartResult, type RestartTarget } from "../src/restart";
import { createStopper } from "../src/stop";
import type { PathFacts, PortsEnv } from "../src/types";
import { FakeMachine, HOME, proc, type FakeProc } from "../testing/fakes";

const EXE = `${HOME}/bin/serve`;
const ROOT = `${HOME}/code`;
const CWD = `${ROOT}/app`;
const NODE = `${HOME}/.nvm/versions/node/v22/bin/node`;

const goodRecipe = (): Record<string, unknown> => ({
  argv: [EXE, "--port", "3000"],
  cwd: CWD,
  ports: [3000],
});
const goodConfig = (): Record<string, unknown> => ({
  restart_roots: [ROOT],
  restart_recipes: { app: goodRecipe() },
});

const file = (mode = 0o755, real?: string): PathFacts => ({
  real: real ?? "",
  kind: "file",
  mode,
});

function plant(m: FakeMachine): void {
  m.files.set(EXE, { ...file(), real: EXE });
  m.files.set(`${HOME}/bin`, { real: `${HOME}/bin`, kind: "directory", mode: 0o755 });
  m.files.set(ROOT, { real: ROOT, kind: "directory", mode: 0o755 });
  m.files.set(CWD, { real: CWD, kind: "directory", mode: 0o755 });
}

function setup(patch: Partial<FakeProc> = {}, env?: Partial<PortsEnv>) {
  const m = new FakeMachine();
  plant(m);
  const p = m.add(proc({ pid: 4242, command: NODE, ageSeconds: 3600, ...patch }), { port: 3000 });
  const e = m.env(env);
  const finished: { r: RestartResult; spawnFailed: boolean }[] = [];
  const stopper = createStopper(e, () => {});
  const restarter = createRestarter(e, stopper, (r, spawnFailed) =>
    finished.push({ r, spawnFailed }),
  );
  const config = parseRecipes(goodConfig());
  const signal = new AbortController().signal;
  const target = (over: Partial<RestartTarget> = {}): RestartTarget => ({
    pid: p.pid,
    port: 3000,
    start: m.startOf(p),
    command: p.command,
    uid: p.uid,
    recipe: "app",
    argv: renderArgv([EXE, "--port", "3000"]),
    cwd: CWD,
    ...over,
  });
  const run = (over: Partial<RestartTarget> = {}) =>
    restarter.restart(target(over), config.recipes, config.roots, signal);
  return { m, p, e, run, config, finished };
}

describe("recipes in the config: a hostile or mistyped recipe is not usable", () => {
  it("accepts a well-formed recipe and keeps exactly the owner's text", () => {
    const parsed = parseRecipes(goodConfig());
    expect(parsed.problems).toEqual([]);
    expect(parsed.recipes.app).toEqual({
      argv: [EXE, "--port", "3000"],
      cwd: CWD,
      ports: [3000],
    });
  });

  const bad = (label: string, recipe: Record<string, unknown>, problem: RegExp) =>
    it(`refuses ${label}`, () => {
      const parsed = parseRecipes({ restart_roots: [ROOT], restart_recipes: { app: recipe } });
      expect(Object.keys(parsed.recipes)).toEqual([]);
      expect(parsed.problems.join("\n")).toMatch(problem);
    });
  bad("a shell as the program", { ...goodRecipe(), argv: ["/bin/sh", "-c", "node x.js"] }, /shell/);
  bad("a relative program", { ...goodRecipe(), argv: ["serve"] }, /absolute/);
  bad("a program path with ..", { ...goodRecipe(), argv: [`${HOME}/bin/../x`] }, /normalised/);
  bad("a newline in an argument", { ...goodRecipe(), argv: [EXE, "a\nb"] }, /control/);
  bad("a bidi override in an argument", { ...goodRecipe(), argv: [EXE, "a\u202Eb"] }, /control/);
  bad("an empty argv", { ...goodRecipe(), argv: [] }, /argv/);
  bad(
    "an argv too long to show in the prompt",
    { ...goodRecipe(), argv: [EXE, "x".repeat(80)] },
    /too long|characters/,
  );
  bad("a folder outside the roots", { ...goodRecipe(), cwd: `${HOME}/other` }, /not inside/);
  bad("a folder with ..", { ...goodRecipe(), cwd: `${ROOT}/../etc` }, /normalised/);
  bad("a wildcard folder", { ...goodRecipe(), cwd: `${ROOT}/*` }, /wildcard/);
  bad("a privileged port", { ...goodRecipe(), ports: [22] }, /ports/);
  bad("no port", { ...goodRecipe(), ports: [] }, /ports/);
  bad(
    "an unknown field (env, shell, stdin)",
    { ...goodRecipe(), env: { X: "1" } },
    /unknown field "env"/,
  );

  it("refuses everything without roots, the filesystem root as a root, and relative roots", () => {
    expect(parseRecipes({ restart_recipes: { app: goodRecipe() } }).recipes).toEqual({});
    for (const roots of [["/"], ["code"], [`${ROOT}/`]]) {
      const parsed = parseRecipes({ restart_roots: roots, restart_recipes: { app: goodRecipe() } });
      expect(Object.keys(parsed.recipes), JSON.stringify(roots)).toEqual([]);
      expect(parsed.problems.length).toBeGreaterThan(0);
    }
  });

  it("two recipes cannot claim one port, and a bad name or __proto__ adds nothing", () => {
    const parsed = parseRecipes({
      restart_roots: [ROOT],
      restart_recipes: { a: goodRecipe(), b: goodRecipe(), "a b": goodRecipe() },
    });
    expect(Object.keys(parsed.recipes)).toEqual(["a"]);
    expect(parsed.problems.join("\n")).toMatch(/already belongs/);
    const proto = parseRecipes({
      restart_roots: [ROOT],
      restart_recipes: JSON.parse(
        '{"__proto__": {"argv": ["/bin/x"], "cwd": "/a", "ports": [3000]}}',
      ),
    });
    expect(Object.keys(proto.recipes)).toEqual([]);
    expect(({} as Record<string, unknown>).argv).toBeUndefined();
  });

  it("only the base environment names reach the new process, never tokens", () => {
    const env = restartEnv({ PATH: "/bin", HOME: "/h", SECRET_TOKEN: "x", PHOENIX_API_TOKEN: "y" });
    expect(env).toEqual({ TERM: "dumb", NO_COLOR: "1", PATH: "/bin", HOME: "/h" });
  });
});

describe("recipe matching by declared port", () => {
  const snapshot = (m: FakeMachine) =>
    buildSnapshot(m.env(), DEFAULT_THRESHOLDS, parseRecipes(goodConfig()).recipes);

  it("a stoppable process on a declared port is offered the owner's recipe, exactly as it will be shown", async () => {
    const { m } = setup();
    const s = await snapshot(m);
    expect(s.ports.find((p) => p.port === 3000)?.restart).toEqual({
      recipe: "app",
      argv: renderArgv([EXE, "--port", "3000"]),
      cwd: CWD,
    });
  });

  it("no offer on another port, with no recipes, or when the process may not be stopped", async () => {
    const { m } = setup();
    m.add(proc({ pid: 4243, command: NODE }), { port: 3001 });
    m.add(proc({ pid: 4244, command: `${HOME}/bin/ollama` }), { port: 3002 });
    const recipes = parseRecipes({
      restart_roots: [ROOT],
      restart_recipes: {
        app: goodRecipe(),
        third: { argv: [EXE], cwd: CWD, ports: [3002] },
      },
    }).recipes;
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS, recipes);
    const by = new Map(s.ports.map((p) => [p.port, p]));
    expect(by.get(3000)?.restart?.recipe).toBe("app");
    expect(by.get(3001)?.restart).toBeNull();
    expect(by.get(3002)).toMatchObject({ stoppable: false, restart: null });
    const none = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(none.ports.every((p) => p.restart === null)).toBe(true);
  });

  it("the process's own command line plays no part: a hostile name on the port still gets only the owner's recipe", async () => {
    const m = new FakeMachine();
    plant(m);
    m.add(proc({ pid: 4250, command: `${HOME}/bin/node --evil` }), { port: 3000 });
    const s = await snapshot(m);
    expect(JSON.stringify(s.ports.find((p) => p.port === 3000)?.restart)).not.toContain("evil");
  });
});

describe("restart_process", () => {
  it("stops through the guarded path, then starts exactly the owner's argv in the owner's folder with a minimal environment", async () => {
    const { m, run, finished } = setup();
    const result = await run();
    expect(m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(m.spawns).toEqual([
      {
        file: EXE,
        args: ["--port", "3000"],
        cwd: CWD,
        env: { TERM: "dumb", NO_COLOR: "1", PATH: "/usr/bin:/bin", HOME: HOME, USER: "ada" },
      },
    ]);
    expect(result).toMatchObject({ exited: true, started: true, new_pid: 9000, recipe: "app" });
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ spawnFailed: false });
    expect(JSON.stringify(m.spawns)).not.toContain("TOKEN");
  });

  it("starts the real path of a symlinked program, not the configured path", async () => {
    const { m, run } = setup();
    m.files.set(EXE, { ...file(), real: `${HOME}/bin/serve-v2` });
    m.files.set(`${HOME}/bin/serve-v2`, { ...file(), real: `${HOME}/bin/serve-v2` });
    await run();
    expect(m.spawns[0]?.file).toBe(`${HOME}/bin/serve-v2`);
  });

  it("a protected process is refused by the stop path: nothing signalled, nothing started", async () => {
    const { m, run } = setup({ command: `${HOME}/bin/ollama` });
    await expect(run({ command: `${HOME}/bin/ollama` })).rejects.toMatchObject({
      kind: "refused",
      refusal: "system",
    });
    expect(m.signals).toEqual([]);
    expect(m.spawns).toEqual([]);
  });

  it("Core itself is refused: nothing signalled, nothing started", async () => {
    const { m, e } = setup();
    const core = m.get(4000);
    m.listeners.push({ pid: 4000, port: 3000, address: "127.0.0.1" });
    const config = parseRecipes(goodConfig());
    const restarter = createRestarter(
      e,
      createStopper(e, () => {}),
      () => {},
    );
    await expect(
      restarter.restart(
        {
          pid: 4000,
          port: 3000,
          start: m.startOf(core),
          command: core.command,
          uid: core.uid,
          recipe: "app",
          argv: renderArgv([EXE, "--port", "3000"]),
          cwd: CWD,
        },
        config.recipes,
        config.roots,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "refused", refusal: "self" });
    expect(m.signals).toEqual([]);
    expect(m.spawns).toEqual([]);
  });

  it("a reused pid (another start time) is refused: nothing signalled, nothing started", async () => {
    const { m, run } = setup();
    await expect(run({ start: "Mon Jan  1 00:00:00 2024" })).rejects.toMatchObject({
      kind: "changed",
    });
    expect(m.signals).toEqual([]);
    expect(m.spawns).toEqual([]);
  });

  it("a different executable under the same pid and start is refused too", async () => {
    const { m, run } = setup();
    await expect(run({ command: `${HOME}/bin/other` })).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals).toEqual([]);
  });

  it("a recipe that cannot start stops nothing: a missing, writable or non-executable program, or a folder that escapes the roots", async () => {
    for (const [label, change] of [
      ["missing program", (m: FakeMachine) => m.files.delete(EXE)],
      [
        "world-writable program",
        (m: FakeMachine) => m.files.set(EXE, { ...file(0o777), real: EXE }),
      ],
      ["not executable", (m: FakeMachine) => m.files.set(EXE, { ...file(0o644), real: EXE })],
      [
        "program in a world-writable folder",
        (m: FakeMachine) =>
          m.files.set(`${HOME}/bin`, { real: `${HOME}/bin`, kind: "directory", mode: 0o777 }),
      ],
      [
        "folder that is a symlink out of the root",
        (m: FakeMachine) => m.files.set(CWD, { real: "/etc", kind: "directory", mode: 0o755 }),
      ],
      ["missing folder", (m: FakeMachine) => m.files.delete(CWD)],
    ] as const) {
      const { m, run } = setup();
      change(m);
      await expect(run(), label).rejects.toMatchObject({ kind: "refused" });
      expect(m.signals, label).toEqual([]);
      expect(m.spawns, label).toEqual([]);
    }
  });

  it("never as root, and not on Windows: nothing signalled", async () => {
    const root = setup({}, { uid: 0 });
    await expect(root.run()).rejects.toMatchObject({ kind: "refused" });
    expect(root.m.signals).toEqual([]);
    const win = setup({}, { uid: -1 });
    win.m.platform = "win32";
    await expect(win.run()).rejects.toMatchObject({ kind: "unsupported" });
    expect(win.m.signals).toEqual([]);
  });

  it("a recipe name that is unknown, a port it is not declared for, or text that differs from the config is refused", async () => {
    const { m, run } = setup();
    await expect(run({ recipe: "nope" })).rejects.toMatchObject({ kind: "refused" });
    const other = setup();
    other.m.listeners.push({ pid: 4242, port: 3001, address: "*" });
    await expect(other.run({ port: 3001 })).rejects.toMatchObject({ kind: "refused" });
    await expect(run({ argv: renderArgv(["/Users/ada/bin/serve"]) })).rejects.toMatchObject({
      kind: "changed",
    });
    await expect(run({ cwd: ROOT })).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals).toEqual([]);
    expect(m.spawns).toEqual([]);
    expect(other.m.signals).toEqual([]);
  });

  it("when the start fails after the stop, the error says the program WAS stopped and the failure is announced", async () => {
    const { m, run, finished } = setup();
    m.spawnFails = "spawn_failed";
    await expect(run()).rejects.toMatchObject({
      kind: "spawn_failed",
      message: expect.stringContaining("was stopped"),
    });
    expect(m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(m.procs.some((x) => x.pid === 4242)).toBe(false);
    expect(m.spawns).toEqual([]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ spawnFailed: true, r: { exited: true, started: false } });
  });

  it("the program changing between the stop and the start is caught: a start that is no longer safe is a spawn failure, said honestly", async () => {
    const { m, run } = setup();
    m.onSignal = () => m.files.set(EXE, { ...file(0o777), real: EXE });
    await expect(run()).rejects.toMatchObject({ kind: "spawn_failed" });
    expect(m.spawns).toEqual([]);
  });

  it("a program that ignores SIGTERM is not restarted (its port is still in use), and the answer offers force stop instead", async () => {
    const { m, run } = setup({ ignoresTerm: true });
    const result = await run();
    expect(result).toMatchObject({ exited: false, started: false, new_pid: null, can_force: true });
    expect(m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(m.spawns).toEqual([]);
  });

  it("there is no SIGKILL in a restart, whatever happens", async () => {
    const { m, run } = setup({ ignoresTerm: true });
    await run();
    expect(m.signals.map((s) => s.signal)).toEqual(["SIGTERM"]);
  });
});

describe("renderArgv", () => {
  it("shows spaces and quotes unambiguously", () => {
    const argv: RestartRecipe["argv"] = ["/a/b", "x y", 'q"t'];
    expect(renderArgv(argv)).toBe('["/a/b","x y","q\\"t"]');
  });
});
