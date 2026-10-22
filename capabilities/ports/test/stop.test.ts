// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The stop guards, each with a test that fails when the guard is removed. Every signal goes to a
// recording fake; no test signals a real process. Simulated: no real process is stopped here.
import { describe, expect, it } from "vitest";
import {
  FORCE_AFTER_MS,
  TERM_WAIT_MS,
  createStopper,
  parseTarget,
  type StopTarget,
} from "../src/stop";
import { stopRefusal } from "../src/policy";
import { readProcessTable } from "../src/collect";
import type { PortsEnv, StopRefusal } from "../src/types";
import {
  CORE_PGID,
  CORE_PID,
  CORE_PPID,
  FakeMachine,
  HOME,
  UID,
  proc,
  type FakeProc,
} from "../testing/fakes";

const NODE = `${HOME}/.nvm/versions/node/v22/bin/node`;

function setup(over: Partial<FakeProc> = {}) {
  const m = new FakeMachine();
  const p = m.add(proc({ pid: 4242, command: NODE, ...over }), { port: 3000 });
  const events: string[] = [];
  const env = m.env();
  const stopper = createStopper(env, (r) => events.push(`${r.signal}:${r.pid}:${r.exited}`));
  const target = (patch: Partial<StopTarget> = {}): StopTarget => ({
    pid: p.pid,
    port: 3000,
    start: m.startOf(p),
    command: p.command,
    uid: p.uid,
    ...patch,
  });
  const signal = new AbortController().signal;
  return { m, p, env, stopper, target, events, signal };
}

describe("identity proof before any signal", () => {
  it("SIGTERM goes only to the process the user saw", async () => {
    const { m, stopper, target, signal } = setup();
    const result = await stopper.stop(target(), signal);
    expect(m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(result).toMatchObject({
      pid: 4242,
      port: 3000,
      name: "node",
      signal: "SIGTERM",
      exited: true,
    });
  });

  it("a reused pid (same pid, another start time) is refused and not signalled", async () => {
    const { m, stopper, target, signal } = setup();
    await expect(
      stopper.stop(target({ start: "Mon Jan 1 00:00:00 2024" }), signal),
    ).rejects.toMatchObject({
      kind: "changed",
    });
    expect(m.signals).toEqual([]);
  });

  it("another command at the same pid and start time is refused", async () => {
    const { m, stopper, target, signal } = setup();
    await expect(
      stopper.stop(target({ command: `${HOME}/bin/other` }), signal),
    ).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals).toEqual([]);
  });

  it("another uid than the one shown is refused", async () => {
    const { m, stopper, target, signal } = setup();
    await expect(stopper.stop(target({ uid: UID + 1 }), signal)).rejects.toMatchObject({
      kind: "changed",
    });
    expect(m.signals).toEqual([]);
  });

  it("a process that no longer listens on the named port is refused", async () => {
    const { m, stopper, target, signal } = setup();
    await expect(stopper.stop(target({ port: 3001 }), signal)).rejects.toMatchObject({
      kind: "changed",
    });
    expect(m.signals).toEqual([]);
  });

  it("a process that already ended is reported, not signalled", async () => {
    const { m, stopper, target, signal } = setup();
    const t = target();
    m.remove(4242);
    await expect(stopper.stop(t, signal)).rejects.toMatchObject({ kind: "not_listed" });
    expect(m.signals).toEqual([]);
  });

  it("an unreadable process table signals nothing", async () => {
    const { m, stopper, target, signal } = setup();
    m.failCommands.add("/usr/bin/env");
    await expect(stopper.stop(target(), signal)).rejects.toMatchObject({ kind: "unavailable" });
    expect(m.signals).toEqual([]);
  });

  it("the identity is read LAST, with `ps -p <pid>`, after the listeners and right before the signal", async () => {
    const { m, stopper, target, signal } = setup();
    let runsAtSignal: string[] = [];
    m.onSignal = () => {
      runsAtSignal = m.runs.map((r) => (r.args.includes("-p") ? "ps-one" : r.file));
    };
    await stopper.stop(target(), signal);
    expect(runsAtSignal.at(-1)).toBe("ps-one");
    const lsof = runsAtSignal.indexOf("/usr/sbin/lsof");
    expect(lsof).toBeGreaterThanOrEqual(0);
    expect(lsof).toBeLessThan(runsAtSignal.lastIndexOf("ps-one"));
    expect(m.psOneCalls[0]).toBe(4242);
  });

  it("a `ps -p` answer of more than one line (a name with a line break) is not trusted: nothing is signalled", async () => {
    const { m, p, stopper, target, signal } = setup();
    const real = ` 4242  1  4242  501  0.1  50000  10:00 ${m.startOf(p)} ${p.command}`;
    m.rawPsOne = () =>
      `${real.replace(p.command, "x")}\n 4243  1  4243  501  0.1  50000  10:00 ${m.startOf(p)} ${p.command}`;
    await expect(stopper.stop(target(), signal)).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals).toEqual([]);
  });

  it("a `ps -p` row for another pid than asked is not trusted", async () => {
    const { m, p, stopper, target, signal } = setup();
    m.rawPsOne = () => ` 9999  1  9999  501  0.1  50000  10:00 ${m.startOf(p)} ${p.command}`;
    await expect(stopper.stop(target(), signal)).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals).toEqual([]);
  });

  it("a forged row in the whole-table output cannot make Core's own row or an ancestor disappear into a stoppable one", async () => {
    const { m, stopper, target, signal } = setup();
    // A process name smuggled a second row claiming Core's pid is an ordinary dev node: both
    // claims on that pid are dropped, Core's row is missing, so everything is refused ("unknown").
    const base = m.env();
    const table = (await base.run("/usr/bin/env", ["TZ=UTC", "LC_ALL=C", "/bin/ps"])).stdout;
    const forged = ` ${CORE_PID}  1  1  501  0.0  100  10:00 Mon Oct 19 09:56:56 2026 ${HOME}/bin/node`;
    m.rawPs = `${table}\n${forged}`;
    await expect(stopper.stop(target(), signal)).rejects.toMatchObject({
      kind: "refused",
      refusal: "unknown",
    });
    expect(m.signals).toEqual([]);
  });
});

describe("who may be stopped", () => {
  const refusal = (
    patch: Partial<FakeProc> & { pid: number; command: string },
    env?: Partial<PortsEnv>,
  ) => {
    const m = new FakeMachine();
    const p = m.add(proc(patch), { port: 3000 });
    return readProcessTable(m.env(env).run).then(({ rows }) =>
      stopRefusal(
        rows.find((r) => r.pid === p.pid)!,
        {
          platform: "darwin",
          uid: UID,
          pid: CORE_PID,
          ppid: CORE_PPID,
          home: HOME,
          table: new Map(rows.map((r) => [r.pid, r])),
        },
      ),
    );
  };

  it.each<[string, Partial<FakeProc> & { pid: number; command: string }, StopRefusal | undefined]>([
    [
      "a dev server under the home directory",
      { pid: 800, command: `${HOME}/code/app/server` },
      undefined,
    ],
    ["a Homebrew binary", { pid: 801, command: "/opt/homebrew/bin/redis-server" }, undefined],
    ["a /usr/local binary", { pid: 802, command: "/usr/local/bin/php" }, undefined],
    ["system python run by the same user", { pid: 803, command: "/usr/bin/python3" }, undefined],
    ["a node on Linux, name only", { pid: 804, command: "node" }, undefined],
    [
      "a system daemon run by the same user",
      { pid: 805, command: "/usr/libexec/rapportd" },
      "system",
    ],
    [
      "a /System app",
      { pid: 806, command: "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder" },
      "system",
    ],
    [
      "an app outside the dev roots",
      { pid: 807, command: "/Applications/Safari.app/Contents/MacOS/Safari" },
      "not_dev_tool",
    ],
    [
      "a /usr/bin tool that is not an interpreter",
      { pid: 808, command: "/usr/bin/ssh" },
      "not_dev_tool",
    ],
    [
      "a protected name even under the home directory",
      { pid: 809, command: `${HOME}/bin/sshd` },
      "system",
    ],
    [
      "a dot-dot path out of the home directory",
      { pid: 810, command: `${HOME}/../../bin/x` },
      "not_dev_tool",
    ],
    [
      "another user's dev server",
      { pid: 811, uid: 502, command: `${HOME}/code/server` },
      "other_user",
    ],
    ["root's process", { pid: 812, uid: 0, command: `${HOME}/code/server` }, "other_user"],
    ["ollama under the home directory", { pid: 813, command: `${HOME}/bin/ollama` }, "system"],
    ["colima", { pid: 814, command: "/opt/homebrew/bin/colima" }, "system"],
    ["limactl", { pid: 815, command: "/opt/homebrew/bin/limactl" }, "system"],
    ["dockerd", { pid: 816, command: "/usr/local/bin/dockerd" }, "system"],
    [
      "a Docker Desktop helper",
      { pid: 817, command: `${HOME}/Library/Containers/com.docker.backend` },
      "system",
    ],
    ["a phoenix helper", { pid: 818, command: `${HOME}/.phoenix/bin/Phoenix-helper` }, "system"],
    [
      "a process Core started (its descendant)",
      { pid: 819, ppid: CORE_PID, command: `${HOME}/code/child-server` },
      "self",
    ],
  ])("%s", async (_name, patch, expected) => {
    expect(await refusal(patch)).toBe(expected);
  });

  it("pid 1 and pid 0 are never stoppable", async () => {
    const m = new FakeMachine();
    const { rows } = await readProcessTable(m.env().run);
    const init = rows.find((r) => r.pid === 1)!;
    const ctx = {
      platform: "darwin" as const,
      uid: UID,
      pid: CORE_PID,
      ppid: CORE_PPID,
      home: HOME,
      table: new Map(rows.map((r) => [r.pid, r])),
    };
    expect(stopRefusal({ ...init, uid: UID, command: `${HOME}/x` }, ctx)).toBe("system");
    expect(stopRefusal({ ...init, pid: 0, uid: UID, command: `${HOME}/x` }, ctx)).toBe("system");
  });

  it("Core is never stoppable: not its pid, its parent, an ancestor, or a member of its process group", async () => {
    const m = new FakeMachine();
    m.add(proc({ pid: 3901, ppid: CORE_PPID, pgid: CORE_PGID, command: `${HOME}/bin/sibling` }), {
      port: 3101,
    });
    m.add(proc({ pid: 3800, ppid: 1, command: `${HOME}/bin/grand` }), { port: 3102 });
    m.get(CORE_PPID).ppid = 3800;
    m.listeners.push(
      { pid: CORE_PID, port: 4870, address: "127.0.0.1" },
      { pid: CORE_PPID, port: 4871, address: "*" },
    );
    const stopper = createStopper(m.env(), () => {});
    const signal = new AbortController().signal;
    for (const pid of [CORE_PID, CORE_PPID, 3800, 3901]) {
      const p = m.get(pid);
      const port = m.listeners.find((l) => l.pid === pid)!.port;
      await expect(
        stopper.stop({ pid, port, start: m.startOf(p), command: p.command, uid: p.uid }, signal),
        String(pid),
      ).rejects.toMatchObject({ kind: "refused", refusal: "self" });
    }
    expect(m.signals).toEqual([]);
  });

  it("the check runs on the FRESH row: a process that became another user's is refused even with a matching earlier proof", async () => {
    const { m, stopper, p, target, signal } = setup();
    const t = target();
    p.uid = 0;
    await expect(stopper.stop(t, signal)).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals).toEqual([]);
  });

  it("refuses everything when Core's own user id is unknown or root", async () => {
    for (const coreUid of [-1, 0]) {
      const m = new FakeMachine();
      const uid = coreUid === 0 ? 0 : UID;
      const p = m.add(proc({ pid: 4242, command: NODE, uid }), { port: 3000 });
      const stopper = createStopper(m.env({ uid: coreUid }), () => {});
      await expect(
        stopper.stop(
          { pid: 4242, port: 3000, start: m.startOf(p), command: p.command, uid },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: "refused" });
      expect(m.signals, String(coreUid)).toEqual([]);
    }
  });

  it("a system refusal (EPERM) is an error, never a success", async () => {
    const { m, stopper, target, signal } = setup();
    m.signalOutcome = "denied";
    await expect(stopper.stop(target(), signal)).rejects.toMatchObject({ kind: "refused" });
  });
});

describe("SIGTERM first, SIGKILL only by the second explicit command", () => {
  it("stop_process sends SIGTERM only, even when the process ignores it, and says force is next", async () => {
    const { m, stopper, target, signal } = setup({ ignoresTerm: true });
    const result = await stopper.stop(target(), signal);
    expect(m.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(result).toMatchObject({ exited: false, can_force: true });
    expect(m.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(TERM_WAIT_MS);
  });

  it("force_stop without a prior SIGTERM from this capability is refused", async () => {
    const { m, stopper, target, signal } = setup({ ignoresTerm: true });
    await expect(stopper.force(target(), signal)).rejects.toMatchObject({ kind: "term_first" });
    expect(m.signals).toEqual([]);
  });

  it("force_stop before the wait is over is refused, after it sends SIGKILL once", async () => {
    const { m, stopper, target, signal } = setup({ ignoresTerm: true });
    await stopper.stop(target(), signal);
    // stop() already waited TERM_WAIT_MS on the fake clock; rewind so only part of the wait has passed.
    m.now -= TERM_WAIT_MS;
    await expect(stopper.force(target(), signal)).rejects.toMatchObject({ kind: "too_early" });
    expect(m.signals.map((s) => s.signal)).toEqual(["SIGTERM"]);
    m.now += FORCE_AFTER_MS;
    const result = await stopper.force(target(), signal);
    expect(m.signals.map((s) => s.signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result).toMatchObject({ signal: "SIGKILL", exited: true, can_force: false });
    await expect(stopper.force(target(), signal)).rejects.toMatchObject({ kind: "term_first" });
  });

  it("force_stop re-proves identity: a pid that was reused after the SIGTERM is not killed", async () => {
    const { m, stopper, target, signal } = setup({ ignoresTerm: true });
    const t = target();
    await stopper.stop(t, signal);
    m.now += FORCE_AFTER_MS;
    m.remove(4242);
    m.add(proc({ pid: 4242, command: NODE, ageSeconds: 5 }), { port: 3000 });
    await expect(stopper.force(t, signal)).rejects.toMatchObject({ kind: "changed" });
    expect(m.signals.map((s) => s.signal)).toEqual(["SIGTERM"]);
  });

  it("force_stop applies the stop rules again: the process is checked, not trusted from the earlier call", async () => {
    const { m, stopper, p, target, signal } = setup({ ignoresTerm: true });
    const t = target();
    await stopper.stop(t, signal);
    m.now += FORCE_AFTER_MS;
    p.pgid = CORE_PGID;
    await expect(stopper.force(t, signal)).rejects.toMatchObject({
      kind: "refused",
      refusal: "self",
    });
    expect(m.signals.map((s) => s.signal)).toEqual(["SIGTERM"]);
  });

  it("SIGTERM records are forgotten when reset (capability disabled)", async () => {
    const { m, stopper, target, signal } = setup({ ignoresTerm: true });
    await stopper.stop(target(), signal);
    stopper.reset();
    m.now += FORCE_AFTER_MS;
    await expect(stopper.force(target(), signal)).rejects.toMatchObject({ kind: "term_first" });
  });

  it("reports each signal once to the audit callback", async () => {
    const { events, stopper, target, signal } = setup();
    await stopper.stop(target(), signal);
    expect(events).toEqual(["SIGTERM:4242:true"]);
  });
});

describe("input validation", () => {
  const good = {
    pid: 4242,
    port: 3000,
    start: "Mon Oct 19 09:56:56 2026",
    command: NODE,
    uid: 501,
  };
  it("accepts exactly the proof fields", () => {
    expect(parseTarget(good)).toEqual(good);
  });
  it.each([
    ["pid 1", { ...good, pid: 1 }],
    ["pid 0", { ...good, pid: 0 }],
    ["negative pid", { ...good, pid: -5 }],
    ["fractional pid", { ...good, pid: 12.5 }],
    ["string pid", { ...good, pid: "4242" }],
    ["port 0", { ...good, port: 0 }],
    ["port 70000", { ...good, port: 70000 }],
    ["free-form start", { ...good, start: "yesterday" }],
    ["empty command", { ...good, command: "" }],
    ["control character in command", { ...good, command: "a\nb" }],
    ["negative uid", { ...good, uid: -1 }],
    ["unknown field", { ...good, signal: "SIGKILL" }],
    ["null input", null],
    ["array input", []],
  ])("rejects %s", (_n, input) => {
    expect(() => parseTarget(input)).toThrowError(expect.objectContaining({ kind: "invalid" }));
  });
});
