// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  AwakeError,
  MAX_HOLD_SECONDS,
  WINDOWS_SCRIPT,
  createInhibitor,
  holdCommand,
  holdIsParentBound,
} from "../src";
import { FakeSystem } from "../testing/fakes";

describe("holdCommand", () => {
  it("macOS: caffeinate with -t so it expires by itself, and -w so it dies with Core", () => {
    expect(holdCommand("darwin", 3600, 4242)).toEqual({
      file: "caffeinate",
      args: ["-d", "-i", "-s", "-t", "3600", "-w", "4242"],
    });
  });

  it("macOS: refuses a pid that is not a positive integer (a bad -w would hold forever or not at all)", () => {
    for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "42", null]) {
      expect(() => holdCommand("darwin", 60, pid as number)).toThrow(AwakeError);
    }
  });

  it("only macOS ties the hold to Core's pid", () => {
    expect(holdIsParentBound("darwin")).toBe(true);
    expect(holdIsParentBound("linux")).toBe(false);
    expect(holdIsParentBound("win32")).toBe(false);
    expect(holdCommand("linux", 60, 4242).args).not.toContain("4242");
    expect(holdCommand("win32", 60, 4242).args).not.toContain("4242");
  });

  it("Linux: systemd-inhibit around a bounded sleep", () => {
    const { file, args } = holdCommand("linux", 90, 1);
    expect(file).toBe("systemd-inhibit");
    expect(args.slice(0, 3)).toEqual([
      "--what=idle:sleep",
      "--who=Phoenix",
      expect.stringMatching(/^--why=/),
    ]);
    expect(args.slice(3)).toEqual(["sleep", "90"]);
  });

  it("Windows: the script is a constant and the seconds travel as a separate argv element", () => {
    const a = holdCommand("win32", 120, 1);
    const b = holdCommand("win32", 99, 1);
    expect(a.file).toBe("powershell.exe");
    const script = a.args[a.args.indexOf("-Command") + 1];
    expect(script).toBe(WINDOWS_SCRIPT);
    expect(b.args[b.args.indexOf("-Command") + 1]).toBe(WINDOWS_SCRIPT);
    expect(a.args.at(-1)).toBe("120");
    expect(WINDOWS_SCRIPT).not.toContain("120");
    expect(WINDOWS_SCRIPT).toContain("param([int]$Seconds)");
    expect(WINDOWS_SCRIPT).toContain("SetThreadExecutionState");
    // No string-building hole: nothing in the script interpolates a caller value.
    expect(WINDOWS_SCRIPT).not.toMatch(/\$\(|\+\s*\$|Invoke-Expression|iex\b/i);
  });

  it("every command is an argv array of plain strings (no shell string)", () => {
    for (const p of ["darwin", "linux", "win32"] as const) {
      const { file, args } = holdCommand(p, 60, 1);
      expect(file).not.toMatch(/\s/);
      expect(args.every((x) => typeof x === "string")).toBe(true);
    }
  });

  it("rejects anything that is not an integer number of seconds in range", () => {
    const bad: unknown[] = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_HOLD_SECONDS + 1,
      "60",
      "60; rm -rf /",
      null,
    ];
    for (const seconds of bad) {
      expect(() => holdCommand("darwin", seconds as number, 1)).toThrow(AwakeError);
      expect(() => holdCommand("win32", seconds as number, 1)).toThrow(AwakeError);
    }
  });
});

describe("createInhibitor", () => {
  it("release kills the child once; further releases do nothing", () => {
    const sys = new FakeSystem();
    const hold = createInhibitor(sys.env).acquire(60);
    hold.release();
    hold.release();
    expect(sys.children[0]?.killed).toBe(1);
  });

  it("does not kill a child that already exited", async () => {
    const sys = new FakeSystem();
    const hold = createInhibitor(sys.env).acquire(60);
    sys.children[0]?.exit(0);
    await hold.exited;
    await Promise.resolve();
    hold.release();
    expect(sys.children[0]?.killed).toBe(0);
  });

  it("acquire passes Core's pid from the env to caffeinate -w on macOS", () => {
    const sys = new FakeSystem({ corePid: 31337 });
    const inhibitor = createInhibitor(sys.env);
    expect(inhibitor.parentBound).toBe(true);
    inhibitor.acquire(60);
    expect(sys.children[0]?.args.slice(-2)).toEqual(["-w", "31337"]);
  });

  it("a spawn failure is an AwakeError without the system message", () => {
    const sys = new FakeSystem({ spawnThrows: true });
    expect(() => createInhibitor(sys.env).acquire(60)).toThrow(AwakeError);
  });
});
