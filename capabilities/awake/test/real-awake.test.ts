// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The ONLY test that touches the real machine: a real `caffeinate -t 20` on macOS, checked with the
// read-only `pmset -g assertions`. Skipped unless PHOENIX_REAL_AWAKE=1 (and only on macOS).
import { describe, expect, it } from "vitest";
import { createInhibitor, realEnv, realRunner } from "../src";

const enabled = process.env.PHOENIX_REAL_AWAKE === "1" && process.platform === "darwin";

/** pids that own a sleep-preventing assertion, from `pmset -g assertions`. */
async function assertionOwners(): Promise<Map<number, string>> {
  const out = await realRunner("pmset", ["-g", "assertions"], { timeoutMs: 10_000 });
  expect(out.code).toBe(0);
  const owners = new Map<number, string>();
  for (const m of out.stdout.matchAll(
    /pid (\d+)\(([^)]*)\):[^\n]*?(PreventUserIdleSystemSleep|NoIdleSleepAssertion|PreventSystemSleep|NoDisplaySleepAssertion|PreventUserIdleDisplaySleep)/g,
  )) {
    owners.set(Number(m[1]), `${m[2]}:${m[3]}`);
  }
  return owners;
}

/**
 * Real delay on purpose: this opt-in test waits for the real OS to publish or drop a power
 * assertion, which no fake clock can drive. It runs only with PHOENIX_REAL_AWAKE=1.
 */
function realDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function until(check: () => Promise<boolean>, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    await realDelay(250);
  }
  return false;
}

describe.skipIf(!enabled)("real caffeinate (PHOENIX_REAL_AWAKE=1, macOS only)", () => {
  it("holds a sleep assertion owned by its pid, and releases it on end", async () => {
    const hold = createInhibitor(realEnv()).acquire(20);
    const pid = hold.pid;
    try {
      expect(pid).toBeGreaterThan(0);
      const held = await until(async () => (await assertionOwners()).has(pid ?? -1));
      const owners = await assertionOwners();
      console.log("assertion owners while held:", JSON.stringify([...owners]));
      expect(held).toBe(true);
      expect(owners.get(pid ?? -1)).toMatch(/^caffeinate:/);
    } finally {
      hold.release();
    }
    await Promise.race([hold.exited, realDelay(5_000)]);
    const gone = await until(async () => !(await assertionOwners()).has(pid ?? -1), 20);
    console.log("assertion released:", gone);
    expect(gone).toBe(true);
    expect(() => process.kill(pid ?? -1, 0)).toThrow();
  }, 30_000);
});
