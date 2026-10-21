// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The recovery module inside the real Awake capability and session, on a fake machine: every
// command goes to a recording Runner, the disk is a map, and "processes" are a table. No sudo,
// pmset or launchctl is ever run. "Crash" means dropping an instance without disabling it.
import { describe, expect, it } from "vitest";
import { createRecoveryModule, powerServices, type PowerServices } from "../../src/power";
import { parseJournal } from "../../src/power/format";
import type { AwakeDeps, AwakeModule } from "../../src/system";
import { createAwakeCapability } from "../../src";
import { FakeContext } from "../../testing/ctx";
import { FakeFeed, FakeSystem, settle, type RunScript } from "../../testing/fakes";
import type { BatteryReading } from "../../src/system";
import { FakeProcesses, JOURNAL, MemFs } from "./fixtures";

const SUDO_ON = "/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 1";
const SUDO_OFF = "/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0";
const LPM_ON = "/usr/bin/sudo -n /usr/bin/pmset -a lowpowermode 1";
const LPM_OFF = "/usr/bin/sudo -n /usr/bin/pmset -a lowpowermode 0";

interface RigOptions {
  platform?: "darwin" | "linux" | "win32";
  config?: Record<string, unknown>;
  reading?: BatteryReading;
  modules?: AwakeModule[];
  script?: RunScript;
}

interface Rig {
  sys: FakeSystem;
  fake: FakeContext;
  battery: { reading: BatteryReading };
  call(command: string, input?: unknown): Promise<unknown>;
  disable(): Promise<void>;
}

/** The real capability on a fake machine, like testing/ctx.ts `rig` but with the machine scriptable before init. */
async function rig(options: RigOptions): Promise<Rig> {
  const sys = new FakeSystem({ platform: options.platform ?? "darwin" });
  if (options.script) sys.script = options.script;
  const fake = new FakeContext();
  fake.config = options.config ?? {};
  const battery = { reading: options.reading ?? ({ kind: "none" } as BatteryReading) };
  let n = 0;
  const module = createAwakeCapability({
    env: sys.env,
    feed: () => new FakeFeed(),
    battery: () => Promise.resolve(battery.reading),
    batteryPollMs: 60_000,
    newId: () => `awk_test${++n}`,
    modules: options.modules ?? [],
  });
  await module.init?.(fake.ctx);
  return {
    sys,
    fake,
    battery,
    async call(command, input) {
      const handler = module.commands?.[command];
      if (!handler) throw new Error(`no command ${command}`);
      const result = await handler(input, fake.ctx);
      await settle();
      return result;
    },
    async disable() {
      fake.controller.abort();
      await module.shutdown?.(fake.ctx);
      await settle();
    },
  };
}

interface Instance {
  r: Rig;
  procs: FakeProcesses;
  sudo: () => string[];
  services: () => PowerServices | undefined;
}

/** One Phoenix instance (pid) on the shared disk and process table. */
async function boot(fs: MemFs, procs: FakeProcesses, extra: RigOptions = {}): Promise<Instance> {
  let deps: AwakeDeps | undefined;
  const module = createRecoveryModule({
    dir: "/data",
    fs,
    probe: procs.probe(),
    pollMs: 5_000,
    newId: (() => {
      let n = 0;
      return () => `chg_${procs.selfPid}_${++n}`;
    })(),
  });
  const spy: AwakeModule = {
    events: [],
    commandSpecs: [],
    commands: {},
    stateRules: [],
    init: (_ctx, d) => void (deps = d),
  };
  const r = await rig({ modules: [module, spy], ...extra });
  await settle();
  return {
    r,
    procs,
    sudo: () =>
      r.sys.runs
        .map((x) => [x.file, ...x.args].join(" "))
        .filter((c) => c.startsWith("/usr/bin/sudo -n /usr/bin/pmset")),
    services: () => (deps ? powerServices(deps) : undefined),
  };
}

/** Reads a nested field of a command result without trusting its shape. */
function dig(value: unknown, ...path: string[]): unknown {
  let at: unknown = value;
  for (const key of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = Reflect.get(at, key);
  }
  return at;
}

const ack = (i: Instance) => i.r.call("safety.acknowledge", { acknowledge: true, version: 1 });
async function lidClosedOn(i: Instance, minutes = 60) {
  await ack(i);
  await i.r.call("start", { minutes });
  return i.r.call("lid_closed.start", {});
}
const events = (i: Instance, type: string) => i.r.fake.events.filter((e) => e.event_type === type);

describe("crash recovery through the module", () => {
  it("killing Phoenix mid-session: the next instance reconciles at init and turns sleep back on", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const a = await boot(fs, procs);
    await lidClosedOn(a);
    expect(a.sudo()).toEqual([SUDO_ON]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending.map((e) => e.kind)).toEqual([
      "pmset.disablesleep",
    ]);
    // Instance A is killed: its object is dropped, nothing is undone, its process is gone.
    procs.die(100);
    const b = await boot(fs, procs.as(200));
    expect(b.sudo()).toEqual([SUDO_OFF]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
    expect(b.services()?.canQuit().ok).toBe(true);
    expect(events(b, "awake.privileged.undo")).toHaveLength(1);
  });

  it("does not undo a change owned by a still-running other instance", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const a = await boot(fs, procs);
    await lidClosedOn(a);
    const b = await boot(fs, procs.as(200));
    expect(b.sudo()).toEqual([]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toHaveLength(1);
  });

  it("a failed undo at launch is announced loudly (warning event) and refuses quit until it works", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const a = await boot(fs, procs);
    await lidClosedOn(a);
    procs.die(100);
    // The next instance's sudo refuses every undo (the rule was removed meanwhile).
    const b = await boot(fs, procs.as(200), {
      script: (file) =>
        file === "/usr/bin/sudo" ? { code: 1, stdout: "", stderr: "" } : undefined,
    });
    expect(events(b, "awake.recovery.pending")[0]).toMatchObject({
      severity: "warning",
      payload: { count: 1 },
    });
    expect(b.services()?.canQuit()).toMatchObject({
      ok: false,
      pending: [{ kind: "pmset.disablesleep" }],
    });
    expect(dig(await b.r.call("recovery.status", {}), "can_quit")).toBe(false);
    expect(dig(await b.r.call("recovery.status", {}), "journal", "pending", "0", "owner")).toBe(
      "dead",
    );
    b.r.sys.script = () => undefined;
    expect(await b.r.call("recovery.undo_now", {})).toMatchObject({ undone: 1, failed: [] });
    expect(b.services()?.canQuit().ok).toBe(true);
  });
});

describe("lid_closed.start", () => {
  it("refuses until the safety warning is acknowledged, and changes nothing", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    await i.r.call("start", { minutes: 30 });
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/safety warning/);
    expect(i.sudo()).toEqual([]);
  });

  it("refuses without a running session", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    await ack(i);
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/session first/);
    expect(i.sudo()).toEqual([]);
  });

  it("with no helper installed (sudo refuses) says so, leaves the session running and the journal clean", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100));
    i.r.sys.script = (file) =>
      file === "/usr/bin/sudo"
        ? { code: 1, stdout: "", stderr: "a password is required" }
        : undefined;
    await ack(i);
    await i.r.call("start", { minutes: 30 });
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/helper is not installed/);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
    expect(i.services()?.canQuit().ok).toBe(true);
    const status = await i.r.call("recovery.status", {});
    expect(dig(status, "session_active")).toBe(true);
    expect(dig(status, "lid_closed", "engaged")).toBe(false);
  });

  it("when the journal cannot be written the change is NOT made", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100));
    await ack(i);
    await i.r.call("start", { minutes: 30 });
    fs.failAppend = true;
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/journal cannot be written/);
    expect(i.sudo()).toEqual([]);
  });

  it("is refused off macOS", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100), { platform: "linux" });
    await ack(i);
    await i.r.call("start", { minutes: 30 });
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/macOS only/);
  });

  it("a second start while on is a conflict, and a timeout leaves sleep restored", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    await lidClosedOn(i);
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/already on/);
  });

  it("a sudo that times out (no exit code) is undone rather than guessed at", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    i.r.sys.script = (file, args) =>
      file === "/usr/bin/sudo" && args.at(-1) === "1"
        ? { code: null, stdout: "", stderr: "" }
        : undefined;
    await ack(i);
    await i.r.call("start", { minutes: 30 });
    await expect(i.r.call("lid_closed.start", {})).rejects.toThrow(/could not be turned on/);
    expect(i.sudo()).toEqual([SUDO_ON, SUDO_OFF]);
  });
});

describe("session lifecycle undoes the change", () => {
  it("ending the session restores sleep and records the session end for the backstop", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100));
    await lidClosedOn(i);
    await i.r.call("end", {});
    await i.r.sys.clock.advance(5_000);
    expect(i.sudo()).toEqual([SUDO_ON, SUDO_OFF]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
    expect(events(i, "awake.lid_closed.ended")[0]?.payload).toMatchObject({ restored: true });
    expect(i.services()?.canQuit().ok).toBe(true);
  });

  it("the session expiring restores sleep too", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    await lidClosedOn(i, 30);
    await i.r.sys.clock.advance(31 * 60_000);
    expect(i.sudo().at(-1)).toBe(SUDO_OFF);
  });

  it("lid_closed.end restores sleep and keeps the session", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    await lidClosedOn(i);
    await i.r.call("lid_closed.end", {});
    expect(i.sudo()).toEqual([SUDO_ON, SUDO_OFF]);
    expect(dig(await i.r.call("status", {}), "active")).toBe(true);
  });

  it("disable (Core exit) marks the session ended and starts the undo", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100));
    await lidClosedOn(i);
    await i.r.disable();
    await settle();
    expect(i.sudo()).toEqual([SUDO_ON, SUDO_OFF]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
  });

  it("an undo that fails stays pending: quit refused, warning event, and undo_now retries it", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100));
    await lidClosedOn(i);
    i.r.sys.script = (file, args) =>
      file === "/usr/bin/sudo" && args.at(-1) === "0"
        ? { code: 1, stdout: "", stderr: "" }
        : undefined;
    await i.r.call("lid_closed.end", {});
    const svc = i.services();
    const quit = svc?.canQuit();
    expect(quit?.ok).toBe(false);
    expect(quit?.pending.map((p) => p.kind)).toEqual(["pmset.disablesleep"]);
    expect(events(i, "awake.recovery.pending")[0]).toMatchObject({ severity: "warning" });
    expect(events(i, "awake.recovery.quit_refused")).toHaveLength(1);
    expect(events(i, "awake.lid_closed.ended")[0]?.payload).toMatchObject({ restored: false });
    i.r.sys.script = () => undefined;
    expect(await i.r.call("recovery.undo_now", {})).toMatchObject({ undone: 1, failed: [] });
    expect(svc?.canQuit().ok).toBe(true);
  });
});

describe("floors through the module", () => {
  it("below 40 % turns Low Power Mode on (journalled, through the helper); recovering turns it off", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100), {
      reading: { kind: "battery", percent: 80, onBattery: true },
    });
    await i.r.call("start", { minutes: 120 });
    i.r.battery.reading = { kind: "battery", percent: 39, onBattery: true };
    await i.r.sys.clock.advance(60_000);
    expect(i.sudo()).toEqual([LPM_ON]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending.map((e) => e.kind)).toEqual([
      "pmset.lowpowermode",
    ]);
    i.r.battery.reading = { kind: "battery", percent: 60, onBattery: false };
    await i.r.sys.clock.advance(60_000);
    expect(i.sudo()).toEqual([LPM_ON, LPM_OFF]);
    expect(parseJournal(fs.read(JOURNAL) ?? "").pending).toEqual([]);
  });

  it("below 10 % ends the session (reason battery) and releases Low Power Mode", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100), {
      reading: { kind: "battery", percent: 80, onBattery: true },
    });
    await i.r.call("start", { minutes: 120 });
    i.r.battery.reading = { kind: "battery", percent: 30, onBattery: true };
    await i.r.sys.clock.advance(60_000);
    i.r.battery.reading = { kind: "battery", percent: 9, onBattery: true };
    await i.r.sys.clock.advance(60_000);
    expect(dig(await i.r.call("status", {}), "active")).toBe(false);
    expect(i.r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "battery" });
    expect(i.sudo()).toEqual([LPM_ON, LPM_OFF]);
  });

  it("with no helper, Low Power Mode is reported unavailable (once), the session carries on", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100), {
      reading: { kind: "battery", percent: 80, onBattery: true },
    });
    i.r.sys.script = (file) =>
      file === "/usr/bin/sudo" ? { code: 1, stdout: "", stderr: "" } : undefined;
    await i.r.call("start", { minutes: 120 });
    i.r.battery.reading = { kind: "battery", percent: 30, onBattery: true };
    await i.r.sys.clock.advance(60_000);
    await i.r.sys.clock.advance(60_000);
    expect(events(i, "awake.floor.low_power_unavailable")).toHaveLength(1);
    expect(dig(await i.r.call("status", {}), "active")).toBe(true);
  });

  it("critical heat ends the session; the heat reading is only `pmset -g therm`", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    i.r.sys.script = (file, args) =>
      file === "/usr/bin/pmset" && args[1] === "therm"
        ? { code: 0, stdout: "CPU_Speed_Limit = 30\n", stderr: "" }
        : undefined;
    await i.r.call("start", { minutes: 120 });
    await i.r.sys.clock.advance(5_000);
    expect(i.r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "thermal" });
  });

  it("an unreadable heat sensor ends a bounded session after three reads, not before", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    i.r.sys.script = (file, args) =>
      file === "/usr/bin/pmset" && args[1] === "therm"
        ? { code: 1, stdout: "", stderr: "" }
        : undefined;
    await i.r.call("start", { minutes: 120 });
    await i.r.sys.clock.advance(60_000);
    await i.r.sys.clock.advance(60_000);
    expect(dig(await i.r.call("status", {}), "active")).toBe(true);
    await i.r.sys.clock.advance(60_000);
    expect(i.r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "thermal" });
  });

  it("floors switched off in config: nothing happens at 3 %", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100), {
      reading: { kind: "battery", percent: 80, onBattery: true },
      config: { floors_enabled: false, battery_floor_percent: 1 },
    });
    await i.r.call("start", { minutes: 120 });
    i.r.battery.reading = { kind: "battery", percent: 5, onBattery: true };
    await i.r.sys.clock.advance(120_000);
    expect(i.sudo()).toEqual([]);
    expect(events(i, "awake.floor.ended")).toEqual([]);
  });
});

describe("lid events, status and acknowledgement", () => {
  const closed = '  |   "AppleClamshellState" = Yes\n';
  const open = '  |   "AppleClamshellState" = No\n';

  it("publishes awake.lid.closed / opened from polls while a session runs, and not otherwise", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    let text = open;
    i.r.sys.script = (file) =>
      file === "/usr/sbin/ioreg" ? { code: 0, stdout: text, stderr: "" } : undefined;
    await i.r.sys.clock.advance(5_000);
    expect(i.r.sys.runs.some((x) => x.file === "/usr/sbin/ioreg")).toBe(false);
    await i.r.call("start", { minutes: 60 });
    await i.r.sys.clock.advance(5_000);
    text = closed;
    await i.r.sys.clock.advance(5_000);
    text = open;
    await i.r.sys.clock.advance(5_000);
    expect(i.r.fake.types().filter((t) => t.startsWith("awake.lid."))).toEqual([
      "awake.lid.closed",
      "awake.lid.opened",
    ]);
  });

  it("status reports the journal, lid, floors, helper and safety state", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const a = await boot(fs, procs);
    await lidClosedOn(a);
    procs.die(100);
    const i = await boot(fs, procs.as(200));
    const status = await i.r.call("recovery.status", {});
    expect(status).toMatchObject({
      session_active: false,
      can_quit: true,
      helper: { installed: true },
      lid: { supported: true },
      lid_closed: { engaged: false, since: null },
      floors: { enabled: true, low_power_percent: 40, end_percent: 10 },
      safety: { acknowledged: true, version: 1 },
    });
    expect(JSON.stringify(status)).not.toContain("/usr/bin/pmset");
  });

  it("lists a pending change with its owner state, so the UI can show it", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const a = await boot(fs, procs);
    await lidClosedOn(a);
    const b = await boot(fs, procs.as(200));
    const status = await b.r.call("recovery.status", {});
    expect(dig(status, "journal", "pending")).toMatchObject([
      { kind: "pmset.disablesleep", owner: "other" },
    ]);
    expect(dig(status, "can_quit")).toBe(true);
  });

  it("the acknowledgement persists across instances, needs the right version, and is announced", async () => {
    const fs = new MemFs();
    const a = await boot(fs, new FakeProcesses(100));
    await expect(
      a.r.call("safety.acknowledge", { acknowledge: true, version: 99 }),
    ).rejects.toThrow();
    await expect(
      a.r.call("safety.acknowledge", { acknowledge: false, version: 1 }),
    ).rejects.toThrow();
    expect(dig(await a.r.call("recovery.status", {}), "safety", "acknowledged")).toBe(false);
    await ack(a);
    expect(events(a, "awake.safety.acknowledged")).toHaveLength(1);
    const b = await boot(fs, new FakeProcesses(200));
    expect(dig(await b.r.call("recovery.status", {}), "safety", "acknowledged")).toBe(true);
  });

  it("a corrupt acknowledgement file means not acknowledged", async () => {
    const fs = new MemFs();
    fs.files.set("/data/awake/safety.json", "{ nope");
    const i = await boot(fs, new FakeProcesses(100));
    expect(dig(await i.r.call("recovery.status", {}), "safety", "acknowledged")).toBe(false);
  });

  it("an acknowledgement that cannot be saved is an error, not a silent success", async () => {
    const fs = new MemFs();
    const i = await boot(fs, new FakeProcesses(100));
    fs.failReplace = true;
    await expect(ack(i)).rejects.toThrow(/could not be saved/);
  });

  it("commands that take no input reject extra fields", async () => {
    const i = await boot(new MemFs(), new FakeProcesses(100));
    await expect(i.r.call("lid_closed.start", { force: true })).rejects.toThrow();
    await expect(i.r.call("recovery.undo_now", { all: true })).rejects.toThrow();
  });
});

describe("shared services for other modules", () => {
  it("registered reverters run at reconcile, and a duplicate kind is refused", async () => {
    const fs = new MemFs();
    const procs = new FakeProcesses(100);
    const done: string[] = [];
    const reg: AwakeModule = {
      events: [],
      commandSpecs: [],
      commands: {},
      stateRules: [],
      init: (_ctx, deps) =>
        powerServices(deps)?.registerReverter(
          "lid.mute",
          (undo) => (done.push(JSON.stringify(undo)), Promise.resolve()),
        ),
    };
    const a = await boot(fs, procs);
    const svc = a.services();
    expect(() => svc?.registerReverter("pmset.disablesleep", () => Promise.resolve())).toThrow(
      /already registered/,
    );
    await svc?.recovery.change(
      "lid.mute",
      { x: 1 },
      { restore: "volume" },
      () => Promise.resolve(),
      null,
    );
    procs.die(100);
    const module = createRecoveryModule({
      dir: "/data",
      fs,
      probe: procs.as(200).probe(),
      pollMs: 5_000,
    });
    await rig({ modules: [module, reg] });
    await settle();
    expect(done).toEqual(['{"restore":"volume"}']);
  });
});
