// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  ALLOWED_HELPER_ARGV,
  ALLOWED_HELPER_LINES,
  HelperUnavailableError,
  createHelperClient,
  validateHelperCommand,
} from "../../src/power/helper-client";
import { NotAppliedError } from "../../src/power/journal";
import { recordingRunner, type Calls } from "./fixtures";

const calls = (): Calls => ({ ran: [], failWith: new Map() });

describe("validateHelperCommand", () => {
  it("accepts exactly the four literal commands, as argv or as one line", () => {
    for (const argv of ALLOWED_HELPER_ARGV) {
      const byArgv = validateHelperCommand([...argv]);
      expect(byArgv.ok && [...byArgv.command.argv]).toEqual([...argv]);
      expect(validateHelperCommand(argv.join(" ")).ok).toBe(true);
    }
    expect(ALLOWED_HELPER_LINES).toEqual([
      "/usr/bin/pmset -a disablesleep 1",
      "/usr/bin/pmset -a disablesleep 0",
      "/usr/bin/pmset -a lowpowermode 1",
      "/usr/bin/pmset -a lowpowermode 0",
    ]);
  });

  it("reports which setting and value an accepted command means", () => {
    const on = validateHelperCommand(["/usr/bin/pmset", "-a", "disablesleep", "1"]);
    const off = validateHelperCommand("/usr/bin/pmset -a lowpowermode 0");
    expect(on.ok && [on.command.setting, on.command.value]).toEqual(["disablesleep", 1]);
    expect(off.ok && [off.command.setting, off.command.value]).toEqual(["lowpowermode", 0]);
  });

  const P = "/usr/bin/pmset";
  it.each([
    ["extra argument", [P, "-a", "disablesleep", "1", "extra"]],
    ["missing value", [P, "-a", "disablesleep"]],
    ["other value", [P, "-a", "disablesleep", "2"]],
    ["negative value", [P, "-a", "disablesleep", "-1"]],
    ["other setting", [P, "-a", "displaysleep", "0"]],
    ["other flag", [P, "-b", "disablesleep", "1"]],
    ["relative path", ["pmset", "-a", "disablesleep", "1"]],
    ["path trick ..", ["/usr/bin/../bin/pmset", "-a", "disablesleep", "1"]],
    ["path trick //", ["/usr//bin/pmset", "-a", "disablesleep", "1"]],
    ["other binary", ["/bin/sh", "-a", "disablesleep", "1"]],
    ["shell chain in value", [P, "-a", "disablesleep", "1; reboot"]],
    ["command substitution", [P, "-a", "disablesleep", "$(id)"]],
    ["backtick", [P, "-a", "disablesleep", "`id`"]],
    ["pipe", [P, "-a", "disablesleep", "1|cat"]],
    ["newline in value", [P, "-a", "disablesleep", "1\nreboot"]],
    ["upper case setting", [P, "-a", "DISABLESLEEP", "1"]],
    ["upper case path", ["/usr/bin/PMSET", "-a", "disablesleep", "1"]],
    ["trailing space in value", [P, "-a", "disablesleep", "1 "]],
    ["numeric value", [P, "-a", "disablesleep", 1]],
    ["empty argv", []],
    ["sudo prefix", ["/usr/bin/sudo", P, "-a", "disablesleep", "1"]],
  ])("rejects an argv with %s", (_name, argv) => {
    expect(validateHelperCommand(argv).ok).toBe(false);
  });

  it.each([
    ["trailing space", "/usr/bin/pmset -a disablesleep 1 "],
    ["leading space", " /usr/bin/pmset -a disablesleep 1"],
    ["double space", "/usr/bin/pmset  -a disablesleep 1"],
    ["tab", "/usr/bin/pmset\t-a disablesleep 1"],
    ["newline", "/usr/bin/pmset -a disablesleep 1\n"],
    ["chained", "/usr/bin/pmset -a disablesleep 1 && reboot"],
    ["upper case", "/usr/bin/pmset -a Disablesleep 1"],
    ["wildcard", "/usr/bin/pmset -a disablesleep *"],
    ["empty", ""],
  ])("rejects a command line with %s", (_name, line) => {
    expect(validateHelperCommand(line).ok).toBe(false);
  });

  it("rejects anything that is not an argv array or a string", () => {
    for (const bad of [undefined, null, 1, {}, { argv: [] }, true]) {
      expect(validateHelperCommand(bad).ok).toBe(false);
    }
  });

  it("returns the allow-list's own argv, never the caller's array", () => {
    const mine = [...ALLOWED_HELPER_ARGV[0]!];
    const checked = validateHelperCommand(mine);
    expect(checked.ok && checked.command.argv).not.toBe(mine);
  });
});

describe("helper client", () => {
  it("runs `sudo -n` with the allowed argv and nothing else", async () => {
    const c = calls();
    await createHelperClient(recordingRunner(c)).run(ALLOWED_HELPER_ARGV[0]!);
    expect(c.ran).toEqual(["/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 1"]);
  });

  it("never runs a command outside the allow-list", async () => {
    const c = calls();
    const client = createHelperClient(recordingRunner(c));
    await expect(client.run(["/usr/bin/pmset", "-a", "displaysleep", "0"])).rejects.toBeInstanceOf(
      HelperUnavailableError,
    );
    await expect(client.run(["/bin/sh", "-c", "reboot"])).rejects.toBeInstanceOf(
      HelperUnavailableError,
    );
    expect(c.ran).toEqual([]);
  });

  it("treats a non-zero exit as 'helper not installed', and that means nothing changed", async () => {
    const c = calls();
    c.failWith.set("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 1", 1);
    const err = await createHelperClient(recordingRunner(c))
      .run(ALLOWED_HELPER_ARGV[0]!)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HelperUnavailableError);
    expect(err).toBeInstanceOf(NotAppliedError);
    expect((err as Error).message).toContain("docs/awake-helper.md");
  });

  it("does NOT treat a timeout (no exit code) as 'nothing changed': the command may have run", async () => {
    const client = createHelperClient(() =>
      Promise.resolve({ code: null, stdout: "", stderr: "" }),
    );
    const err = await client.run(ALLOWED_HELPER_ARGV[0]!).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotAppliedError);
  });

  it("probes with `sudo -n -l` (lists, does not execute) and maps the exit code", async () => {
    const c = calls();
    const client = createHelperClient(recordingRunner(c));
    expect(await client.probe()).toBe(true);
    expect(c.ran).toEqual(["/usr/bin/sudo -n -l /usr/bin/pmset -a disablesleep 0"]);
    c.failWith.set(c.ran[0]!, 1);
    expect(await client.probe()).toBe(false);
    const dead = createHelperClient(() => Promise.resolve({ code: null, stdout: "", stderr: "" }));
    expect(await dead.probe()).toBeNull();
  });
});
