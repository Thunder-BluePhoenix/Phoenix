// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// An active manual or Pomodoro focus session survives a Core restart on the same database, resumed
// from its stored absolute end instant under an injected clock. No real timer or OS call is used.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FOCUS_SESSION_KEY, type FocusClock } from "../src/focus";
import { connect, event, startCore, type HubClient, type TestCore } from "./helpers";

const T0 = 1_800_000_000_000;
const MINUTE = 60_000;

/** A clock the test moves by hand; timers fire only through `advance`. */
function fakeClock(start = T0) {
  let now = start;
  const timers: { id: number; at: number; callback: () => void }[] = [];
  let nextId = 1;
  const clock: FocusClock = {
    now: () => now,
    setTimeout: (callback, milliseconds) => {
      const id = nextId++;
      timers.push({ id, at: now + milliseconds, callback });
      return id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index !== -1) timers.splice(index, 1);
    },
  };
  return {
    clock,
    pending: () => timers.map((timer) => timer.at - now),
    advance(milliseconds: number) {
      now += milliseconds;
      for (const timer of timers.filter((candidate) => candidate.at <= now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
    },
  };
}

const cores: TestCore[] = [];
const sockets: HubClient[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.ws.close();
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "phoenix-focus-"));
  directories.push(directory);
  return join(directory, "core.sqlite");
}

async function boot(databasePath: string, clock: FocusClock): Promise<TestCore> {
  const core = await startCore({}, { runtime: { databasePath, focus: { clock } } });
  cores.push(core);
  return core;
}

async function restart(core: TestCore, databasePath: string, clock: FocusClock) {
  await core.runtime.stop();
  cores.splice(cores.indexOf(core), 1);
  return boot(databasePath, clock);
}

const stored = (core: TestCore) => core.runtime.settings.get<unknown>(FOCUS_SESSION_KEY, null);

describe("focus survives a Core restart", () => {
  it("restores a Pomodoro with the remaining time, not a fresh full duration, and expires on time", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    expect((await first.api("POST", "/api/focus", { minutes: 25 })).json).toMatchObject({
      manual: true,
      remainingMs: 25 * MINUTE,
    });
    expect(stored(first)).toEqual({ v: 1, mode: "pomodoro", endsAt: T0 + 25 * MINUTE });

    time.advance(10 * MINUTE);
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toEqual({
      manual: true,
      osDnd: null,
      active: true,
      remainingMs: 15 * MINUTE,
      held: 0,
    });
    // The restored timer fires at the original instant, not 25 minutes after the restart.
    expect(time.pending()).toEqual([15 * MINUTE]);

    time.advance(15 * MINUTE);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({
      manual: false,
      active: false,
      remainingMs: null,
    });
    expect(stored(second)).toBeNull();

    const third = await restart(second, databasePath, time.clock);
    expect((await third.api("GET", "/api/focus")).json).toMatchObject({ manual: false });
  });

  it("restores an untimed manual session", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    await first.api("POST", "/api/focus", {});
    expect(stored(first)).toEqual({ v: 1, mode: "manual", endsAt: null });
    time.advance(3 * 24 * 60 * MINUTE);
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({
      manual: true,
      active: true,
      remainingMs: null,
    });
    expect(time.pending()).toEqual([]);
  });

  it("does not restore a session that ended while Core was down, and clears it", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    await first.api("POST", "/api/focus", { minutes: 5 });
    time.advance(5 * MINUTE);
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({
      manual: false,
      active: false,
      remainingMs: null,
    });
    expect(stored(second)).toBeNull();
    expect(time.pending()).toEqual([]);
  });

  it.each([
    ["a string", "focus please"],
    ["an array", [1, "pomodoro", T0 + MINUTE]],
    ["an unknown version", { v: 2, mode: "manual", endsAt: null }],
    ["an unknown mode", { v: 1, mode: "deep", endsAt: null }],
    ["a missing end", { v: 1, mode: "pomodoro" }],
    ["a timed manual session", { v: 1, mode: "manual", endsAt: T0 + MINUTE }],
    ["an untimed Pomodoro", { v: 1, mode: "pomodoro", endsAt: null }],
    ["a string end", { v: 1, mode: "pomodoro", endsAt: String(T0 + MINUTE) }],
    ["an end beyond one day", { v: 1, mode: "pomodoro", endsAt: T0 + 25 * 60 * MINUTE }],
    ["an extra field", { v: 1, mode: "manual", endsAt: null, held: ["x"] }],
    ["a prototype key", JSON.parse('{"v":1,"mode":"manual","endsAt":null,"__proto__":{"x":1}}')],
  ])("ignores and clears %s in the store", async (_name, value) => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    first.runtime.settings.set(FOCUS_SESSION_KEY, value);
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({
      manual: false,
      active: false,
    });
    expect(stored(second)).toBeNull();
    expect(time.pending()).toEqual([]);
  });

  it("ignores and clears a stored value that is not even JSON", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    first.runtime.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(FOCUS_SESSION_KEY, "{not json");
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({ manual: false });
    expect(
      second.runtime.db
        .prepare("SELECT count(*) AS n FROM settings WHERE key = ?")
        .get(FOCUS_SESSION_KEY),
    ).toMatchObject({ n: 0 });
  });

  it("stop clears the stored session so it does not return after another restart", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    await first.api("POST", "/api/focus", { minutes: 30 });
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({ manual: true });
    expect((await second.api("DELETE", "/api/focus")).json).toMatchObject({ manual: false });
    expect(stored(second)).toBeNull();
    const third = await restart(second, databasePath, time.clock);
    expect((await third.api("GET", "/api/focus")).json).toMatchObject({
      manual: false,
      active: false,
    });
  });

  it("starting again replaces the stored session with the new end instant", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    await first.api("POST", "/api/focus", { minutes: 30 });
    time.advance(MINUTE);
    await first.api("POST", "/api/focus", { minutes: 10 });
    expect(stored(first)).toEqual({ v: 1, mode: "pomodoro", endsAt: T0 + 11 * MINUTE });
    await first.api("POST", "/api/focus", {});
    expect(stored(first)).toEqual({ v: 1, mode: "manual", endsAt: null });
  });

  it("still delivers requires_action and errors while the restored focus holds ordinary notifications", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    await first.api("POST", "/api/focus", { minutes: 25 });
    const second = await restart(first, databasePath, time.clock);

    const socket = connect(second.port);
    sockets.push(socket);
    await socket.opened;
    socket.send({ type: "subscribe", channels: ["notification.created"] });
    await socket.next((m) => m.type === "subscribed");

    await second.api("POST", "/api/events", event("build.warning", { severity: "warning" }));
    await second.runtime.bus.drain();
    expect(socket.messages.filter((m) => m.channel === "notification.created")).toEqual([]);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({ held: 1 });
    // Durable history is untouched by focus.
    expect((await second.api("GET", "/api/notifications")).json.unread).toBe(1);

    await second.api(
      "POST",
      "/api/events",
      event("security.confirmation.requested", { severity: "warning", requires_action: true }),
    );
    const approval = await socket.next((m) => m.channel === "notification.created");
    expect(approval.data.payload.notification).toMatchObject({
      eventType: "security.confirmation.requested",
    });

    await second.api("POST", "/api/events", event("build.failed", { severity: "error" }));
    const failure = await socket.next((m) => m.channel === "notification.created");
    expect(failure.data.payload.notification).toMatchObject({ eventType: "build.failed" });

    // The restored timer ends the session and releases what was held after the restart.
    time.advance(25 * MINUTE);
    const released = await socket.next((m) => m.channel === "notification.created");
    expect(released.data.payload.notification).toMatchObject({ eventType: "build.warning" });
  });

  it("does not carry held notifications across a restart; they remain in durable history", async () => {
    const databasePath = database();
    const time = fakeClock();
    const first = await boot(databasePath, time.clock);
    await first.api("POST", "/api/focus", {});
    await first.api("POST", "/api/events", event("build.warning", { severity: "warning" }));
    await first.runtime.bus.drain();
    expect((await first.api("GET", "/api/focus")).json).toMatchObject({ held: 1 });
    const second = await restart(first, databasePath, time.clock);
    expect((await second.api("GET", "/api/focus")).json).toMatchObject({ manual: true, held: 0 });
    expect((await second.api("GET", "/api/notifications")).json.unread).toBe(1);
  });

  it("keeps the focus routes behind the session token", async () => {
    const databasePath = database();
    const core = await boot(databasePath, fakeClock().clock);
    expect((await core.api("GET", "/api/focus", undefined, { authorization: "" })).status).toBe(
      401,
    );
  });
});
