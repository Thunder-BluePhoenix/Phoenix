// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Opt-in: PHOENIX_REAL_MACOS_PROBES=1 on macOS. Runs ONLY read-only commands (ioreg, pmset -g,
// pmset -g assertions, ps, networksetup list/get, osascript getters, defaults read) through the production parsers and asserts structurally that each parser
// returns a defined result and never throws. It prints nothing personal (no SSIDs, MACs, names).
import { describe, expect, it } from "vitest";
import { parseClamshell } from "../src/power/lid";
import { pmsetSetting } from "../src/power";
import { parseAssertionHolders } from "../src/lid-actions/assertions";
import { PS_ARGV, parsePsLine } from "../src/lid-actions/real";
import {
  BROWSERS,
  parseBrowserStatus,
  parseCurrentNetwork,
  parseWifiDevice,
} from "../src/continuity";
import { realRunner } from "../src";

const enabled = process.env.PHOENIX_REAL_MACOS_PROBES === "1" && process.platform === "darwin";
const run = (file: string, args: readonly string[]) =>
  realRunner(file, args, { timeoutMs: 15_000 });

describe.skipIf(!enabled)("real macOS read-only probes (PHOENIX_REAL_MACOS_PROBES=1)", () => {
  it("ioreg: the lid parser answers open, closed or unknown", async () => {
    const r = await run("/usr/sbin/ioreg", ["-r", "-k", "AppleClamshellState", "-d", "4"]);
    expect(r.code).toBe(0);
    expect(["open", "closed", "unknown"]).toContain(parseClamshell(r.stdout));
  });

  it("pmset -g: SleepDisabled is a number or absent, never a throw", async () => {
    const r = await run("/usr/bin/pmset", ["-g"]);
    expect(r.code).toBe(0);
    const value = pmsetSetting(r.stdout, "SleepDisabled");
    expect(value === undefined || Number.isInteger(value)).toBe(true);
    console.log("SleepDisabled key listed:", /SleepDisabled/i.test(r.stdout));
  });

  it("pmset -g assertions: a holder set (not null) is returned", async () => {
    const r = await run("/usr/bin/pmset", ["-g", "assertions"]);
    expect(r.code).toBe(0);
    expect(parseAssertionHolders(r.stdout)).toBeInstanceOf(Set);
  });

  it("ps: the process table and every browser status parse", async () => {
    const lister = await run("/usr/bin/env", PS_ARGV);
    expect(lister.code).toBe(0);
    const lines = lister.stdout.split("\n").filter((l) => l.trim() !== "");
    const parsed = lines.flatMap((l) => parsePsLine(l) ?? []);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBe(lines.length);
    const ps = await run("/bin/ps", ["-axo", "command="]);
    expect(ps.code).toBe(0);
    for (const browser of BROWSERS) {
      const status = parseBrowserStatus(ps.stdout, browser);
      expect(typeof status.running).toBe("boolean");
      expect(status.running || !status.throttled).toBe(true);
    }
  });

  it("networksetup: device discovery and the current-network read do not throw", async () => {
    const ports = await run("/usr/sbin/networksetup", ["-listallhardwareports"]);
    expect(ports.code).toBe(0);
    const device = parseWifiDevice(ports.stdout);
    expect(device === null || /^en\d+$/.test(device)).toBe(true);
    if (device === null) return;
    const current = await run("/usr/sbin/networksetup", ["-getairportnetwork", device]);
    const name = parseCurrentNetwork(current.stdout);
    expect(name === null || name === undefined || typeof name === "string").toBe(true);
    console.log(
      "wifi current network parsed as:",
      name === null ? "none" : name === undefined ? "unreadable" : "a name",
    );
  });

  it("osascript getters answer a boolean and a number", async () => {
    const muted = await run("/usr/bin/osascript", ["-e", "output muted of (get volume settings)"]);
    expect(muted.code).toBe(0);
    expect(["true", "false", "missing value"]).toContain(muted.stdout.trim());
    const volume = await run("/usr/bin/osascript", [
      "-e",
      "output volume of (get volume settings)",
    ]);
    expect(volume.code).toBe(0);
    expect(volume.stdout.trim()).toMatch(/^(\d{1,3}|missing value)$/);
  });

  it("defaults read of an unset App Nap key exits 1 with a message the parser knows", async () => {
    const r = await run("/usr/bin/defaults", [
      "read",
      "com.phoenix.no-such-domain.probe",
      "NSAppSleepDisabled",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/does not exist|Could not find key|not found/i);
  });
});
