// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Process lifecycle against the fake agent: start, send, stop, hang, ignore SIGTERM, exit codes,
// bounds, prompt handling and what survives when the parent is killed.
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROMPT_CHARS,
  type SessionManager,
  type SessionManagerOptions,
  type SessionView,
} from "../src/sessions";
import { cleanTempDirs, fakeLauncher, isAlive, managerFor, workspaceIn } from "./rig";

const PARENT = join(import.meta.dirname, "../testing/orphan-parent.ts");
const FAKE = join(import.meta.dirname, "../testing/fake-agent.cjs");

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  cleanTempDirs();
});

function setup(over: Partial<SessionManagerOptions> = {}) {
  const rig = managerFor(over);
  cleanups.push(async () => {
    await rig.manager.stopAll("shutdown");
    rig.manager.clear();
  });
  return { ...rig, ...workspaceIn() };
}

const finished = (v: SessionView) => v.state !== "running" && v.state !== "waiting";
const waitFor = (m: SessionManager, id: string, state: string) =>
  vi.waitFor(() => expect(m.get(id)?.state).toBe(state));
const outputOf = (m: SessionManager, id: string) => m.output(id, 500).stdout.join("\n");

describe("session lifecycle", () => {
  it("runs the agent in the workspace, gives it the prompt on stdin and records a clean exit", async () => {
    const { manager, root, workspace, changes } = setup();
    const view = manager.start("fake", fakeLauncher(root), workspace, "FAKE:echo\nrename the widget");
    expect(view).toMatchObject({ state: "running", repository: "project", workspace });
    await waitFor(manager, view.id, "completed");
    expect(outputOf(manager, view.id)).toContain("Working on: rename the widget");
    expect(manager.get(view.id)).toMatchObject({ exit_code: 0, accepts_input: false });
    expect(changes.map((c) => c.change)).toEqual(["started", "working", "completed"]);
    expect(manager.history(view.id).map((h) => h.kind)).toEqual(["started", "completed"]);
  });

  it("never puts the prompt or the workspace-derived text into argv (the fake agent exits 9 if it sees it)", async () => {
    const { manager, root, workspace } = setup();
    const secretPrompt = "FAKE:echo\nSECRET-TASK-TEXT-123456";
    const view = manager.start("fake", fakeLauncher(root), workspace, secretPrompt);
    await waitFor(manager, view.id, "completed");
    const out = outputOf(manager, view.id);
    expect(out).toMatch(/argv=\["?[^"]*"?\]/);
    expect(out).not.toContain("SECRET-TASK-TEXT-123456\"");
    const argvLine = out.split("\n").find((l) => l.startsWith("fake-agent pid="))!;
    expect(argvLine).toContain("argv=[]");
    expect(manager.get(view.id)?.exit_code).toBe(0);
  });

  it("passes only the fixed arguments from the launcher", async () => {
    const { manager, root, workspace } = setup();
    const view = manager.start(
      "fake",
      fakeLauncher(root, { command: [process.execPath, FAKE, "--fixed", "a b;$(x)"] }),
      workspace,
      "FAKE:echo\nhello",
    );
    await waitFor(manager, view.id, "completed");
    expect(outputOf(manager, view.id)).toContain('argv=["--fixed","a b;$(x)"]');
  });

  it("sees a blocked agent as waiting, and a message on stdin resumes it", async () => {
    const { manager, root, workspace, changes } = setup();
    const view = manager.start("fake", fakeLauncher(root), workspace, "FAKE:ask\nedit it");
    await waitFor(manager, view.id, "waiting");
    expect(changes.map((c) => c.change)).toContain("waiting");
    const sent = manager.send(view.id, "yes");
    expect(sent).toMatchObject({ state: "running", messages_sent: 1 });
    await waitFor(manager, view.id, "completed");
    expect(outputOf(manager, view.id)).toContain("Got your answer: yes");
    expect(manager.history(view.id).map((h) => h.kind)).toEqual([
      "started",
      "waiting",
      "message_sent",
      "resumed",
      "completed",
    ]);
    // History holds counts, never the message.
    expect(JSON.stringify(manager.history(view.id))).not.toContain("yes");
  });

  it("reports a failing agent with its exit code and keeps stderr separate", async () => {
    const { manager, root, workspace, changes } = setup();
    const view = manager.start("fake", fakeLauncher(root), workspace, "FAKE:fail\nx");
    await waitFor(manager, view.id, "failed");
    expect(manager.get(view.id)).toMatchObject({ exit_code: 3, failure: "exited with code 3" });
    expect(manager.output(view.id, 10).stderr.join("\n")).toContain("model refused");
    expect(changes.at(-1)?.change).toBe("failed");
  });

  it("stops a hanging agent with SIGTERM", async () => {
    const { manager, root, workspace } = setup();
    const view = manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\nx");
    await vi.waitFor(() => expect(outputOf(manager, view.id)).toContain("Still thinking"));
    const stopped = await manager.stop(view.id);
    expect(stopped).toMatchObject({ state: "stopped", stop_reason: "user" });
    expect(finished(stopped)).toBe(true);
  });

  it("kills the whole tree, including a helper that ignores SIGTERM, after the grace period", async () => {
    const { manager, root, workspace } = setup({ graceMs: 100 });
    const view = manager.start("fake", fakeLauncher(root), workspace, "FAKE:stubborn\nx");
    await vi.waitFor(() => expect(outputOf(manager, view.id)).toMatch(/helper pid=\d+/));
    const out = outputOf(manager, view.id);
    const agentPid = Number(/fake-agent pid=(\d+)/.exec(out)![1]);
    const helperPid = Number(/helper pid=(\d+)/.exec(out)![1]);
    expect(isAlive(agentPid) && isAlive(helperPid)).toBe(true);
    await manager.stop(view.id);
    await vi.waitFor(() => expect(isAlive(agentPid) || isAlive(helperPid)).toBe(false));
    expect(manager.get(view.id)?.state).toBe("stopped");
  });

  it("ends a session that outlives the maximum runtime and marks it failed, not stopped by the user", async () => {
    const { manager, root, workspace, scheduler } = setup({ maxRuntimeMs: 7_000_000 });
    const view = manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\nx");
    await vi.waitFor(() => expect(outputOf(manager, view.id)).toContain("Still thinking"));
    scheduler.fire(7_000_000);
    await waitFor(manager, view.id, "failed");
    expect(manager.get(view.id)).toMatchObject({
      stop_reason: "max_runtime",
      failure: expect.stringContaining("maximum runtime"),
    });
  });

  it("refuses to start more than maxSessions at once and recovers when one ends", async () => {
    const { manager, root, workspace } = setup({ maxSessions: 2 });
    const a = manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\n1");
    manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\n2");
    expect(() => manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\n3")).toThrow(
      /2 sessions are already running/,
    );
    await manager.stop(a.id);
    expect(() => manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\n4")).not.toThrow();
  });

  it("refuses send to a finished session, to an unknown one and over a closed input channel", async () => {
    const { manager, root, workspace } = setup();
    const done = manager.start("fake", fakeLauncher(root), workspace, "FAKE:echo\nx");
    await waitFor(manager, done.id, "completed");
    expect(() => manager.send(done.id, "late")).toThrow(/completed/);
    expect(() => manager.send("ph-nope", "x")).toThrow(/Unknown session/);
    const closed = manager.start(
      "fake",
      fakeLauncher(root, { stdin: "close_after_prompt" }),
      workspace,
      "FAKE:hang\nx",
    );
    expect(closed.accepts_input).toBe(false);
    expect(() => manager.send(closed.id, "hi")).toThrow(/cannot receive messages/);
  });

  it("rejects prompts and messages that are empty, too long or contain control characters", () => {
    const { manager, root, workspace } = setup();
    const launcher = fakeLauncher(root);
    expect(() => manager.start("fake", launcher, workspace, "")).toThrow(/1 to/);
    expect(() =>
      manager.start("fake", launcher, workspace, "x".repeat(MAX_PROMPT_CHARS + 1)),
    ).toThrow(/1 to/);
    expect(() => manager.start("fake", launcher, workspace, "ok\u001b[2J")).toThrow(/control/);
    expect(manager.list()).toEqual([]);
  });

  it("refuses a workspace outside the launcher's roots, including through a symlink", () => {
    const { manager, root, workspace } = setup();
    const other = workspaceIn();
    const link = join(root, "link");
    symlinkSync(other.workspace, link);
    const launcher = fakeLauncher(root);
    expect(() => manager.start("fake", launcher, other.workspace, "x")).toThrow(/outside/);
    expect(() => manager.start("fake", launcher, link, "x")).toThrow(/outside/);
    expect(() => manager.start("fake", launcher, `${workspace}/../project`, "x")).toThrow(
      /normalised/,
    );
    expect(manager.list()).toEqual([]);
  });

  it("keeps the environment to an allow-list: Phoenix's own variables never reach the agent", async () => {
    const script = join(workspaceIn().root, "env.cjs");
    writeFileSync(script, "console.log(JSON.stringify(Object.keys(process.env).sort()))\n");
    const { manager, root, workspace } = setup({
      env: { PATH: process.env.PATH, HOME: "/h", PHOENIX_TOKEN: "t", OTHER: "o", KEEP: "k" },
    });
    const view = manager.start(
      "fake",
      fakeLauncher(root, { command: [process.execPath, script], env_allow: ["KEEP"] }),
      workspace,
      "x",
    );
    await waitFor(manager, view.id, "completed");
    const keys = JSON.parse(outputOf(manager, view.id)) as string[];
    expect(keys).toEqual(expect.arrayContaining(["PATH", "HOME", "KEEP", "TERM"]));
    expect(keys).not.toContain("PHOENIX_TOKEN");
    expect(keys).not.toContain("OTHER");
  });

  it("starts the executable behind a symlink by its real path and refuses a world-writable one", () => {
    const { manager, root, workspace } = setup();
    const writable = join(root, "agent.sh.cjs");
    writeFileSync(writable, "process.exit(0)\n");
    chmodSync(writable, 0o777);
    expect(() =>
      manager.start("fake", fakeLauncher(root, { command: [writable] }), workspace, "x"),
    ).toThrow(/writable by everyone/);
    chmodSync(writable, 0o644);
    expect(() =>
      manager.start("fake", fakeLauncher(root, { command: [writable] }), workspace, "x"),
    ).toThrow(/not an executable/);
    expect(() =>
      manager.start("fake", fakeLauncher(root, { command: [join(root, "missing")] }), workspace, "x"),
    ).toThrow(/does not exist/);
  });
});

describe("kill switch", () => {
  it("refuses new sessions and messages while engaged, and stopAll ends the running ones", async () => {
    let engaged = false;
    const { manager, root, workspace } = setup({ isKillSwitchEngaged: () => engaged });
    const a = manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\n1");
    const b = manager.start("fake", fakeLauncher(root), workspace, "FAKE:ask\n2");
    engaged = true;
    expect(() => manager.start("fake", fakeLauncher(root), workspace, "FAKE:hang\n3")).toThrow(
      /Emergency stop/,
    );
    expect(() => manager.send(b.id, "go")).toThrow(/Emergency stop/);
    expect(await manager.stopAll("kill_switch")).toBe(2);
    expect(manager.get(a.id)).toMatchObject({ state: "stopped", stop_reason: "kill_switch" });
    expect(manager.get(b.id)?.state).toBe("stopped");
    expect(manager.active()).toEqual([]);
  });
});

describe("no orphan survives Core", () => {
  const children: ChildProcess[] = [];
  const pids: number[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill("SIGKILL");
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  async function parentWith(mode: string) {
    const { workspace } = workspaceIn();
    // `node --import tsx`, not the tsx binary: the binary forks a child, so killing it would not kill the parent.
    const parent = spawn(process.execPath, ["--import", "tsx", PARENT, FAKE, workspace, mode], {
      cwd: join(import.meta.dirname, "../../.."),
      stdio: ["ignore", "pipe", "ignore"],
    });
    children.push(parent);
    parent.on("error", () => {});
    const found = Promise.withResolvers<{ agent: number; helper: number }>();
    let buf = "";
    parent.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      if (buf.includes("\n")) found.resolve(JSON.parse(buf.split("\n")[0]!));
    });
    const exited = new Promise<void>((resolve) => parent.on("close", () => resolve()));
    const pidsSeen = await found.promise;
    pids.push(pidsSeen.agent, ...(pidsSeen.helper ? [pidsSeen.helper] : []));
    return { parent, exited, ...pidsSeen };
  }

  it("kill -9 of the parent stops the agent", async () => {
    const { parent, exited, agent } = await parentWith("hang");
    expect(isAlive(agent)).toBe(true);
    parent.kill("SIGKILL");
    await exited;
    await vi.waitFor(() => expect(isAlive(agent)).toBe(false), { timeout: 8000 });
  }, 20_000);

  it("kill -9 of the parent also kills a helper that ignores SIGTERM", async () => {
    const { parent, exited, agent, helper } = await parentWith("stubborn");
    expect(isAlive(agent) && isAlive(helper)).toBe(true);
    parent.kill("SIGKILL");
    await exited;
    await vi.waitFor(() => expect(isAlive(agent) || isAlive(helper)).toBe(false), {
      timeout: 8000,
    });
  }, 20_000);
});
