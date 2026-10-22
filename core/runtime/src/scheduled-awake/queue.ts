// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Power-aware queue: heavy jobs (a long agent run, a batch) wait for the charger; light jobs do
// not. The queue never starts anything by itself: it calls the injected `run`, which is where the
// host puts the permission gateway and the audit row. Pure scheduling, no OS access.
import { AwakeError, type AwakeClock } from "@phoenix/capability-awake";
import { judgePower, type PowerBlock, type PowerSource } from "./power";
import { isScheduleId } from "./schedule";
import { MINUTE_MS } from "./time";

export const MAX_QUEUED_JOBS = 64;
export const QUEUE_RECHECK_MS = MINUTE_MS;
export const DEFAULT_MAX_WAIT_MS = 24 * 60 * MINUTE_MS;
export const MAX_WAIT_MS = 7 * 24 * 60 * MINUTE_MS;

export interface QueuedJobInput {
  /** Same shape as a schedule id: lowercase letters, digits, dashes. */
  id: string;
  heavy: boolean;
  /** Give up (drop, never run) after this long. Default 24 hours, at most 7 days. */
  maxWaitMs?: number;
}

export type QueueOutcome = "completed" | "failed" | "cancelled" | "expired";

export interface QueueSnapshot {
  queued: { id: string; heavy: boolean; waitingFor: PowerBlock | null; waitedMs: number }[];
  running: string[];
}

export interface PowerQueueOptions {
  clock: AwakeClock;
  power: PowerSource;
  /** Runs one job. The signal aborts on cancel and on shutdown. A rejection marks it failed. */
  run(job: { id: string; heavy: boolean }, signal: AbortSignal): Promise<void>;
  /** Called once per job with how it ended. A throw is swallowed. */
  settled(id: string, outcome: QueueOutcome): void;
  /** Jobs running at once. Default 1. */
  concurrency?: number;
}

interface Entry {
  id: string;
  heavy: boolean;
  queuedAt: number;
  deadline: number;
}

export class PowerQueue {
  private readonly waiting: Entry[] = [];
  private readonly running = new Map<string, AbortController>();
  private readonly blocked = new Map<string, PowerBlock>();
  private timer: ReturnType<AwakeClock["setTimer"]> | undefined;
  private pumping: Promise<void> | undefined;
  private again = false;
  private stopped = false;

  constructor(private readonly o: PowerQueueOptions) {}

  /** Adds a job and tries to run it now. Throws `AwakeError` (invalid / conflict / limit). */
  async enqueue(input: QueuedJobInput): Promise<void> {
    if (this.stopped) throw new AwakeError("unavailable", "The queue has stopped");
    if (!isScheduleId(input.id)) throw new AwakeError("invalid", "id must be a short lowercase id");
    const wait = input.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    if (!Number.isInteger(wait) || wait < MINUTE_MS || wait > MAX_WAIT_MS) {
      throw new AwakeError("invalid", "maxWaitMs must be 1 minute to 7 days");
    }
    if (typeof input.heavy !== "boolean")
      throw new AwakeError("invalid", "heavy must be true or false");
    if (this.running.has(input.id) || this.waiting.some((e) => e.id === input.id)) {
      throw new AwakeError("conflict", "A job with that id is already queued");
    }
    if (this.waiting.length >= MAX_QUEUED_JOBS) {
      throw new AwakeError("limit", `At most ${MAX_QUEUED_JOBS} jobs can wait`);
    }
    const now = this.o.clock.now();
    this.waiting.push({ id: input.id, heavy: input.heavy, queuedAt: now, deadline: now + wait });
    await this.pump();
  }

  /** Drops a waiting job or aborts a running one. Returns whether the id was known. */
  cancel(id: string): boolean {
    const at = this.waiting.findIndex((e) => e.id === id);
    if (at >= 0) {
      this.waiting.splice(at, 1);
      this.blocked.delete(id);
      this.finish(id, "cancelled");
      return true;
    }
    const controller = this.running.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /** Re-checks power now; the host calls this when the charger is plugged in. */
  pump(): Promise<void> {
    if (this.pumping) {
      this.again = true;
      return this.pumping;
    }
    const pass = this.drain().finally(() => {
      this.pumping = undefined;
    });
    this.pumping = pass;
    return pass;
  }

  snapshot(): QueueSnapshot {
    const now = this.o.clock.now();
    return {
      queued: this.waiting.map((e) => ({
        id: e.id,
        heavy: e.heavy,
        waitingFor: this.blocked.get(e.id) ?? null,
        waitedMs: now - e.queuedAt,
      })),
      running: [...this.running.keys()],
    };
  }

  /** Aborts running jobs, drops waiting ones (outcome `cancelled`) and stops the timer. */
  stop(): void {
    this.stopped = true;
    this.disarm();
    for (const entry of this.waiting.splice(0)) this.finish(entry.id, "cancelled");
    this.blocked.clear();
    for (const controller of this.running.values()) controller.abort();
  }

  private async drain(): Promise<void> {
    do {
      this.again = false;
      await this.pass();
    } while (this.again && !this.stopped);
    this.arm();
  }

  private async pass(): Promise<void> {
    this.disarm();
    const now = this.o.clock.now();
    for (const entry of [...this.waiting]) {
      if (entry.deadline <= now) this.drop(entry, "expired");
    }
    if (this.stopped || this.waiting.length === 0) return;
    const snapshot = await this.readPower();
    if (this.stopped) return;
    const limit = this.o.concurrency ?? 1;
    for (const entry of [...this.waiting]) {
      if (this.running.size >= limit) break;
      if (!this.waiting.includes(entry)) continue;
      const verdict = entry.heavy
        ? judgePower(
            {
              requireCharger: true,
              minBatteryPercent: 0,
              allowLowPowerMode: false,
            },
            snapshot,
            false,
          )
        : ({ allowed: true } as const);
      if (!verdict.allowed) {
        this.blocked.set(entry.id, verdict.reason);
        continue;
      }
      this.blocked.delete(entry.id);
      this.waiting.splice(this.waiting.indexOf(entry), 1);
      this.launch(entry);
    }
  }

  private async readPower() {
    try {
      return await this.o.power.read();
    } catch {
      return { battery: { kind: "unknown" } as const, lowPowerMode: null };
    }
  }

  private launch(entry: Entry): void {
    const controller = new AbortController();
    this.running.set(entry.id, controller);
    let outcome: QueueOutcome = "completed";
    let started: Promise<void>;
    try {
      started = this.o.run({ id: entry.id, heavy: entry.heavy }, controller.signal);
    } catch {
      started = Promise.reject(new Error("run threw"));
    }
    void started
      .catch(() => {
        outcome = "failed";
      })
      .then(() => {
        this.running.delete(entry.id);
        this.finish(entry.id, controller.signal.aborted ? "cancelled" : outcome);
        // A slot freed: the next waiting job may go.
        return this.stopped ? undefined : this.pump();
      });
  }

  private drop(entry: Entry, outcome: QueueOutcome): void {
    this.waiting.splice(this.waiting.indexOf(entry), 1);
    this.blocked.delete(entry.id);
    this.finish(entry.id, outcome);
  }

  private finish(id: string, outcome: QueueOutcome): void {
    try {
      this.o.settled(id, outcome);
    } catch {
      // A host callback that throws must not wedge the queue.
    }
  }

  private arm(): void {
    if (this.stopped || this.waiting.length === 0) return;
    const now = this.o.clock.now();
    const next = Math.min(now + QUEUE_RECHECK_MS, ...this.waiting.map((e) => e.deadline));
    this.timer = this.o.clock.setTimer(
      () => {
        this.timer = undefined;
        void this.pump();
      },
      Math.max(1, next - now),
    );
  }

  private disarm(): void {
    if (this.timer !== undefined) this.o.clock.clearTimer(this.timer);
    this.timer = undefined;
  }
}
