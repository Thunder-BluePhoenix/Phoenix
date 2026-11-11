// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The CHILD process of `real-awake-kill.test.ts` (PHOENIX_REAL_AWAKE=1, macOS only). It is bundled
// with esbuild into a temp dir and run as its own Node process, so the test can SIGKILL it. It
// stands in for Core: it runs the production `SessionController` and `createInhibitor(realEnv())`
// (`env.pid` is this process's pid, so the real `caffeinate` gets `-w <this pid>` exactly as in
// Core) and reports JSON lines on stdout. The parent sends "go\n" on stdin to trigger an action.
import { spawn } from "node:child_process";
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

const mode = process.argv[2] ?? "";

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const env = realEnv();
const inner = createInhibitor(env);
let lastHold: InhibitHandle | undefined;
// A pass-through that only remembers the handle, so the parent can learn the real caffeinate pid.
const inhibitor: Inhibitor = {
  parentBound: inner.parentBound,
  acquire(seconds) {
    lastHold = inner.acquire(seconds);
    return lastHold;
  },
};

// "session-expiry" needs a session of at least one minute (the controller's minimum). Its timers
// run 60 times faster than real time so the real expiry path runs in about a second; `now()` and
// the real caffeinate `-t` are untouched.
const SPEEDUP = 60;
const fastClock: AwakeClock = {
  now: () => realClock.now(),
  setTimer: (fn, ms) => realClock.setTimer(fn, Math.max(1, Math.floor(ms / SPEEDUP))),
  clearTimer: (handle) => realClock.clearTimer(handle),
};

const controller = new SessionController({
  clock: mode === "session-expiry" ? fastClock : env.clock,
  inhibitor,
  battery: createBatteryReader(env),
  floor: 10,
  batteryPollMs: 60_000,
  feed: undefined,
  emit(type, fields) {
    send({ event: "emit", type, reason: fields.reason ?? null });
  },
  newId: () => `awk_real_${process.pid}`,
});

let rawHold: InhibitHandle | undefined;

async function main(): Promise<void> {
  switch (mode) {
    case "no-w-control": {
      // NOT production code: a caffeinate WITHOUT -w, to show the parent's check can see a leak.
      const child = spawn("caffeinate", ["-d", "-i", "-t", "30"], { stdio: "ignore" });
      send({ event: "started", childPid: process.pid, holdPid: child.pid ?? null });
      break;
    }
    case "hold-release":
    case "hold-expiry":
      rawHold = inner.acquire(mode === "hold-expiry" ? 2 : 300);
      send({ event: "started", childPid: process.pid, holdPid: rawHold.pid ?? null });
      break;
    default:
      await controller.start("timed", 5, "real-awake-kill test");
      send({ event: "started", childPid: process.pid, holdPid: lastHold?.pid ?? null });
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  if (!chunk.includes("go")) return;
  if (mode === "hold-release") rawHold?.release();
  else if (mode === "cancel") controller.end("cancelled");
  else if (mode === "shutdown") controller.shutdown();
  send({ event: "done" });
});

// Nothing in a failed run may outlive the test.
setTimeout(() => process.exit(3), 90_000);

main().catch((error: unknown) => {
  send({ event: "error", message: error instanceof Error ? error.message : String(error) });
  process.exit(2);
});
