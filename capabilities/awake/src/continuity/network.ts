// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Network watch: decides "network down" from a probe of hosts the USER chose (none by default).
// The detector is pure: N consecutive failed probes flip it to down, the first success flips it
// back, and each flip is reported exactly once. The default probe resolves the name and opens a
// TCP connection with a 3 s limit; it sends nothing and reads nothing.
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import type { AwakeClock, TimerHandle } from "../system";
import type { ProbeHost } from "./config";

export const PROBE_TIMEOUT_MS = 3_000;

/** Resolves true when at least one host accepted a connection. Never rejects. */
export type NetworkProbe = (hosts: readonly ProbeHost[]) => Promise<boolean>;

export type OutageTransition =
  { kind: "down"; at: number; failingSince: number } | { kind: "up"; at: number; outageMs: number };

/** N consecutive failures → down (once); one success → up (once). Flapping below N never fires. */
export class OutageDetector {
  private failures = 0;
  private failingSince: number | null = null;
  private downSince: number | null = null;

  constructor(private readonly required: number) {}

  get down(): boolean {
    return this.downSince !== null;
  }

  get since(): number | null {
    return this.downSince;
  }

  observe(reachable: boolean, now: number): OutageTransition | null {
    if (reachable) {
      const started = this.failingSince;
      this.failures = 0;
      this.failingSince = null;
      if (this.downSince === null) return null;
      this.downSince = null;
      return { kind: "up", at: now, outageMs: Math.max(0, now - (started ?? now)) };
    }
    this.failures += 1;
    this.failingSince ??= now;
    if (this.downSince === null && this.failures >= this.required) {
      this.downSince = now;
      return { kind: "down", at: now, failingSince: this.failingSince };
    }
    return null;
  }

  reset(): void {
    this.failures = 0;
    this.failingSince = null;
    this.downSince = null;
  }
}

/** Lookups running at once inside one probe call (a probe has at most 5 hosts). */
export const MAX_CONCURRENT_LOOKUPS = 4;

/** The part of a socket the probe uses; `node:net`'s Socket satisfies it. */
export interface ProbeSocket {
  once(event: "connect" | "error" | "timeout", listener: () => void): unknown;
  setTimeout(ms: number): unknown;
  destroy(): unknown;
}

/** Low-level network seam: the default is node:dns/promises + node:net; tests inject fakes. */
export interface ProbeIo {
  lookup(host: string): Promise<{ address: string }>;
  connect(opts: { host: string; port: number }): ProbeSocket;
}

export interface TcpProbeOptions {
  timeoutMs?: number;
  io?: ProbeIo;
  /** Deadline timer. Default: the global setTimeout. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

/** At most MAX_CONCURRENT_LOOKUPS holders; `cancel` frees every waiter with `false`. */
class LookupSlots {
  private active = 0;
  private cancelled = false;
  private waiters: PromiseWithResolvers<boolean>[] = [];

  async acquire(): Promise<boolean> {
    if (this.cancelled) return false;
    if (this.active < MAX_CONCURRENT_LOOKUPS) {
      this.active += 1;
      return true;
    }
    const waiter = Promise.withResolvers<boolean>();
    this.waiters.push(waiter);
    return waiter.promise;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next.resolve(true); // the slot passes straight to the waiter
    else this.active -= 1;
  }

  cancel(): void {
    this.cancelled = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve(false);
  }
}

/** One probe call: closed once a host answered, or at the deadline. */
interface Round {
  closed: boolean;
  closing: PromiseWithResolvers<void>;
  slots: LookupSlots;
  io: ProbeIo;
  timeoutMs: number;
}

/** Resolve + connect to one host. Resolves false on any error, timeout or when the round closes. */
async function reachable(host: ProbeHost, round: Round): Promise<boolean> {
  if (!(await round.slots.acquire())) return false;
  let address: string;
  try {
    ({ address } = await round.io.lookup(host.host));
  } catch {
    return false;
  } finally {
    round.slots.release();
  }
  // A lookup that resolved after the deadline must not open a socket.
  if (round.closed) return false;
  const done = Promise.withResolvers<boolean>();
  const socket = round.io.connect({ host: address, port: host.port });
  try {
    socket.once("connect", () => done.resolve(true));
    socket.once("error", () => done.resolve(false));
    socket.once("timeout", () => done.resolve(false));
    socket.setTimeout(round.timeoutMs);
    void round.closing.promise.then(() => done.resolve(false));
    return await done.promise;
  } finally {
    socket.destroy();
  }
}

/**
 * The real probe: any one reachable host means the network is up. A host whose previous lookup or
 * connect is still pending is skipped (counts as not reachable) so a hung resolver cannot pile
 * up lookups round after round; a probe instance owns that bookkeeping.
 */
export function createTcpProbe(options: TcpProbeOptions = {}): NetworkProbe {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const io: ProbeIo = options.io ?? { lookup, connect };
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const inFlight = new Set<string>();
  return async (hosts) => {
    if (hosts.length === 0) return true; // nothing chosen: never claim an outage
    const round: Round = {
      closed: false,
      closing: Promise.withResolvers<void>(),
      slots: new LookupSlots(),
      io,
      timeoutMs,
    };
    const close = () => {
      round.closed = true;
      round.slots.cancel();
      round.closing.resolve();
    };
    const verdict = Promise.withResolvers<boolean>();
    const timer = setTimer(close, timeoutMs);
    let remaining = hosts.length;
    for (const host of hosts) {
      const key = `${host.host}:${host.port}`;
      let attempt: Promise<boolean>;
      if (inFlight.has(key)) {
        attempt = Promise.resolve(false); // its previous attempt is still pending: do not pile up
      } else {
        inFlight.add(key);
        attempt = reachable(host, round)
          .catch(() => false)
          .finally(() => inFlight.delete(key));
      }
      // The verdict never waits past the deadline, even if a lookup is still hanging.
      void Promise.race([attempt, round.closing.promise.then(() => false)]).then((ok) => {
        if (ok) verdict.resolve(true);
        else if (--remaining === 0) verdict.resolve(false);
      });
    }
    try {
      return await verdict.promise;
    } finally {
      clearTimer(timer);
      close();
    }
  };
}

export interface NetworkWatchOptions {
  clock: AwakeClock;
  probe: NetworkProbe;
  hosts: readonly ProbeHost[];
  intervalMs: number;
  failuresRequired: number;
  onTransition: (transition: OutageTransition) => void;
  /** Called after each probe with the result (not after skipped ticks). */
  onSample?: (reachable: boolean) => void;
}

export class NetworkWatch {
  readonly detector: OutageDetector;
  private timer: TimerHandle | undefined;
  private generation = 0;
  private busy = false;
  private running = false;

  constructor(private readonly o: NetworkWatchOptions) {
    this.detector = new OutageDetector(o.failuresRequired);
  }

  start(): void {
    if (this.running || this.o.hosts.length === 0) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer !== undefined) this.o.clock.clearTimer(this.timer);
    this.timer = undefined;
    this.detector.reset();
  }

  private schedule(): void {
    this.timer = this.o.clock.setTimer(() => void this.tick(), this.o.intervalMs);
  }

  /** One probe cycle; exposed so a test (or a "check now") can drive it. */
  async tick(): Promise<void> {
    if (!this.running || this.busy) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const ok = await this.o.probe(this.o.hosts).catch(() => false);
      if (generation !== this.generation) return;
      const transition = this.detector.observe(ok, this.o.clock.now());
      this.o.onSample?.(ok);
      if (transition) this.o.onTransition(transition);
    } finally {
      this.busy = false;
    }
    if (generation === this.generation) this.schedule();
  }
}
