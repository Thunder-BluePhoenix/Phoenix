// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the radar lists: collectors per platform (fake Runner), project mapping, flags, the localhost
// link rule and the privacy rule (a project is a folder NAME, never a path). Simulated: no real
// socket or process is read here.
import { describe, expect, it } from "vitest";
import { collectListeners, windowsTool } from "../src/collect";
import { DEFAULT_THRESHOLDS } from "../src/policy";
import { findProject } from "../src/project";
import { buildSnapshot } from "../src/snapshot";
import { HOME, FakeMachine, proc } from "../testing/fakes";

const HOUR = 3600;

function machine() {
  const m = new FakeMachine();
  m.paths.add(`${HOME}/code/shop/.git`);
  m.add(
    proc({
      pid: 4242,
      command: `${HOME}/.nvm/versions/node/v22/bin/node`,
      ageSeconds: 30 * HOUR,
      cwd: `${HOME}/code/shop/apps/web`,
    }),
    { port: 3000, address: "127.0.0.1" },
  );
  return m;
}

describe("collectors", () => {
  it("macOS reads lsof by absolute path with field output and an argv array", async () => {
    const m = machine();
    const { collector, listeners } = await collectListeners(m.env());
    expect(collector).toBe("lsof");
    expect(listeners).toEqual([{ pid: 4242, port: 3000, address: "127.0.0.1", name: "node" }]);
    expect(m.runs[0]).toEqual({
      file: "/usr/sbin/lsof",
      args: ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcnL"],
    });
  });

  it("Linux falls back to ss when lsof cannot run", async () => {
    const m = machine();
    m.platform = "linux";
    m.lsofFails = true;
    const { collector, listeners } = await collectListeners(m.env());
    expect(collector).toBe("ss");
    expect(listeners.map((l) => l.port)).toEqual([3000]);
    expect(m.runs.map((r) => r.file)).toEqual(["/usr/bin/lsof", "/usr/bin/ss"]);
    expect(m.runs[1]?.args).toEqual(["-ltnpH"]);
  });

  it("Windows runs netstat then tasklist from System32 under the injected SystemRoot, and names the pids", async () => {
    const m = machine();
    m.platform = "win32";
    const { collector, listeners } = await collectListeners(
      m.env({ vars: { SystemRoot: "D:\\WinNT" } }),
    );
    expect(collector).toBe("netstat");
    expect(listeners).toEqual([{ pid: 4242, port: 3000, address: "127.0.0.1", name: "node" }]);
    expect(m.runs.map((r) => r.file)).toEqual([
      "D:\\WinNT\\System32\\netstat.exe",
      "D:\\WinNT\\System32\\tasklist.exe",
    ]);
  });

  it("a SystemRoot that is not a plain Windows path is ignored, never used to build an executable path", () => {
    const m = machine();
    for (const bad of [
      "..\\evil",
      "C:\\Windows\\..\\evil",
      "\\\\server\\share",
      "C:\\x; calc",
      undefined,
    ]) {
      expect(windowsTool(m.env({ vars: { SystemRoot: bad } }), "netstat.exe"), String(bad)).toBe(
        "C:\\Windows\\System32\\netstat.exe",
      );
    }
  });

  it("answers unavailable, not an empty list, when no collector works", async () => {
    const m = machine();
    m.platform = "linux";
    m.lsofFails = true;
    m.failCommands.add("/usr/bin/ss").add("/usr/sbin/ss").add("/sbin/ss");
    await expect(collectListeners(m.env())).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("project mapping", () => {
  it("finds the nearest .git above the cwd and returns the folder name, keeping the path inside", async () => {
    const m = machine();
    const found = await findProject(`${HOME}/code/shop/apps/web`, HOME, m.env().fs);
    expect(found).toEqual({ root: `${HOME}/code/shop`, name: "shop" });
  });

  it("no .git, a relative cwd, a missing cwd, or a repo at the home directory itself is no project", async () => {
    const m = machine();
    m.paths.add(`${HOME}/.git`);
    const fs = m.env().fs;
    expect(await findProject(`${HOME}/notes`, HOME, fs)).toBeUndefined();
    expect(await findProject("relative/dir", HOME, fs)).toBeUndefined();
    expect(await findProject(undefined, HOME, fs)).toBeUndefined();
    expect(await findProject("/tmp", HOME, fs)).toBeUndefined();
  });
});

describe("snapshot", () => {
  it("lists port, process, age, project name only, flags and the open link", async () => {
    const m = machine();
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(s.collector).toBe("lsof");
    expect(s.process_table).toBe(true);
    expect(s.ports).toHaveLength(1);
    const p = s.ports[0]!;
    expect(p).toMatchObject({
      pid: 4242,
      port: 3000,
      name: "node",
      exposure: "loopback",
      age_seconds: 30 * HOUR,
      project: "shop",
      forgotten: true,
      heavy: false,
      stoppable: true,
      refusal: null,
      url: "http://127.0.0.1:3000/",
      start: m.startOf(m.get(4242)),
    });
    // The web never learns a path: only the folder name appears anywhere in the answer.
    expect(JSON.stringify(s)).not.toContain(`${HOME}/code`);
    expect(JSON.stringify(s)).not.toContain("cwd");
  });

  it("a young server is not forgotten; a server outside any project is not forgotten however old", async () => {
    const m = machine();
    m.get(4242).ageSeconds = 2 * HOUR;
    m.add(
      proc({ pid: 5000, command: `${HOME}/bin/old-thing`, ageSeconds: 400 * HOUR, cwd: "/tmp" }),
      {
        port: 4000,
      },
    );
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(s.ports.map((p) => [p.port, p.forgotten])).toEqual([
      [3000, false],
      [4000, false],
    ]);
  });

  it("the age threshold is configurable and a protected process is never called forgotten", async () => {
    const m = machine();
    m.get(4242).ageSeconds = 3 * HOUR;
    m.add(
      proc({
        pid: 5100,
        uid: 0,
        command: "/usr/sbin/cupsd",
        ageSeconds: 900 * HOUR,
        cwd: `${HOME}/code/shop`,
      }),
      { port: 631 },
    );
    const s = await buildSnapshot(m.env(), { ...DEFAULT_THRESHOLDS, forgottenHours: 2 });
    expect(s.ports.map((p) => [p.port, p.forgotten])).toEqual([
      [631, false],
      [3000, true],
    ]);
  });

  it("heavy comes from cpu or memory at the threshold, for any process", async () => {
    const m = machine();
    m.add(proc({ pid: 6000, command: "/usr/sbin/cupsd", uid: 0, cpu: 95 }), { port: 631 });
    m.add(proc({ pid: 6001, command: `${HOME}/bin/db`, rssKb: 2 * 1024 * 1024 }), { port: 5432 });
    m.add(proc({ pid: 6002, command: `${HOME}/bin/ok`, cpu: 79.9, rssKb: 1023 * 1024 }), {
      port: 9000,
    });
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(s.ports.map((p) => [p.port, p.heavy])).toEqual([
      [631, true],
      [3000, false],
      [5432, true],
      [9000, false],
    ]);
  });

  it("offers a localhost link only when 127.0.0.1 reaches the socket", async () => {
    const m = machine();
    m.add(proc({ pid: 7000, command: `${HOME}/bin/a` }), { port: 5000, address: "::1" });
    m.add(proc({ pid: 7001, command: `${HOME}/bin/b` }), { port: 5001, address: "192.168.1.5" });
    m.add(proc({ pid: 7002, command: `${HOME}/bin/c` }), { port: 5002, address: "*" });
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    const byPort = new Map(s.ports.map((p) => [p.port, p]));
    expect(byPort.get(5000)?.url).toBeNull();
    expect(byPort.get(5001)?.url).toBeNull();
    expect(byPort.get(5001)?.exposure).toBe("interface");
    expect(byPort.get(5002)).toMatchObject({ url: "http://127.0.0.1:5002/", exposure: "all" });
  });

  it("127.0.0.1 gets a link, 127.0.0.2 does not (a link to 127.0.0.1 would reach another socket)", async () => {
    const m = machine();
    m.add(proc({ pid: 7010, command: `${HOME}/bin/a` }), { port: 5010, address: "127.0.0.1" });
    m.add(proc({ pid: 7011, command: `${HOME}/bin/b` }), { port: 5011, address: "127.0.0.2" });
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    const byPort = new Map(s.ports.map((p) => [p.port, p]));
    expect(byPort.get(5010)?.url).toBe("http://127.0.0.1:5010/");
    expect(byPort.get(5011)?.url).toBeNull();
  });

  it("a project folder name with bidi or control characters is cleaned before the web sees it", async () => {
    const m = new FakeMachine();
    m.paths.add(`${HOME}/code/sh\u202Eop/.git`);
    m.add(proc({ pid: 4300, command: `${HOME}/bin/srv`, cwd: `${HOME}/code/sh\u202Eop/app` }), {
      port: 3300,
    });
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(s.ports[0]?.project).toBe("shop");
  });

  it("a process whose ps name hides a bidi override is not stoppable and the snapshot warns", async () => {
    const m = machine();
    m.add(proc({ pid: 4301, command: `${HOME}/bin/ev\u202Eil` }), { port: 3301 });
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    const hidden = s.ports.find((p) => p.port === 3301);
    expect(hidden).toMatchObject({ stoppable: false, refusal: "unknown", command: null });
    expect(s.parse_warnings).toBeGreaterThanOrEqual(1);
    expect(s.ports.find((p) => p.port === 3000)?.stoppable).toBe(true);
  });

  it("a clean machine has no parse warnings", async () => {
    const s = await buildSnapshot(machine().env(), DEFAULT_THRESHOLDS);
    expect(s.parse_warnings).toBe(0);
  });

  it("a name with a line break in ss output marks the snapshot with parse warnings", async () => {
    const m = machine();
    m.platform = "linux";
    m.lsofFails = true;
    m.rawSs = [
      'LISTEN 0      511    127.0.0.1:3000   0.0.0.0:*   users:(("node",pid=4242,fd=19))',
      'LISTEN 0      511    127.0.0.1:8080   0.0.0.0:*   users:(("a',
      'b",pid=7,fd=3))',
    ].join("\n");
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(s.collector).toBe("ss");
    expect(s.ports.map((p) => p.pid)).toEqual([4242]);
    expect(s.parse_warnings).toBe(2);
  });

  it("an unreadable process table still lists ports, with unknown ages and nothing stoppable", async () => {
    const m = machine();
    m.failCommands.add("/usr/bin/env");
    const s = await buildSnapshot(m.env(), DEFAULT_THRESHOLDS);
    expect(s.process_table).toBe(false);
    expect(s.ports[0]).toMatchObject({
      port: 3000,
      age_seconds: null,
      start: null,
      stoppable: false,
      refusal: "unknown",
      forgotten: false,
    });
  });

  it("Windows: ports and names, age and project unknown, nothing stoppable", async () => {
    const m = machine();
    m.platform = "win32";
    const s = await buildSnapshot(m.env({ uid: -1 }), DEFAULT_THRESHOLDS);
    expect(s.ports[0]).toMatchObject({
      port: 3000,
      name: "node",
      age_seconds: null,
      project: null,
      stoppable: false,
      refusal: "unsupported",
    });
  });
});
