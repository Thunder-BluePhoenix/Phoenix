// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Recording fakes for the Awake modules. Nothing here touches the machine: a "child" is an object,
// a "timer" fires when the test advances the clock, and a command runs only if the test scripted it.
import type {
  AgentEventFeed,
  AwakeClock,
  AwakeEnv,
  FeedEvent,
  Platform,
  RunOptions,
  RunResult,
  SpawnedChild,
  TimerHandle,
} from "../src/system";

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** A clock that only moves when the test says so. */
export class FakeClock implements AwakeClock {
  current: number;
  private nextId = 1;
  private timers: Timer[] = [];

  constructor(start = Date.parse("2026-10-20T09:00:00Z")) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimer(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, at: this.current + ms, fn });
    return id;
  }

  clearTimer(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward, firing due timers in order. Timers set while advancing fire too if due. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.current = Math.max(this.current, due.at);
      due.fn();
      await settle();
    }
    this.current = target;
    await settle();
  }
}

/** Lets promise continuations (including those chained on `exited`) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export class FakeChild implements SpawnedChild {
  killed = 0;
  private done = Promise.withResolvers<number | null>();
  readonly exited = this.done.promise;
  private gone = false;

  constructor(
    readonly file: string,
    readonly args: readonly string[],
    readonly pid: number | undefined,
  ) {}

  kill(): void {
    this.killed += 1;
    this.exit(null);
  }

  /** The process ends by itself (its own timeout, a crash). */
  exit(code: number | null): void {
    if (this.gone) return;
    this.gone = true;
    this.done.resolve(code);
  }

  get alive(): boolean {
    return !this.gone;
  }
}

export interface FakeSystemOptions {
  platform?: Platform;
  /** Make `spawn` throw (a missing binary). */
  spawnThrows?: boolean;
  /** Children start without a pid (the OS refused to start them). */
  noPid?: boolean;
}

export type RunScript = (file: string, args: readonly string[]) => RunResult | undefined;

/** A host machine that records every spawn and run and never executes anything. */
export class FakeSystem {
  readonly clock = new FakeClock();
  readonly children: FakeChild[] = [];
  readonly runs: { file: string; args: readonly string[]; opts: RunOptions | undefined }[] = [];
  script: RunScript = () => undefined;
  spawnThrows: boolean;
  noPid: boolean;
  private pid = 4000;
  readonly platform: Platform;

  constructor(options: FakeSystemOptions = {}) {
    this.platform = options.platform ?? "darwin";
    this.spawnThrows = options.spawnThrows ?? false;
    this.noPid = options.noPid ?? false;
  }

  get env(): AwakeEnv {
    return {
      platform: this.platform,
      clock: this.clock,
      spawn: (file, args) => {
        if (this.spawnThrows) throw new Error("spawn ENOENT");
        const child = new FakeChild(file, args, this.noPid ? undefined : this.pid++);
        this.children.push(child);
        return child;
      },
      run: (file, args, opts) => {
        this.runs.push({ file, args, opts });
        return Promise.resolve(this.script(file, args) ?? { code: 0, stdout: "", stderr: "" });
      },
    };
  }

  /** Children still running: must be empty after every release path. */
  get alive(): FakeChild[] {
    return this.children.filter((c) => c.alive);
  }
}

export class FakeFeed implements AgentEventFeed {
  readonly handlers = new Map<string, (event: FeedEvent) => void | Promise<void>>();
  readonly patterns = new Map<string, readonly string[]>();

  subscribe(
    id: string,
    patterns: string | readonly string[],
    handler: (event: FeedEvent) => void | Promise<void>,
  ): () => void {
    if (this.handlers.has(id)) throw new Error(`Subscriber "${id}" already registered`);
    this.handlers.set(id, handler);
    this.patterns.set(id, typeof patterns === "string" ? [patterns] : patterns);
    return () => {
      this.handlers.delete(id);
      this.patterns.delete(id);
    };
  }

  get subscribers(): number {
    return this.handlers.size;
  }

  /** Delivers to every subscriber whose patterns match, like the bus. */
  async publish(event_type: string, payload: Record<string, unknown> = {}): Promise<void> {
    for (const [id, handler] of [...this.handlers]) {
      const patterns = this.patterns.get(id) ?? [];
      const hit = patterns.some((p) =>
        p === "*"
          ? true
          : p.endsWith(".*")
            ? event_type.startsWith(p.slice(0, -1))
            : p === event_type,
      );
      if (hit) await handler({ event_type, payload });
    }
  }
}
