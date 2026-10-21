// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real TCP probe on fake lookups/sockets and a fake deadline timer: no DNS, no socket, no wait.
import { describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_LOOKUPS,
  createTcpProbe,
  type ProbeIo,
  type ProbeSocket,
} from "../../src/continuity";
import { settle } from "../../testing/fakes";

class FakeSocket implements ProbeSocket {
  destroyed = false;
  timeoutMs: number | undefined;
  private handlers = new Map<string, () => void>();

  constructor(readonly target: { host: string; port: number }) {}

  once(event: "connect" | "error" | "timeout", listener: () => void): this {
    this.handlers.set(event, listener);
    return this;
  }

  setTimeout(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  emit(event: "connect" | "error" | "timeout"): void {
    this.handlers.get(event)?.();
  }
}

/** Lookups stay pending until the test resolves them; sockets are recorded. */
class FakeIo implements ProbeIo {
  readonly lookups: { host: string; settle: PromiseWithResolvers<{ address: string }> }[] = [];
  readonly sockets: FakeSocket[] = [];
  active = 0;
  peak = 0;

  lookup(host: string): Promise<{ address: string }> {
    const entry = { host, settle: Promise.withResolvers<{ address: string }>() };
    this.lookups.push(entry);
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    const finish = () => void (this.active -= 1);
    entry.settle.promise.then(finish, finish);
    return entry.settle.promise;
  }

  connect(opts: { host: string; port: number }): FakeSocket {
    const socket = new FakeSocket(opts);
    this.sockets.push(socket);
    return socket;
  }
}

/** A deadline the test fires by hand. */
function fakeTimer() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    timers,
    setTimer(fn: () => void, ms: number): number {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(handle: unknown): void {
      if (typeof handle === "number") timers.delete(handle);
    },
    fire(): void {
      for (const [id, t] of [...timers]) {
        timers.delete(id);
        t.fn();
      }
    },
  };
}

const host = (name: string, port = 443) => ({ host: name, port });

function probeOn(io: FakeIo, timer = fakeTimer(), timeoutMs = 3_000) {
  return {
    timer,
    probe: createTcpProbe({
      timeoutMs,
      io,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    }),
  };
}

describe("createTcpProbe", () => {
  it("an empty host list never claims an outage and touches nothing", async () => {
    const io = new FakeIo();
    expect(await probeOn(io).probe([])).toBe(true);
    expect(io.lookups).toEqual([]);
  });

  it("a host that accepts the connection makes the network up; sockets are destroyed", async () => {
    const io = new FakeIo();
    const { probe } = probeOn(io);
    const result = probe([host("a.test")]);
    await settle();
    io.lookups[0]?.settle.resolve({ address: "192.0.2.1" });
    await settle();
    expect(io.sockets.map((s) => s.target)).toEqual([{ host: "192.0.2.1", port: 443 }]);
    io.sockets[0]?.emit("connect");
    expect(await result).toBe(true);
    expect(io.sockets[0]?.destroyed).toBe(true);
  });

  it("limits each socket with setTimeout(timeoutMs) and a socket timeout means not reachable", async () => {
    const io = new FakeIo();
    const { probe } = probeOn(io, fakeTimer(), 1_234);
    const result = probe([host("a.test")]);
    await settle();
    io.lookups[0]?.settle.resolve({ address: "192.0.2.1" });
    await settle();
    expect(io.sockets[0]?.timeoutMs).toBe(1_234);
    io.sockets[0]?.emit("timeout");
    expect(await result).toBe(false);
    expect(io.sockets[0]?.destroyed).toBe(true);
  });

  it("a hung lookup is not repeated by the next round, which counts the host as unreachable", async () => {
    const io = new FakeIo();
    const { probe, timer } = probeOn(io);
    const first = probe([host("hung.test")]);
    await settle();
    expect(io.lookups).toHaveLength(1);
    timer.fire(); // deadline passes while the lookup hangs
    expect(await first).toBe(false);

    for (let round = 0; round < 3; round++) {
      expect(await probe([host("hung.test")])).toBe(false);
    }
    expect(io.lookups).toHaveLength(1); // no second lookup for that host

    io.lookups[0]?.settle.reject(new Error("late"));
    await settle();
    const after = probe([host("hung.test")]);
    await settle();
    expect(io.lookups).toHaveLength(2); // the pending one finished: the host is probed again
    timer.fire();
    await after;
  });

  it("another host is still probed while one is hung", async () => {
    const io = new FakeIo();
    const { probe } = probeOn(io);
    const first = probe([host("hung.test")]);
    await settle();
    const second = probe([host("hung.test"), host("ok.test")]);
    await settle();
    // hung.test is skipped (its lookup is pending); ok.test is looked up.
    expect(io.lookups.map((l) => l.host)).toEqual(["hung.test", "ok.test"]);
    io.lookups[1]?.settle.resolve({ address: "192.0.2.9" });
    await settle();
    io.sockets[0]?.emit("connect");
    expect(await second).toBe(true);
    io.lookups[0]?.settle.reject(new Error("done"));
    expect(await first).toBe(false);
  });

  it("a lookup that resolves after the deadline opens no socket and the result stays false", async () => {
    const io = new FakeIo();
    const { probe, timer } = probeOn(io);
    const result = probe([host("slow.test")]);
    await settle();
    timer.fire();
    expect(await result).toBe(false);
    io.lookups[0]?.settle.resolve({ address: "192.0.2.5" });
    await settle();
    expect(io.sockets).toEqual([]);
  });

  it("a connect still pending at the deadline is destroyed and never flips the result", async () => {
    const io = new FakeIo();
    const { probe, timer } = probeOn(io);
    const result = probe([host("slow.test")]);
    await settle();
    io.lookups[0]?.settle.resolve({ address: "192.0.2.5" });
    await settle();
    timer.fire();
    expect(await result).toBe(false);
    expect(io.sockets[0]?.destroyed).toBe(true);
    io.sockets[0]?.emit("connect");
    expect(await result).toBe(false);
  });

  it("never runs more than MAX_CONCURRENT_LOOKUPS lookups at once across the hosts of one call", async () => {
    const io = new FakeIo();
    const { probe } = probeOn(io);
    const hosts = ["a", "b", "c", "d", "e"].map((n) => host(`${n}.test`));
    expect(hosts.length).toBeGreaterThan(MAX_CONCURRENT_LOOKUPS);
    const result = probe(hosts);
    await settle();
    expect(io.lookups).toHaveLength(MAX_CONCURRENT_LOOKUPS);
    io.lookups[0]?.settle.reject(new Error("nxdomain"));
    await settle();
    expect(io.lookups).toHaveLength(MAX_CONCURRENT_LOOKUPS + 1); // the freed slot goes to host 5
    for (const l of io.lookups.slice(1)) l.settle.reject(new Error("nxdomain"));
    expect(await result).toBe(false);
    expect(io.peak).toBeLessThanOrEqual(MAX_CONCURRENT_LOOKUPS);
  });
});
