// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import { AwakeError, MAX_SESSION_MINUTES, type SessionStatus } from "../src";
import { rig, type Rig } from "../testing/ctx";
import { settle } from "../testing/fakes";

const MIN = 60_000;

async function started(r: Rig, minutes = 30): Promise<SessionStatus> {
  return (await r.call("start", { minutes })) as SessionStatus;
}

async function refusal(promise: Promise<unknown>): Promise<AwakeError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof AwakeError)) throw new Error("expected an AwakeError");
  return err;
}

describe("start / extend / end bounds", () => {
  it("starts a timed session: one hold with -t seconds, a started event, a status with ends_at", async () => {
    const r = await rig();
    const status = await started(r, 90);
    expect(r.sys.children).toHaveLength(1);
    expect(r.sys.children[0]?.file).toBe("caffeinate");
    expect(r.sys.children[0]?.args).toEqual(["-d", "-i", "-s", "-t", "5400"]);
    expect(status.active).toBe(true);
    expect(status.session?.ends_at).toBe(new Date(r.sys.clock.now() + 90 * MIN).toISOString());
    expect(status.session?.remaining_seconds).toBe(5400);
    const ev = r.fake.last("awake.session.started");
    expect(ev.payload).toMatchObject({ mode: "timed", minutes: 90, remaining_seconds: 5400 });
    expect(ev.correlation_id).toBe(ev.payload?.session_id);
  });

  it("accepts the 1 and 10080 boundaries and refuses one beyond", async () => {
    for (const ok of [1, MAX_SESSION_MINUTES]) {
      const r = await rig();
      await started(r, ok);
      expect(r.sys.alive).toHaveLength(1);
    }
    for (const bad of [0, MAX_SESSION_MINUTES + 1]) {
      const r = await rig();
      expect((await refusal(r.call("start", { minutes: bad }))).kind).toBe("invalid");
      expect(r.sys.children).toHaveLength(0);
    }
  });

  it("extend adds minutes, restarts the hold for the new total, and releases the old hold", async () => {
    const r = await rig();
    await started(r, 30);
    await r.sys.clock.advance(10 * MIN);
    const status = (await r.call("extend", { minutes: 60 })) as SessionStatus;
    expect(status.session?.remaining_seconds).toBe(80 * 60);
    expect(r.sys.children).toHaveLength(2);
    expect(r.sys.children[0]?.alive).toBe(false);
    expect(r.sys.children[1]?.args.at(-1)).toBe(String(80 * 60));
    expect(r.fake.last("awake.session.extended").payload).toMatchObject({ minutes: 60 });
  });

  it("extend is bounded: the total left never exceeds 10080 minutes, and a refused extend changes nothing", async () => {
    const r = await rig();
    await started(r, MAX_SESSION_MINUTES - 5);
    expect((await refusal(r.call("extend", { minutes: 6 }))).kind).toBe("limit");
    expect(r.sys.children).toHaveLength(1);
    expect(r.sys.alive).toHaveLength(1);
    const ok = (await r.call("extend", { minutes: 5 })) as SessionStatus;
    expect(ok.session?.remaining_seconds).toBe(MAX_SESSION_MINUTES * 60);
  });

  it("extend with no session is refused", async () => {
    const r = await rig();
    expect((await refusal(r.call("extend", { minutes: 5 }))).kind).toBe("no_session");
  });

  it("end releases, reports cancelled, and a second end is a no-op", async () => {
    const r = await rig();
    await started(r);
    const first = (await r.call("end")) as { ended: boolean; active: boolean };
    expect(first).toMatchObject({ ended: true, active: false });
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "cancelled" });
    const second = (await r.call("end")) as { ended: boolean };
    expect(second.ended).toBe(false);
    expect(r.fake.types().filter((t) => t === "awake.session.ended")).toHaveLength(1);
  });

  it("a second start is refused and leaves the first session untouched", async () => {
    const r = await rig();
    await started(r, 30);
    expect((await refusal(r.call("start", { minutes: 5 }))).kind).toBe("conflict");
    expect(r.sys.children).toHaveLength(1);
    expect(r.sys.alive).toHaveLength(1);
    expect(r.fake.types().filter((t) => t === "awake.session.started")).toHaveLength(1);
  });

  it("two starts racing spawn only one hold", async () => {
    const r = await rig();
    const results = await Promise.allSettled([
      r.module.commands?.start?.({ minutes: 5 }, r.fake.ctx),
      r.module.commands?.start?.({ minutes: 5 }, r.fake.ctx),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.sys.children).toHaveLength(1);
  });
});

describe("release on every path", () => {
  it("expiry releases the hold exactly once and says expired", async () => {
    const r = await rig();
    await started(r, 5);
    await r.sys.clock.advance(5 * MIN);
    expect(r.sys.alive).toHaveLength(0);
    expect(r.sys.children[0]?.killed).toBeLessThanOrEqual(1);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "expired" });
    expect(r.fake.types().filter((t) => t === "awake.session.ended")).toHaveLength(1);
    expect(r.sys.clock.pending).toBe(0);
  });

  it("the hold exiting by itself right at expiry is expiry, not a failure", async () => {
    const r = await rig();
    await started(r, 5);
    r.sys.clock.current += 5 * MIN;
    r.sys.children[0]?.exit(0);
    await settle();
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "expired" });
  });

  it("the hold dying early ends the session as inhibitor_lost with a warning", async () => {
    const r = await rig();
    await started(r, 30);
    r.sys.children[0]?.exit(1);
    await settle();
    const ev = r.fake.last("awake.session.ended");
    expect(ev.payload).toMatchObject({ reason: "inhibitor_lost" });
    expect(ev.severity).toBe("warning");
    expect((await r.call("status")) as SessionStatus).toMatchObject({ active: false });
    expect(r.sys.clock.pending).toBe(0);
  });

  it("disable (capability signal abort + shutdown) releases and says disabled", async () => {
    const r = await rig();
    await started(r);
    await r.disable();
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "disabled" });
    expect(r.fake.types().filter((t) => t === "awake.session.ended")).toHaveLength(1);
  });

  it("shutdown() alone (Core exit without an abort) releases", async () => {
    const r = await rig();
    await started(r);
    await r.module.shutdown?.(r.fake.ctx);
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "shutdown" });
  });

  it("an already-aborted signal at init leaves nothing running", async () => {
    const r = await rig();
    await started(r);
    r.fake.controller.abort();
    await settle();
    expect(r.sys.alive).toHaveLength(0);
  });

  it("the kill switch event ends the session", async () => {
    const r = await rig();
    await started(r);
    await r.feed.publish("security.kill_switch.engaged");
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "kill_switch" });
    expect(r.feed.subscribers).toBe(0);
  });

  it("a hold that cannot start refuses the start and leaves no session or timer", async () => {
    const r = await rig();
    r.sys.spawnThrows = true;
    expect((await refusal(r.call("start", { minutes: 5 }))).kind).toBe("unavailable");
    expect(r.sys.clock.pending).toBe(0);
    expect(r.fake.types()).toEqual([]);
    r.sys.spawnThrows = false;
    await started(r, 5);
    expect(r.sys.alive).toHaveLength(1);
  });

  it("a child that got no pid is killed and the start refused", async () => {
    const r = await rig();
    r.sys.noPid = true;
    expect((await refusal(r.call("start", { minutes: 5 }))).kind).toBe("unavailable");
    expect(r.sys.alive).toHaveLength(0);
  });

  it("enabling again releases a session left from the previous enable", async () => {
    const r = await rig();
    await started(r);
    await r.module.init?.(r.fake.ctx);
    expect(r.sys.alive).toHaveLength(0);
  });
});

describe("battery floor", () => {
  it("ends a session when on battery below the floor, and releases", async () => {
    const r = await rig({ reading: { kind: "battery", percent: 50, onBattery: true } });
    await started(r, 120);
    r.battery.reading = { kind: "battery", percent: 9, onBattery: true };
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(0);
    const ev = r.fake.last("awake.session.ended");
    expect(ev.payload).toMatchObject({ reason: "battery" });
    expect(ev.severity).toBe("warning");
  });

  it("does not end at exactly the floor, nor below it while plugged in", async () => {
    const r = await rig({ reading: { kind: "battery", percent: 50, onBattery: true } });
    await started(r, 120);
    r.battery.reading = { kind: "battery", percent: 10, onBattery: true };
    await r.sys.clock.advance(60_000);
    r.battery.reading = { kind: "battery", percent: 3, onBattery: false };
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(1);
  });

  it("refuses to start below the floor on battery", async () => {
    const r = await rig({ reading: { kind: "battery", percent: 8, onBattery: true } });
    expect((await refusal(r.call("start", { minutes: 5 }))).kind).toBe("battery_low");
    expect(r.sys.children).toHaveLength(0);
  });

  it("a desktop without a battery never trips the rule, however long it runs", async () => {
    const r = await rig({ reading: { kind: "none" } });
    await started(r, 600);
    await r.sys.clock.advance(300 * MIN);
    expect(r.sys.alive).toHaveLength(1);
  });

  it("unreadable level ends the session only after 3 consecutive reads", async () => {
    const r = await rig({ reading: { kind: "battery", percent: 80, onBattery: true } });
    await started(r, 600);
    r.battery.reading = { kind: "unknown" };
    await r.sys.clock.advance(60_000);
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(1);
    r.battery.reading = { kind: "battery", percent: 80, onBattery: true };
    await r.sys.clock.advance(60_000);
    r.battery.reading = { kind: "unknown" };
    await r.sys.clock.advance(60_000);
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(1);
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "battery" });
  });

  it("an unreadable start-time level counts as the first unknown read", async () => {
    const r = await rig({ reading: { kind: "unknown" } });
    await started(r, 600);
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(1);
    await r.sys.clock.advance(60_000);
    expect(r.sys.alive).toHaveLength(0);
  });

  it("battery_floor_percent in config moves the floor; out-of-range config falls back to 10", async () => {
    const high = await rig({
      config: { battery_floor_percent: 40 },
      reading: { kind: "battery", percent: 50, onBattery: true },
    });
    await started(high, 120);
    high.battery.reading = { kind: "battery", percent: 35, onBattery: true };
    await high.sys.clock.advance(60_000);
    expect(high.sys.alive).toHaveLength(0);

    const bad = await rig({
      config: { battery_floor_percent: 500 },
      reading: { kind: "battery", percent: 50, onBattery: true },
    });
    expect(((await bad.call("status")) as SessionStatus).battery_floor_percent).toBe(10);
  });

  it("stops polling the battery once the session is over", async () => {
    const r = await rig({ reading: { kind: "battery", percent: 80, onBattery: true } });
    await started(r, 5);
    await r.call("end");
    const reads = r.battery.reads;
    await r.sys.clock.advance(10 * MIN);
    expect(r.battery.reads).toBe(reads);
  });
});

describe("hostile input", () => {
  const rejected: [string, unknown][] = [
    ["NaN", { minutes: Number.NaN }],
    ["Infinity", { minutes: Number.POSITIVE_INFINITY }],
    ["negative", { minutes: -5 }],
    ["zero", { minutes: 0 }],
    ["fraction", { minutes: 1.5 }],
    ["huge", { minutes: 1e12 }],
    ["numeric string", { minutes: "30" }],
    ["missing", {}],
    ["null", { minutes: null }],
    ["boolean", { minutes: true }],
    ["array", { minutes: [30] }],
    ["unknown field", { minutes: 5, shell: "rm -rf /" }],
    ["reason number", { minutes: 5, reason: 7 }],
    ["reason empty", { minutes: 5, reason: "" }],
    ["reason too long", { minutes: 5, reason: "x".repeat(81) }],
    ["reason newline", { minutes: 5, reason: "a\nb" }],
    ["reason NUL", { minutes: 5, reason: "a\u0000b" }],
    ["reason bidi override", { minutes: 5, reason: "a\u202eb" }],
    ["reason zero-width", { minutes: 5, reason: "a\u200bb" }],
    ["bad mode", { minutes: 5, mode: "forever" }],
    ["not an object", "30"],
  ];
  it.each(rejected)("start refuses %s and spawns nothing", async (_name, input) => {
    const r = await rig();
    expect((await refusal(r.call("start", input))).kind).toBe("invalid");
    expect(r.sys.children).toHaveLength(0);
    expect(r.fake.events).toHaveLength(0);
  });

  it("extend refuses hostile minutes and does not touch the running hold", async () => {
    const r = await rig();
    await started(r);
    for (const minutes of [Number.NaN, -1, 0, 1e9, "5", null]) {
      expect((await refusal(r.call("extend", { minutes }))).kind).toBe("invalid");
    }
    expect(r.sys.children).toHaveLength(1);
    expect(r.sys.alive).toHaveLength(1);
  });

  it("end and status take no input", async () => {
    const r = await rig();
    expect((await refusal(r.call("end", { force: true }))).kind).toBe("invalid");
    expect((await refusal(r.call("status", { x: 1 }))).kind).toBe("invalid");
  });

  it("a reason with ordinary text, including quotes and unicode, is accepted and never reaches argv", async () => {
    const r = await rig();
    await r.call("start", { minutes: 5, reason: 'build "release" – café; $(whoami)' });
    expect(r.sys.children[0]?.args.join(" ")).not.toContain("whoami");
    expect(r.sys.children[0]?.args.join(" ")).not.toContain("café");
  });
});

describe("status", () => {
  it("shows only times, mode and the label; never pids, argv or paths", async () => {
    const r = await rig();
    await r.call("start", { minutes: 15, reason: "release build" });
    const text = JSON.stringify(await r.call("status"));
    expect(text).toContain("release build");
    expect(text).not.toContain("caffeinate");
    expect(text).not.toContain(String(r.sys.children[0]?.pid));
    expect(text).not.toMatch(/\/Users|\/home|C:\\\\/);
  });

  it("counts down from the clock and never goes negative", async () => {
    const r = await rig();
    await started(r, 10);
    await r.sys.clock.advance(4 * MIN);
    expect(((await r.call("status")) as SessionStatus).session?.remaining_seconds).toBe(6 * 60);
  });

  it("events carry no pid or command line", async () => {
    const r = await rig();
    await r.call("start", { minutes: 15 });
    await r.call("end");
    expect(JSON.stringify(r.fake.events)).not.toMatch(/caffeinate|pid|4000/);
  });
});

describe("manifest", () => {
  it("start/extend/end are execute (confirmation each time), status is read, only shell_command", async () => {
    const r = await rig();
    const m = r.module.manifest;
    const effects = Object.fromEntries(m.commands.map((c) => [c.name, c.side_effect]));
    expect(effects).toEqual({
      start: "execute",
      extend: "execute",
      end: "execute",
      status: "read",
    });
    expect(m.permissions).toEqual(["shell_command"]);
    expect(m.events).toEqual([
      "awake.session.started",
      "awake.session.extended",
      "awake.session.ended",
    ]);
    expect(m.state_rules).toBeUndefined();
  });
});
