// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The CHILD process of the manual Linux harness (core/persistence/test/real-linux/run-in-container.sh).
// It stands in for Core: the production `SessionController` + `createInhibitor(realEnv())`, so the
// real `systemd-inhibit` is started exactly as in Core. It prints JSON lines on stdout: `started`
// with its own pid, and one `hold` line each time the controller swaps the hold.
// Modes: "plain" (1-minute timed session, the controller's minimum) and "renew" (a 60-minute timed
// session whose timers run 60 times faster, so the 15-minute renewal fires after 15 s; `now()` and
// the `sleep N` that systemd-inhibit runs stay real time). stdin "cancel" or "shutdown" ends the
// session through the controller. NOT run by vitest.
import {
  SessionController,
  createBatteryReader,
  createInhibitor,
  realClock,
  realEnv,
  type AwakeClock,
  type InhibitHandle,
  type Inhibitor,
} from "../../src";

const mode = process.argv[2] ?? "plain";
const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(m)}\n`);

const env = realEnv();
const inner = createInhibitor(env);
const inhibitor: Inhibitor = {
  parentBound: inner.parentBound,
  acquire(seconds) {
    const hold: InhibitHandle = inner.acquire(seconds);
    send({ event: "hold", holdPid: hold.pid ?? null, seconds });
    return hold;
  },
};

const SPEEDUP = 60;
const fastClock: AwakeClock = {
  now: () => realClock.now(),
  setTimer: (fn, ms) => realClock.setTimer(fn, Math.max(1, Math.floor(ms / SPEEDUP))),
  clearTimer: (handle) => realClock.clearTimer(handle),
};

const controller = new SessionController({
  clock: mode === "renew" ? fastClock : env.clock,
  inhibitor,
  battery: createBatteryReader(env),
  floor: 10,
  batteryPollMs: 60_000,
  feed: undefined,
  emit(type, fields) {
    send({ event: "emit", type, reason: fields.reason ?? null });
  },
  newId: () => `awk_real_linux_${process.pid}`,
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  if (chunk.includes("cancel")) controller.end("cancelled");
  else if (chunk.includes("shutdown")) controller.shutdown();
  send({ event: "done" });
});
setTimeout(() => process.exit(3), 300_000);

controller
  .start("timed", mode === "renew" ? 60 : 1, "real-linux test")
  .then(() => send({ event: "started", hostPid: process.pid, mode }))
  .catch((error: unknown) => {
    send({ event: "error", message: error instanceof Error ? error.message : String(error) });
    process.exit(2);
  });
