// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Relative imports, as in integration.test.ts: the CLI depends on no workspace package.
import { createAwakeCapability } from "../../../capabilities/awake/src/index";
import { FakeSystem } from "../../../capabilities/awake/testing/fakes";
import { defaults } from "../../../core/config/src/index";
import { silentLogger } from "../../../core/logging/src/index";
import { PhoenixRuntime } from "../../../core/runtime/src/index";
import { parseDuration, parseReason } from "../src/awake";
import { makeHarness, type Harness, type Outcome } from "./harness";

const TOKEN = "cli-awake-session-token";
let runtime: PhoenixRuntime | undefined;
let h: Harness | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  h?.cleanup();
  h = undefined;
  await runtime?.stop();
  runtime = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

/** The real Core with the real keep-awake capability on a machine that never runs anything. */
async function boot() {
  const system = new FakeSystem();
  dataDir = mkdtempSync(join(tmpdir(), "phoenix-cli-awake-"));
  const holder: { runtime?: PhoenixRuntime } = {};
  runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port: 0, dataDir },
    databasePath: ":memory:",
    logger: silentLogger,
    token: TOKEN,
    capabilities: [
      createAwakeCapability({
        env: system.env,
        battery: () => Promise.resolve({ kind: "none" }),
        feed: () => holder.runtime?.bus,
      }),
    ],
    writeTokenFile: true,
  });
  holder.runtime = runtime;
  const { port } = await runtime.start();
  await runtime.capabilities.enable("awake");
  h = makeHarness(TOKEN, `http://127.0.0.1:${port}`);
  return { system, runtime, cli: h };
}

/**
 * Runs the command line and plays the person in the app: when the CLI polls and a confirmation is
 * waiting, `decide` answers it. Nothing else answers, so a CLI that skipped asking would hang here.
 */
async function asUser(
  rig: Awaited<ReturnType<typeof boot>>,
  args: string[],
  decide: (summary: string) => boolean,
  options: { confirm?: () => Promise<boolean> } = {},
): Promise<Outcome & { asked: string[] }> {
  const asked: string[] = [];
  const outcome = await rig.cli.cli(args, {
    ...options,
    sleep: async () => {
      for (const pending of rig.runtime.permissions.pendingConfirmations()) {
        asked.push(pending.summary);
        rig.runtime.permissions.resolveConfirmation(pending.id, decide(pending.summary));
      }
    },
  });
  return { ...outcome, asked };
}

describe("parseDuration", () => {
  it.each([
    ["90", 90],
    ["90m", 90],
    ["2h", 120],
    ["1d", 1440],
    ["7d", 10_080],
    ["1m", 1],
  ])("reads %s as %i minutes", (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each(["", "0", "0h", "8d", "10081", "1.5h", "-5", "2 h", "h", "1e3", "٣", "2H", "00000000"])(
    "refuses %j",
    (text) => {
      expect(() => parseDuration(text)).toThrow();
    },
  );

  it("refuses a missing duration", () => {
    expect(() => parseDuration(undefined)).toThrow(/not a duration/);
  });

  it("refuses a reason with an escape sequence or a newline, or too long", () => {
    expect(() => parseReason("fine\u001b[2J")).toThrow();
    expect(() => parseReason("two\nlines")).toThrow();
    expect(() => parseReason("x".repeat(81))).toThrow();
    expect(() => parseReason("")).toThrow();
    expect(parseReason("overnight build")).toBe("overnight build");
    expect(parseReason(undefined)).toBeUndefined();
  });
});

describe("phoenix awake against the real Core and keep-awake capability", () => {
  it("starts nothing until the person approves, then holds the machine for exactly that long", async () => {
    const rig = await boot();
    const result = await asUser(rig, ["awake", "2h", "--reason", "overnight build"], () => true);
    expect(result.code).toBe(0);
    expect(result.asked).toHaveLength(1);
    expect(result.out).toContain("Keep awake: running");
    expect(result.out).toContain('for "overnight build"');
    expect(result.out).toContain("2h 0m left");
    expect(rig.system.alive).toHaveLength(1);
    const audit = rig.runtime.permissions.audit.list({ capabilityId: "awake" });
    expect(audit.some((e) => e.action === "confirmation.approved")).toBe(true);
    expect(audit.some((e) => e.action === "action.succeeded")).toBe(true);
  });

  it("never answers the confirmation itself: nobody answers, so nothing starts and it exits refused", async () => {
    const rig = await boot();
    let polls = 0;
    const outcome = await rig.cli.cli(["awake", "30m"], {
      sleep: async () => void polls++,
    });
    expect(outcome.code).toBe(4);
    expect(outcome.err).toContain("still waiting for you to approve");
    expect(outcome.err).toContain("Waiting for you to approve this in Phoenix");
    expect(polls).toBeGreaterThan(100);
    expect(rig.system.children).toHaveLength(0);
    expect(rig.runtime.permissions.pendingConfirmations()).toHaveLength(1);
  });

  it("exits refused, not failed, when the person says no, and holds nothing", async () => {
    const rig = await boot();
    const result = await asUser(rig, ["awake", "1h"], () => false);
    expect(result.code).toBe(4);
    expect(result.err).toContain("Rejected by user");
    expect(rig.system.children).toHaveLength(0);
    const status = await rig.cli.cli(["awake", "status"]);
    expect(status.out).toContain("not running");
  });

  it("extends a running timed session and ends it, each only after approval", async () => {
    const rig = await boot();
    await asUser(rig, ["awake", "1h"], () => true);
    const extended = await asUser(rig, ["awake", "extend", "30m"], () => true);
    expect(extended.code).toBe(0);
    expect(extended.out).toContain("1h 30m left");
    const ended = await asUser(rig, ["awake", "end"], () => true);
    expect(ended.code).toBe(0);
    expect(ended.out).toContain("not running");
    expect(rig.system.alive).toHaveLength(0);
  });

  it("reads status without asking anyone and reports it as JSON", async () => {
    const rig = await boot();
    await asUser(rig, ["awake", "45m"], () => true);
    const status = await rig.cli.cli(["awake", "status", "--json"]);
    expect(status.code).toBe(0);
    expect(rig.runtime.permissions.pendingConfirmations()).toHaveLength(0);
    expect(JSON.parse(status.out)).toMatchObject({ active: true, mode: "timed" });
  });

  it("reports a second start as an error and leaves the first session alone", async () => {
    const rig = await boot();
    await asUser(rig, ["awake", "1h"], () => true);
    const second = await asUser(rig, ["awake", "2h"], () => true);
    expect(second.code).toBe(1);
    expect(second.err).toContain("already running");
    expect(rig.system.alive).toHaveLength(1);
  });

  it("refuses a bad duration before contacting Core at all", async () => {
    const rig = await boot();
    const before = rig.runtime.permissions.audit.list({}).length;
    for (const args of [["awake", "8d"], ["awake", "1.5h"], ["awake"], ["awake", "extend"]]) {
      const outcome = await rig.cli.cli(args);
      expect(outcome.code).toBe(2);
    }
    expect(rig.runtime.permissions.pendingConfirmations()).toHaveLength(0);
    expect(rig.runtime.permissions.audit.list({}).length).toBe(before);
  });

  it("refuses to start while the emergency stop is engaged", async () => {
    const rig = await boot();
    rig.runtime.permissions.engageKillSwitch("test");
    const result = await asUser(rig, ["awake", "1h"], () => true);
    expect(result.code).not.toBe(0);
    expect(rig.system.children).toHaveLength(0);
  });

  it("never prints the session token or control characters from Core", async () => {
    const rig = await boot();
    const result = await asUser(rig, ["awake", "1h", "--reason", "build"], () => true);
    expect(rig.cli.everything(result)).not.toContain(TOKEN);
    // eslint-disable-next-line no-control-regex
    expect(rig.cli.everything(result)).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  });
});
