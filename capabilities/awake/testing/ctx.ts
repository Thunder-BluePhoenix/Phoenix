// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CapabilityContext, CapabilityModule } from "@phoenix/sdk";
import { createAwakeCapability, type AwakeCapabilityOptions } from "../src";
import type { BatteryReading } from "../src/system";
import { FakeFeed, FakeSystem, settle } from "./fakes";

export interface EmittedEvent {
  event_type: string;
  severity?: string;
  subject?: string;
  correlation_id?: string;
  payload?: Record<string, unknown>;
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

/**
 * A capability context that records events. Like the manager's, it refuses to publish once its
 * signal is aborted. `controller.abort()` plays disable / Core exit; `failEmit` plays a bus that
 * rejects (`result`) or throws (`throw`) on publish.
 */
export class FakeContext {
  readonly controller = new AbortController();
  readonly events: EmittedEvent[] = [];
  config: Record<string, unknown> = {};
  /** The capability directory Core would hand over; undefined plays a harness with no Core. */
  dataDir: string | undefined;
  failEmit: "result" | "throw" | undefined;

  get ctx(): CapabilityContext {
    return {
      id: "awake",
      config: this.config,
      logger: quiet,
      ...(this.dataDir === undefined ? {} : { dataDir: this.dataDir }),
      signal: this.controller.signal,
      secret: () => Promise.resolve(undefined),
      emit: (event) => {
        if (this.failEmit === "throw") throw new Error("bus exploded");
        if (this.failEmit === "result" || this.controller.signal.aborted)
          return { ok: false, error: new Error("not published") } as never;
        this.events.push(event as EmittedEvent);
        // The bus's success record has fields no Awake code reads; `never` stands in for it.
        return { ok: true } as never;
      },
      watched: () => true,
      untilWatched: () => Promise.resolve(),
    };
  }

  types(): string[] {
    return this.events.map((e) => e.event_type);
  }

  last(type: string): EmittedEvent {
    const found = this.events.filter((e) => e.event_type === type).at(-1);
    if (!found) throw new Error(`no ${type} event`);
    return found;
  }
}

export interface Rig {
  sys: FakeSystem;
  feed: FakeFeed;
  fake: FakeContext;
  module: CapabilityModule;
  battery: { reading: BatteryReading; reads: number };
  call(command: string, input?: unknown): Promise<unknown>;
  /** Disable / Core exit as the manager runs it: `stopping`, then the abort, then `shutdown`. */
  disable(reason?: string): Promise<void>;
}

export interface RigOptions extends AwakeCapabilityOptions {
  platform?: "darwin" | "linux" | "win32";
  noFeed?: boolean;
  config?: Record<string, unknown>;
  reading?: BatteryReading;
}

/** An initialised capability on a fake machine. Nothing real is touched. */
export async function rig(options: RigOptions = {}): Promise<Rig> {
  const sys = new FakeSystem(options.platform ? { platform: options.platform } : {});
  const feed = new FakeFeed();
  const fake = new FakeContext();
  fake.config = options.config ?? {};
  const battery = { reading: options.reading ?? ({ kind: "none" } as BatteryReading), reads: 0 };
  let n = 0;
  const module = createAwakeCapability({
    env: sys.env,
    battery:
      options.battery ??
      (() => {
        battery.reads += 1;
        return Promise.resolve(battery.reading);
      }),
    ...(options.noFeed ? {} : { feed: () => feed }),
    batteryPollMs: 60_000,
    newId: () => `awk_test${++n}`,
    ...(options.modules ? { modules: options.modules } : { modules: [] }),
  });
  await module.init?.(fake.ctx);
  return {
    sys,
    feed,
    fake,
    module,
    battery,
    async call(command, input) {
      const handler = module.commands?.[command];
      if (!handler) throw new Error(`no command ${command}`);
      const result = await handler(input, fake.ctx);
      await settle();
      return result;
    },
    async disable(reason = "user") {
      module.stopping?.(fake.ctx, reason);
      fake.controller.abort();
      await module.shutdown?.(fake.ctx);
      await settle();
    },
  };
}
