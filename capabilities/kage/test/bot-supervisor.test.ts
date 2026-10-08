// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const SUPERVISOR = join(import.meta.dirname, "../src/bot-supervisor.cjs");
const FAKE_BOT = join(import.meta.dirname, "../testing/fake-bot.cjs");

const running: ChildProcess[] = [];
const pids: number[] = [];
afterEach(() => {
  for (const c of running.splice(0)) c.kill("SIGKILL");
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Starts the supervisor around `bot`, as Core does: stdin is a pipe Core never writes to. */
async function supervise(bot: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-sup-"));
  const pidfile = join(dir, "bot.pid");
  const child = spawn(process.execPath, [SUPERVISOR, bot, "https://meet.google.com/x"], {
    env: {
      ...process.env,
      KAGE_API_KEY: "test-key-not-in-argv",
      FAKE_BOT_PIDFILE: pidfile,
      FAKE_BOT_HOLD_MS: "60000",
      ...env,
    },
    stdio: ["pipe", "ignore", "ignore"],
  });
  running.push(child);
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  let botPid = 0;
  await vi.waitFor(() => {
    botPid = Number(readFileSync(pidfile, "utf8"));
    expect(botPid).toBeGreaterThan(0);
  });
  pids.push(botPid);
  return { child, exited, botPid };
}

describe("bot supervisor", () => {
  it("stops the bot when Core goes away (its end of the pipe closes)", async () => {
    const { child, exited, botPid } = await supervise(FAKE_BOT);
    expect(isAlive(botPid)).toBe(true);

    // What the operating system does to the pipe when Core is killed.
    child.stdin!.end();

    await exited;
    await vi.waitFor(() => expect(isAlive(botPid)).toBe(false));
  });

  it("forwards a stop request, so disabling Kage still ends the capture", async () => {
    const { child, exited, botPid } = await supervise(FAKE_BOT);
    child.kill("SIGTERM");
    await exited;
    await vi.waitFor(() => expect(isAlive(botPid)).toBe(false));
  });

  it("passes the bot's exit code through, so Core can tell success from failure", async () => {
    const ok = await supervise(FAKE_BOT, { FAKE_BOT_HOLD_MS: "20" });
    expect(await ok.exited).toBe(0);
    const failed = await supervise(FAKE_BOT, { FAKE_BOT_HOLD_MS: "20", FAKE_BOT_EXIT: "1" });
    expect(await failed.exited).toBe(1);
  });

  it("kills a bot that ignores the stop request once the grace period ends", async () => {
    const stubborn = join(mkdtempSync(join(tmpdir(), "phoenix-sup-")), "stubborn.cjs");
    writeFileSync(
      stubborn,
      `require("node:fs").writeFileSync(process.env.FAKE_BOT_PIDFILE, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1 << 30);`,
    );
    const { child, exited, botPid } = await supervise(stubborn, { KAGE_BOT_GRACE_MS: "150" });
    child.stdin!.end();
    await exited;
    await vi.waitFor(() => expect(isAlive(botPid)).toBe(false));
  });
});
