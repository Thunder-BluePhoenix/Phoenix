// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pins the REAL output formats seen on macOS 27.0.1 (read-only commands, redacted; see
// docs/evidence/phase-73-74-75-real-macos-probes-2026-11-11.md) against the production parsers.
// Ungated: it only reads checked-in fixtures and runs no command.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseClamshell } from "../src/power/lid";
import { pmsetSetting } from "../src/power";
import { parseAssertionHolders } from "../src/lid-actions/assertions";
import { createOsascriptAudio, parsePsLine } from "../src/lid-actions/real";
import { createAppNap } from "../src/lid-actions/actions/app-nap";
import type { LidSeams, PlanContext } from "../src/lid-actions/types";
import {
  BROWSERS,
  findBrowser,
  parseBrowserStatus,
  parseCurrentNetwork,
  parseWifiDevice,
} from "../src/continuity";
import { parsePmset } from "../src/battery";
import type { RunResult, Runner } from "../src/system";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "real-macos-27");
const fixture = (name: string): string => readFileSync(join(DIR, name), "utf8");

describe("real macOS 27.0.1 formats (redacted fixtures)", () => {
  it("ioreg: lid OPEN reads AppleClamshellState = No as open", () => {
    const text = fixture("ioreg-clamshell-lid-open.txt");
    expect(text).toContain('"AppleClamshellState" = No');
    expect(parseClamshell(text)).toBe("open");
  });

  it("pmset -g: SleepDisabled is NOT listed while sleep is allowed, so it reads as unknown", () => {
    const text = fixture("pmset-g.txt");
    expect(text).not.toMatch(/SleepDisabled/i);
    expect(pmsetSetting(text, "SleepDisabled")).toBeUndefined();
    expect(pmsetSetting(text, "lowpowermode")).toBeUndefined();
    expect(pmsetSetting(text, "displaysleep")).toBe(3);
    // The line with a parenthesised note is not a plain number.
    expect(pmsetSetting(text, "sleep")).toBeUndefined();
  });

  it("pmset -g assertions: the holders are the idle-sleep and audio-assertion owners", () => {
    const holders = parseAssertionHolders(fixture("pmset-g-assertions.txt"));
    expect(holders).not.toBeNull();
    // omp 6111, coreaudiod 553 (+ created for 728 and 44724), powerd 342; UserIsActive is not a hold.
    expect([...(holders ?? [])].sort((a, b) => a - b)).toEqual([342, 553, 728, 6111, 44724]);
  });

  it("pmset -g batt (used by the floors) still parses", () => {
    expect(
      parsePmset(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t97%; discharging; (no estimate) present: true\n",
      ),
    ).toMatchObject({ kind: "battery", percent: 97 });
  });

  it("ps lstart: the lid-actions process table parses, one-digit days included", () => {
    const procs = fixture("ps-lstart.txt")
      .split("\n")
      .flatMap((line) => parsePsLine(line) ?? []);
    expect(procs.map((p) => p.pid)).toEqual([1, 244, 44673]);
    expect(procs[2]).toMatchObject({
      state: "S",
      uid: 501,
      start: "Fri Oct 30 07:43:23 2026",
      command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  });

  it("ps command: real Chrome main process has no flags, so it is running and throttled", () => {
    const chrome = findBrowser("com.google.Chrome");
    expect(chrome).toBeDefined();
    if (!chrome) return;
    expect(parseBrowserStatus(fixture("ps-command-chrome.txt"), chrome)).toEqual({
      bundle_id: "com.google.Chrome",
      name: "Google Chrome",
      running: true,
      throttled: true,
    });
    for (const other of BROWSERS.filter((b) => b.bundleId !== chrome.bundleId)) {
      expect(parseBrowserStatus(fixture("ps-command-chrome.txt"), other).running).toBe(false);
    }
  });

  it("networksetup: the Wi-Fi device is en0, Ethernet adapters are skipped", () => {
    expect(parseWifiDevice(fixture("networksetup-listallhardwareports.txt"))).toBe("en0");
  });

  it("networksetup -getairportnetwork: the real not-associated wording reads as null", () => {
    expect(
      parseCurrentNetwork(fixture("networksetup-getairportnetwork-not-associated.txt")),
    ).toBeNull();
  });

  it("osascript: the real muted getter answers `false`; the volume getter a bare number", async () => {
    expect(fixture("osascript-output-volume.txt").trim()).toMatch(/^\d{1,3}$/);
    const run: Runner = (file) =>
      Promise.resolve(
        file === "/usr/bin/osascript"
          ? { code: 0, stdout: fixture("osascript-output-muted.txt"), stderr: "" }
          : { code: 1, stdout: "", stderr: "" },
      );
    const audio = createOsascriptAudio(run);
    expect(await audio.listOutputs()).toEqual([{ id: "default", muted: false, name: null }]);
  });

  it("defaults read: a missing App Nap key or domain reads as `absent`, never as unreadable", async () => {
    const planFor = async (stderr: string): Promise<unknown> => {
      const run = (): Promise<RunResult> => Promise.resolve({ code: 1, stdout: "", stderr });
      const action = createAppNap(
        { platform: "darwin", run, protectedState: () => "idle" } as unknown as LidSeams,
        () => ["com.google.Chrome"],
      );
      const ctx = { skip: () => null } as unknown as PlanContext;
      return action.plan(ctx);
    };
    for (const name of [
      "defaults-read-missing-key.stderr.txt",
      "defaults-read-missing-domain.stderr.txt",
    ]) {
      expect(await planFor(fixture(name)), name).toMatchObject({
        undo: { apps: [{ bundle: "com.google.Chrome", prior: "absent" }] },
      });
    }
  });
});
