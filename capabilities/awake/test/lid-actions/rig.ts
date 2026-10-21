// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The lid actions on a fake machine. NOTHING real is touched: "processes" are a table, a signal is
// a log line, audio is a map, `defaults` is a map, the disk is a map, and every command goes to a
// recording script. One ordered log records journal appends, commands, signals and audio calls, so
// a test can assert that the journal always comes first.
import { createAwakeCapability } from "../../src";
import { createLidActionsModule, type LidActionsOptions } from "../../src/lid-actions";
import type { AudioControl, AudioDevice, ProcInfo, Signal } from "../../src/lid-actions/types";
import { decodeLine } from "../../src/power/format";
import { createRecoveryModule, powerServices, type PowerServices } from "../../src/power";
import type { AwakeDeps, AwakeModule, RunResult } from "../../src/system";
import { FakeContext } from "../../testing/ctx";
import { FakeFeed, FakeSystem } from "../../testing/fakes";
import { FakeProcesses, JOURNAL, MemFs } from "../power/fixtures";

export const T0 = "Tue Oct 20 09:00:00 2026";
export const T1 = "Tue Oct 20 09:05:00 2026";

export const SELF_PID = 4242;
/** The user id Phoenix "runs" as on the fake machine. */
export const UID = 501;

export interface LogEntry {
  /** Journal kind this effect belongs to (so order can be checked per kind). */
  kind: string;
  what: string;
}

/** An in-memory disk that also notes every journal `change` record in the shared log. */
export class LoggingFs extends MemFs {
  log: LogEntry[] = [];
  override append(path: string, data: string): void {
    super.append(path, data);
    if (path !== JOURNAL) return;
    for (const line of data.split("\n")) {
      if (line === "") continue;
      const rec = decodeLine(line);
      if (rec?.t === "change") this.log.push({ kind: rec.kind, what: `journal:${rec.kind}` });
    }
  }
}

export function proc(
  pid: number,
  ppid: number,
  command: string,
  start = T0,
  state = "S",
): ProcInfo {
  return { pid, ppid, uid: UID, state, start, command };
}

/** A typical Mac. Pids are made up. */
export function sampleTable(): ProcInfo[] {
  return [
    proc(1, 0, "/sbin/launchd"),
    proc(SELF_PID, 1, "/Applications/Phoenix.app/Contents/MacOS/phoenix"),
    proc(100, 1, "/Applications/Slack.app/Contents/MacOS/Slack"),
    proc(
      101,
      100,
      "/Applications/Slack.app/Contents/Frameworks/Slack Helper.app/Contents/MacOS/Slack Helper",
    ),
    proc(110, 1, "/Applications/WhatsApp.app/Contents/MacOS/WhatsApp"),
    proc(120, 1, "/Applications/Discord.app/Contents/MacOS/Discord"),
    proc(300, 1, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
    proc(400, 1, "/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
    proc(600, 1, "/Applications/Docker.app/Contents/MacOS/com.docker.backend"),
    proc(601, 600, "/Applications/Docker.app/Contents/MacOS/com.docker.virtualization"),
    proc(602, 1, "/Applications/Docker.app/Contents/Resources/bin/docker"),
  ];
}

/** The machine's state, shared by every Phoenix instance that "runs" on it. */
export class Machine {
  table: ProcInfo[] = sampleTable();
  /** Everything effectful, in order. */
  log: LogEntry[] = [];
  signals: { pid: number; signal: Signal }[] = [];
  /** Throw from the signaler for these pids. */
  signalFails = new Set<number>();
  /** The signal that was sent last to each pid. */
  stopped = new Set<number>();
  devices: AudioDevice[] = [
    { id: "builtin", muted: false },
    { id: "headphones", muted: false },
  ];
  defaultOutput: string | null = "builtin";
  setMutedFails = new Set<string>();
  defaults = new Map<string, "0" | "1">();
  brightness: string | null = "0.600000";
  helperInstalled = true;
  /** `pmset -g assertions` output; null: the probe fails. Default: nobody holds anything. */
  assertions: string | null = "Assertion status system-wide:\n   PreventUserIdleSystemSleep    0\n";
  /** Replies for successive `pmset -g assertions` reads (the last repeats); overrides `assertions`. */
  assertionsSeq: (string | null)[] = [];
  /** Runs when the engine sleeps between undo retries (a test fixes the world here). */
  onSleep: (() => void) | undefined;
  /** The audio adapter can only address the current default (like the osascript one). */
  defaultOnly = false;
  /** Processes() never answers (a stuck `ps`). */
  hang = false;
  /** `ioreg` fails (the lid observer reads "unknown"). */
  lidUnreadable = false;
  /** What the brightness tool's file looks like to `stat` (null: unreadable). */
  toolStat: { uid: number; mode: number } | null = { uid: UID, mode: 0o755 };
  /** The audio adapter's idea of the default output's name (null: unreadable). */
  deviceNames: Record<string, string | null> = { builtin: "Speakers", headphones: "Headphones" };
  /** Every `sleep` the engine asked for (the retry backoff). */
  sleeps: number[] = [];
  lid: "Yes" | "No" = "No";
  /** The user's real Phoenix tracked agents (pid by event). */
  readonly fs = new LoggingFs();
  readonly procs = new FakeProcesses(SELF_PID);
  /** Every command that reached the Runner (for "nothing ran" assertions), without lid polling. */
  commands: string[] = [];

  constructor() {
    this.fs.log = this.log;
  }

  note(kind: string, what: string): void {
    this.log.push({ kind, what });
  }

  readonly audio: AudioControl = this.makeAudio();

  private makeAudio(): AudioControl {
    const self = this;
    return {
      get addressing() {
        return self.defaultOnly ? ("default_only" as const) : ("by_id" as const);
      },
      listOutputs: () => {
        if (this.defaultOnly) {
          const d = this.devices.find((x) => x.id === this.defaultOutput);
          return Promise.resolve(
            d ? [{ id: "default", muted: d.muted, name: this.deviceNames[d.id] ?? null }] : [],
          );
        }
        return Promise.resolve(
          this.devices.map((d) => ({ ...d, name: this.deviceNames[d.id] ?? null })),
        );
      },
      defaultOutputId: () => Promise.resolve(this.defaultOnly ? "default" : this.defaultOutput),
      setMuted: (id, muted) => {
        const real = this.defaultOnly && id === "default" ? (this.defaultOutput ?? id) : id;
        this.note("lid.mute", `audio:${real}:${muted}`);
        if (this.setMutedFails.has(real)) return Promise.reject(new Error("audio failed"));
        const device = this.devices.find((d) => d.id === real);
        if (device) device.muted = muted;
        return Promise.resolve();
      },
    };
  }

  readonly processes = (): Promise<ProcInfo[]> =>
    this.hang
      ? new Promise<ProcInfo[]>(() => undefined)
      : Promise.resolve(this.table.map((p) => ({ ...p })));

  /** Pids the system refuses to signal (EPERM). */
  denied = new Set<number>();

  readonly signal = (pid: number, signal: Signal): "sent" | "gone" | "denied" => {
    const command = this.table.find((p) => p.pid === pid)?.command ?? "";
    this.note(
      command.startsWith("/Applications/Docker.app/") ? "lid.docker_freeze" : "lid.freeze",
      `signal:${pid}:${signal}`,
    );
    this.signals.push({ pid, signal });
    if (this.denied.has(pid)) return "denied";
    if (this.signalFails.has(pid)) throw new Error("EPERM");
    if (!this.table.some((p) => p.pid === pid)) return "gone";
    if (signal === "SIGSTOP") this.stopped.add(pid);
    else this.stopped.delete(pid);
    return "sent";
  };

  sent(signal: Signal): number[] {
    return this.signals.filter((s) => s.signal === signal).map((s) => s.pid);
  }

  /** The scripted Runner: `ps`/`ioreg` reads and the few effectful commands, all fake. */
  script = (file: string, args: readonly string[]): RunResult | undefined => {
    const line = [file, ...args].join(" ");
    const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
    if (file === "/usr/sbin/ioreg") {
      if (this.lidUnreadable) return { code: 1, stdout: "", stderr: "" };
      return ok(`"AppleClamshellState" = ${this.lid}`);
    }
    this.commands.push(line);
    if (file === "/usr/bin/sudo") {
      if (!this.helperInstalled)
        return { code: 1, stdout: "", stderr: "sudo: a password is required" };
      if (args[1] === "-l") return ok();
      this.note("pmset.lowpowermode", `run:${line}`);
      return ok();
    }
    if (file === "/usr/bin/pmset" && args[0] === "-g") {
      const next =
        this.assertionsSeq.length > 1 ? this.assertionsSeq.shift() : this.assertionsSeq[0];
      const text = next === undefined ? this.assertions : next;
      return text === null ? { code: 1, stdout: "", stderr: "" } : ok(text);
    }
    if (file === "/usr/bin/pmset") {
      this.note("lid.display", `run:${line}`);
      return ok();
    }
    if (file.endsWith("/brightness")) {
      if (file !== "/opt/homebrew/bin/brightness" || this.brightness === null) {
        return { code: null, stdout: "", stderr: "" };
      }
      if (args[0] === "-l") {
        return ok(
          `display 0: main, active, awake, online, builtin, ID 0x1\ndisplay 0: brightness ${this.brightness}\n`,
        );
      }
      this.note("lid.display", `run:${line}`);
      return ok();
    }
    if (file === "/usr/bin/defaults") {
      const [verb, bundle] = [args[0], args[1] ?? ""];
      if (verb === "read") {
        const v = this.defaults.get(bundle);
        return v === undefined
          ? {
              code: 1,
              stdout: "",
              stderr: `The domain/default pair of (${bundle}, NSAppSleepDisabled) does not exist`,
            }
          : ok(`${v}\n`);
      }
      this.note("lid.app_nap", `run:${line}`);
      if (verb === "write") this.defaults.set(bundle, args[4] === "YES" ? "1" : "0");
      if (verb === "delete") this.defaults.delete(bundle);
      return ok();
    }
    return undefined;
  };

  /** Commands that changed something (reads excluded). */
  effects(): LogEntry[] {
    return this.log.filter((e) => !e.what.startsWith("journal:"));
  }
}

export interface Instance {
  machine: Machine;
  sys: FakeSystem;
  fake: FakeContext;
  feed: FakeFeed;
  services: () => PowerServices;
  deps: () => AwakeDeps;
  call(command: string, input?: unknown): Promise<unknown>;
  /** One poll of the lid observer and Recovery's session check. */
  tick(): Promise<void>;
  advance(ms: number): Promise<void>;
  disable(): Promise<void>;
  /** The lid-actions module's own `shutdown()` (what a host that awaits it would wait for). */
  lidShutdown(): Promise<void> | void;
  types(): string[];
  events(type: string): Record<string, unknown>[];
}

/** Lets everything queued (undo chains, timers) finish. Microtasks only: no real time passes. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 400; i++) await Promise.resolve();
}

export interface BootOptions {
  config?: Record<string, unknown>;
  platform?: "darwin" | "linux" | "win32";
  lid?: LidActionsOptions;
  /** Another Phoenix pid on the same machine (a second instance). */
  pid?: number;
  noFeed?: boolean;
}

/** One Phoenix instance (the real capability, real Recovery module, real lid-actions module) on `machine`. */
export async function boot(machine: Machine, options: BootOptions = {}): Promise<Instance> {
  const pid = options.pid ?? SELF_PID;
  const procs = pid === SELF_PID ? machine.procs : machine.procs.as(pid);
  const sys = new FakeSystem({ platform: options.platform ?? "darwin" });
  sys.script = machine.script;
  const feed = new FakeFeed();
  const fake = new FakeContext();
  fake.config = options.config ?? {};
  let deps: AwakeDeps | undefined;
  const spy: AwakeModule = {
    events: [],
    commandSpecs: [],
    commands: {},
    stateRules: [],
    init: (_c, d) => void (deps = d),
  };
  const recovery = createRecoveryModule({
    dir: "/data",
    fs: machine.fs,
    probe: procs.probe(),
    pollMs: 5_000,
    newId: (() => {
      let n = 0;
      return () => `chg_${pid}_${++n}`;
    })(),
  });
  const lid = createLidActionsModule({
    allowSimulation: true,
    processes: machine.processes,
    signal: machine.signal,
    audio: machine.audio,
    selfPid: pid,
    uid: UID,
    stat: () => Promise.resolve(machine.toolStat),
    sleep: (ms) => {
      machine.sleeps.push(ms);
      machine.onSleep?.();
      return Promise.resolve();
    },
    ...options.lid,
  });
  let ids = 0;
  const module = createAwakeCapability({
    env: sys.env,
    ...(options.noFeed ? {} : { feed: () => feed }),
    battery: () => Promise.resolve({ kind: "none" }),
    batteryPollMs: 60_000,
    newId: () => `awk_${pid}_${++ids}`,
    modules: [recovery, lid, spy],
  });
  await module.init?.(fake.ctx);
  await flush();
  const need = (): AwakeDeps => {
    if (!deps) throw new Error("not initialised");
    return deps;
  };
  const instance: Instance = {
    machine,
    sys,
    fake,
    feed,
    deps: need,
    services() {
      const s = powerServices(need());
      if (!s) throw new Error("no recovery services");
      return s;
    },
    async call(command, input) {
      const handler = module.commands?.[command];
      if (!handler) throw new Error(`no command ${command}`);
      const result = await handler(input, fake.ctx);
      await flush();
      return result;
    },
    async tick() {
      await instance.services().tick();
      await flush();
    },
    async advance(ms) {
      await sys.clock.advance(ms);
      await flush();
    },
    lidShutdown: () => lid.shutdown?.(),
    async disable() {
      fake.controller.abort();
      await module.shutdown?.(fake.ctx);
      await flush();
    },
    types: () => fake.types(),
    events: (type) => fake.events.filter((e) => e.event_type === type).map((e) => e.payload ?? {}),
  };
  return instance;
}

/** Starts a keep-awake session (a fake `caffeinate`). */
export async function startSession(i: Instance): Promise<string> {
  await i.call("start", { minutes: 60 });
  const id = i.deps().session.active()?.id;
  if (!id) throw new Error("no session");
  return id;
}

export interface LidRunView {
  event: string;
  results: {
    action: string;
    outcome: string;
    reason?: string;
    count?: number;
    mismatched?: number;
    gone?: number;
    notes?: string[];
  }[];
}

export async function simulateClose(i: Instance): Promise<LidRunView> {
  return (await i.call("lid_actions.simulate_close")) as LidRunView;
}

export async function simulateOpen(i: Instance): Promise<LidRunView> {
  return (await i.call("lid_actions.simulate_open")) as LidRunView;
}

export function outcomes(run: LidRunView): Record<string, string> {
  return Object.fromEntries(run.results.map((r) => [r.action, r.outcome]));
}
