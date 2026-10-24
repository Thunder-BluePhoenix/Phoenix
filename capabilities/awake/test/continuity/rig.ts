// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A continuity module on a fake machine. Nothing real is touched: commands are recorded by
// FakeSystem, time moves only when a test advances it, the network probe is a script.
import type { CapabilityContext } from "@phoenix/sdk";
import type { JournalFs } from "../../src/power/journal";
import {
  TMUX_PATHS,
  createContinuityModule,
  type ContinuityOptions,
  type ContinuityStatus,
} from "../../src/continuity";
import type { ActiveSession, AwakeDeps, AwakeModule, Platform, RunResult } from "../../src/system";
import { FakeFeed, FakeSystem, settle } from "../../testing/fakes";
import { MemFs } from "../power/fixtures";
import type { EmittedEvent } from "../../testing/ctx";

/** Built at runtime so no credential-shaped literal sits in the tree. */
export function fakePassword(): string {
  return ["hot", "spot", "-", String(Date.now() % 997), "-", "pw", "x9"].join("");
}

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};

export const DATA_DIR = "/data";

/** The fake file system keeps what the real one would: the mode every file and directory is created with. */
export class ModeFs extends MemFs implements JournalFs {
  readonly modes = new Map<string, number>();
  override mkdirPrivate(dir: string): void {
    super.mkdirPrivate(dir);
    this.modes.set(dir, 0o700);
  }
  override replace(path: string, data: string): void {
    super.replace(path, data);
    this.modes.set(path, 0o600);
  }
}

export interface ContinuityRig {
  sys: FakeSystem;
  /** What the module persists to (a fake; nothing real is touched). */
  fs: ModeFs;
  feed: FakeFeed;
  events: EmittedEvent[];
  logs: string[];
  module: AwakeModule;
  /** Scripted network: probe answers come from here. */
  net: { up: boolean; probes: number };
  session: { active: ActiveSession | null; ended: string[] };
  call(command: string, input?: unknown): Promise<unknown>;
  /** One probe interval. */
  tick(count?: number): Promise<void>;
  advance(ms: number): Promise<void>;
  shutdown(): void;
}

export interface RigOptions {
  config?: Record<string, unknown>;
  platform?: Platform;
  secret?: string;
  withSession?: boolean;
  noFeed?: boolean;
  options?: ContinuityOptions;
  /** A Core-owned directory in the context (ctx.dataDir); the module then gets no forced `dir`. */
  coreDir?: string;
  script?: (file: string, args: readonly string[]) => RunResult | undefined;
  /** Reuse a machine and file system: a Core restart on the same computer. */
  restartOf?: ContinuityRig;
}

export const ENABLE_ALL = {
  continuity: {
    network_watch: {
      enabled: true,
      hosts: ["example.test"],
      failures_required: 3,
      interval_seconds: 15,
    },
    hotspot: { enabled: true, ssid: "Pocket Net" },
    nudge: {
      enabled: true,
      after_seconds: 90,
      panes: ["%3"],
      allowed_commands: ["claude"],
    },
    throttle_check: { enabled: true },
  },
};

export async function continuityRig(rigOptions: RigOptions = {}): Promise<ContinuityRig> {
  const sys =
    rigOptions.restartOf?.sys ??
    new FakeSystem(rigOptions.platform ? { platform: rigOptions.platform } : {});
  const fs = rigOptions.restartOf?.fs ?? new ModeFs();
  if (rigOptions.script) sys.script = rigOptions.script;
  const feed = new FakeFeed();
  const events: EmittedEvent[] = [];
  const logs: string[] = [];
  const net = { up: true, probes: 0 };
  const session = {
    active:
      rigOptions.withSession === false
        ? null
        : ({
            id: "awk_t1",
            mode: "timed",
            startedAt: sys.clock.now(),
            endsAt: null,
          } as ActiveSession | null),
    ended: [] as string[],
  };
  const controller = new AbortController();
  const log = (...args: unknown[]) => void logs.push(JSON.stringify(args));
  const ctx: CapabilityContext = {
    id: "awake",
    config: rigOptions.config ?? {},
    logger: { ...quiet, warn: log, info: log, error: log, debug: log },
    ...(rigOptions.coreDir === undefined ? {} : { dataDir: rigOptions.coreDir }),
    signal: controller.signal,
    secret: (name) => Promise.resolve(name === "hotspot_password" ? rigOptions.secret : undefined),
    emit: (event) => {
      events.push(event as EmittedEvent);
      return { ok: true } as never;
    },
    watched: () => true,
    untilWatched: () => Promise.resolve(),
  };
  const module = createContinuityModule({
    ...(rigOptions.coreDir === undefined ? { dir: DATA_DIR } : { legacyDir: DATA_DIR }),
    fs,
    probe: () => {
      net.probes += 1;
      return Promise.resolve(net.up);
    },
    // Default tests see tmux at its first fixed path; nothing on the real disk is consulted.
    fileExists: (path) => path === TMUX_PATHS[0],
    ...rigOptions.options,
  });
  const deps: AwakeDeps = {
    env: sys.env,
    session: {
      active: () => session.active,
      end: (reason) => void session.ended.push(reason),
    },
    battery: () => Promise.resolve({ kind: "none" }),
    feed: rigOptions.noFeed ? undefined : feed,
    batteryPollMs: 60_000,
  };
  module.init?.(ctx, deps);
  const rig: ContinuityRig = {
    sys,
    fs,
    feed,
    events,
    logs,
    module,
    net,
    session,
    async call(command, input) {
      const handler = module.commands[command];
      if (!handler) throw new Error(`no command ${command}`);
      const result = await handler(input, ctx);
      await settle();
      return result;
    },
    async advance(ms) {
      await sys.clock.advance(ms);
      await settle();
    },
    async tick(count = 1) {
      for (let i = 0; i < count; i++) await rig.advance(15_000);
    },
    shutdown() {
      module.shutdown?.();
    },
  };
  return rig;
}

export const types = (r: ContinuityRig): string[] => r.events.map((e) => e.event_type);

export async function statusOf(r: ContinuityRig): Promise<ContinuityStatus> {
  // continuity.status always answers a ContinuityStatus (its handler is typed so).
  const status = (await r.call("continuity.status")) as ContinuityStatus;
  return status;
}
