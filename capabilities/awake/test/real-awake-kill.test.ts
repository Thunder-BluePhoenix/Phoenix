// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Real-OS test of what happens to the macOS hold when the process that owns it goes away.
// Skipped unless PHOENIX_REAL_AWAKE=1 on macOS. It spawns a CHILD Node process (bundled with esbuild
// into a temp dir) that runs the production SessionController + createInhibitor(realEnv()), so the
// real `caffeinate` gets `-w <child pid>` exactly as it does under Core. The parent finds the
// caffeinate pid, confirms a power assertion owned by THAT pid in `pmset -g assertions` (read-only),
// ends the child in one of several ways and measures how long until the caffeinate process and the
// assertion are gone (polled every 50 ms, up to 5 s). Only "gone within 5 s" is asserted; the times
// are recorded. If PHOENIX_REAL_AWAKE_EVIDENCE names a file, the raw record is written there.
// No model, agent or user settings are touched; only `caffeinate`, `pmset -g assertions`, `ps`, `pgrep`.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.PHOENIX_REAL_AWAKE === "1" && process.platform === "darwin";
const GONE_WITHIN_MS = 5_000;
const POLL_MS = 50;
const REPETITIONS = 5;
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CHILD_SOURCE = fileURLToPath(new URL("./support/real-awake-child.ts", import.meta.url));

/** Real delay on purpose: the OS publishes and drops assertions on its own time; no fake clock can drive it. */
function realDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function exec(file: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; stdout: string }>();
  execFile(file, args, { timeout: 15_000 }, (err, stdout) => {
    const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
    resolve({ code, stdout: String(stdout) });
  });
  return promise;
}

/** pid -> assertion types owned by that pid, from `pmset -g assertions`. */
async function assertionTypes(): Promise<Map<number, Set<string>>> {
  const out = await exec("pmset", ["-g", "assertions"]);
  expect(out.code).toBe(0);
  const owners = new Map<number, Set<string>>();
  for (const m of out.stdout.matchAll(
    /pid (\d+)\([^)]*\):[^\n]*?(PreventUserIdleSystemSleep|NoIdleSleepAssertion|PreventSystemSleep|NoDisplaySleepAssertion|PreventUserIdleDisplaySleep)/g,
  )) {
    const pid = Number(m[1]);
    const set = owners.get(pid) ?? new Set<string>();
    set.add(m[2] ?? "");
    owners.set(pid, set);
  }
  return owners;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function caffeinatePids(): Promise<number[]> {
  const out = await exec("pgrep", ["-x", "caffeinate"]);
  return out.stdout
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Resolves with ms (since `t0`) at which `check` first returned true, or null after `limitMs`. */
async function firstTrue(
  check: () => boolean | Promise<boolean>,
  t0: number,
  limitMs: number,
): Promise<number | null> {
  for (;;) {
    if (await check()) return Math.round(performance.now() - t0);
    if (performance.now() - t0 > limitMs) return null;
    await realDelay(POLL_MS);
  }
}

interface Line {
  event: string;
  [key: string]: unknown;
}

interface Child {
  proc: ChildProcess;
  pid: number;
  lines: Line[];
  waitFor(event: string, ms?: number): Promise<Line>;
  send(text: string): void;
}

function spawnChild(script: string, mode: string): Child {
  const proc = spawn(process.execPath, [script, mode], { stdio: ["pipe", "pipe", "inherit"] });
  const lines: Line[] = [];
  let buffer = "";
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const text = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        lines.push(JSON.parse(text) as Line);
      } catch {
        // not one of ours
      }
    }
  });
  return {
    proc,
    pid: proc.pid ?? -1,
    lines,
    async waitFor(event, ms = 15_000) {
      const t0 = performance.now();
      for (;;) {
        const hit = lines.find((l) => l.event === event);
        if (hit) return hit;
        if (performance.now() - t0 > ms) throw new Error(`child never reported ${event}`);
        await realDelay(20);
      }
    },
    send: (text) => void proc.stdin?.write(text),
  };
}

interface Measure {
  case: string;
  rep?: number;
  childPid: number;
  caffeinatePid: number;
  caffeinateCommand: string;
  assertionTypesWhileHeld: string[];
  processGoneMs: number | null;
  assertionGoneMs: number | null;
  emitted: string[];
  note?: string;
}

const records: Measure[] = [];
const orphans: { before: number[]; after: number[]; leaked: number[] } = {
  before: [],
  after: [],
  leaked: [],
};
let dir = "";
let script = "";
const spawned: Child[] = [];
const holdPids = new Set<number>();

/** Starts a child, waits until its hold is visible in pmset under the caffeinate pid, and checks `-w`. */
async function startAndConfirm(mode: string): Promise<{
  child: Child;
  holdPid: number;
  command: string;
  types: string[];
}> {
  const child = spawnChild(script, mode);
  spawned.push(child);
  const started = await child.waitFor("started");
  const holdPid = Number(started.holdPid);
  expect(Number.isInteger(holdPid) && holdPid > 0).toBe(true);
  holdPids.add(holdPid);
  expect(holdPid).not.toBe(child.pid);
  const seen = await firstTrue(
    async () => (await assertionTypes()).has(holdPid),
    performance.now(),
    5_000,
  );
  expect(seen, "assertion owned by the caffeinate pid appeared").not.toBeNull();
  const types = [...((await assertionTypes()).get(holdPid) ?? [])].sort();
  const command = (await exec("ps", ["-o", "command=", "-p", String(holdPid)])).stdout.trim();
  return { child, holdPid, command, types };
}

/** From the instant `t0`, measures when the caffeinate process and its assertion are gone. */
async function measureGone(
  holdPid: number,
  t0: number,
  limitMs = GONE_WITHIN_MS,
): Promise<{ processGoneMs: number | null; assertionGoneMs: number | null }> {
  const [processGoneMs, assertionGoneMs] = await Promise.all([
    firstTrue(() => !alive(holdPid), t0, limitMs),
    firstTrue(async () => !(await assertionTypes()).has(holdPid), t0, limitMs),
  ]);
  return { processGoneMs, assertionGoneMs };
}

describe.skipIf(!enabled)(
  "real caffeinate lifetime under Phoenix's own code (PHOENIX_REAL_AWAKE=1, macOS)",
  () => {
    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "phoenix-real-awake-"));
      script = join(dir, "child.mjs");
      const built = await exec(join(ROOT, "node_modules/.bin/esbuild"), [
        CHILD_SOURCE,
        "--bundle",
        "--platform=node",
        "--format=esm",
        "--target=node22",
        `--outfile=${script}`,
        "--log-level=error",
      ]);
      expect(built.code).toBe(0);
      orphans.before = await caffeinatePids();
    }, 60_000);

    afterAll(async () => {
      for (const child of spawned) if (alive(child.pid)) child.proc.kill("SIGKILL");
      await realDelay(300);
      orphans.after = await caffeinatePids();
      orphans.leaked = orphans.after.filter((p) => !orphans.before.includes(p));
      for (const pid of holdPids) if (alive(pid)) process.kill(pid, "SIGKILL");
      console.log("orphan caffeinate before:", JSON.stringify(orphans.before));
      console.log("orphan caffeinate after:", JSON.stringify(orphans.after));
      console.log("RECORDS", JSON.stringify(records));
      const target = process.env.PHOENIX_REAL_AWAKE_EVIDENCE;
      if (target) {
        writeFileSync(
          target,
          `${JSON.stringify({ node: process.version, platform: process.platform, orphans, records }, null, 2)}\n`,
        );
      }
      rmSync(dir, { recursive: true, force: true });
    }, 30_000);

    async function record(
      name: string,
      mode: string,
      end: (c: Child, holdPid: number) => Promise<number> | number,
      extra: { rep?: number; limitMs?: number } = {},
    ): Promise<Measure> {
      const { child, holdPid, command, types } = await startAndConfirm(mode);
      // The hold must be tied to THIS child exactly like Core's (`-w <pid>`), and be a real caffeinate.
      expect(command).toMatch(/caffeinate/);
      if (mode !== "no-w-control") expect(command).toMatch(new RegExp(`-w ${child.pid}\\b`));
      const t0 = await end(child, holdPid);
      const gone = await measureGone(holdPid, t0, extra.limitMs);
      const measure: Measure = {
        case: name,
        ...(extra.rep === undefined ? {} : { rep: extra.rep }),
        childPid: child.pid,
        caffeinatePid: holdPid,
        caffeinateCommand: command,
        assertionTypesWhileHeld: types,
        ...gone,
        emitted: child.lines.filter((l) => l.event === "emit").map((l) => `${l.type}:${l.reason}`),
      };
      records.push(measure);
      console.log("MEASURE", JSON.stringify(measure));
      return measure;
    }

    const killChild = (signal: NodeJS.Signals) => (c: Child) => {
      const t0 = performance.now();
      c.proc.kill(signal);
      return t0;
    };
    const goAndReturnT0 = async (c: Child) => {
      const t0 = performance.now();
      c.send("go\n");
      await c.waitFor("done");
      return t0;
    };

    for (let rep = 1; rep <= REPETITIONS; rep++) {
      it(`SIGKILL of the owning process frees the hold (repetition ${rep})`, async () => {
        const m = await record("sigkill", "session", killChild("SIGKILL"), { rep });
        expect(m.processGoneMs).not.toBeNull();
        expect(m.assertionGoneMs).not.toBeNull();
      }, 60_000);
    }

    it("SIGTERM of the owning process frees the hold", async () => {
      const m = await record("sigterm", "session", killChild("SIGTERM"));
      expect(m.processGoneMs).not.toBeNull();
      expect(m.assertionGoneMs).not.toBeNull();
    }, 60_000);

    it("releasing the production hold directly frees it", async () => {
      const m = await record("hold-release", "hold-release", goAndReturnT0);
      expect(m.processGoneMs).not.toBeNull();
      expect(m.assertionGoneMs).not.toBeNull();
    }, 60_000);

    it("cancelling a session (the `end` command's path) frees the hold", async () => {
      const m = await record("cancel", "cancel", goAndReturnT0);
      expect(m.processGoneMs).not.toBeNull();
      expect(m.assertionGoneMs).not.toBeNull();
      expect(m.emitted).toContain("awake.session.ended:cancelled");
    }, 60_000);

    it("a session shutdown (Core quitting cleanly) frees the hold", async () => {
      const m = await record("shutdown", "shutdown", goAndReturnT0);
      expect(m.processGoneMs).not.toBeNull();
      expect(m.assertionGoneMs).not.toBeNull();
      expect(m.emitted).toContain("awake.session.ended:shutdown");
    }, 60_000);

    it("a 2 s production hold expires by itself (caffeinate -t 2)", async () => {
      // Measured from the start of the hold; the hold's own timer is 2 s, so the limit is 2 s + 5 s.
      const m = await record("hold-expiry-2s", "hold-expiry", () => performance.now(), {
        limitMs: 2_000 + GONE_WITHIN_MS,
      });
      expect(m.processGoneMs).not.toBeNull();
      expect(m.assertionGoneMs).not.toBeNull();
    }, 60_000);

    it("a session that runs out ends and frees the hold (session timers sped up 60x)", async () => {
      // The 1 minute minimum session is 5 min here; the controller's own timers run 60x faster
      // (clock wrapper in the child, so the real expiry path runs); caffeinate's -t is untouched.
      const m = await record("session-expiry-scaled", "session-expiry", () => performance.now(), {
        limitMs: 5_000 + GONE_WITHIN_MS,
      });
      expect(m.processGoneMs).not.toBeNull();
      expect(m.assertionGoneMs).not.toBeNull();
      expect(m.emitted).toContain("awake.session.ended:expired");
    }, 60_000);

    it("control: a caffeinate WITHOUT -w (not production code) survives SIGKILL of its parent", async () => {
      const m = await record("control-no-w", "no-w-control", killChild("SIGKILL"));
      m.note = "control, not production code: a caffeinate started without -w";
      expect(m.processGoneMs, "the measurement can see a leak").toBeNull();
      for (const c of holdPids) if (alive(c)) process.kill(c, "SIGKILL");
    }, 60_000);
  },
);
