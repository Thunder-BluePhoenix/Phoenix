// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Fake exec only. No real terminal window was focused and no osascript / wmctrl / xdotool /
// PowerShell process was started by these tests.
import { describe, expect, it } from "vitest";
import {
  LinuxTerminalFocuser,
  MacTerminalFocuser,
  WindowsTerminalFocuser,
  focuserFor,
  windowTitle,
  type FocusExec,
  type FocusExecResult,
} from "../src/terminal-focus";

interface Call {
  file: string;
  argv: readonly string[];
  env: Readonly<Record<string, string>> | undefined;
}
function fake(replies: Partial<FocusExecResult>[]) {
  const calls: Call[] = [];
  const exec: FocusExec = async (file, argv, env) => {
    calls.push({ file, argv, env });
    const r = replies.shift() ?? { code: 1 };
    return { code: r.code ?? 0, stdout: r.stdout ?? "" };
  };
  return { exec, calls };
}
const target = { project: "/work/phoenix", tty: "/dev/ttys003", pid: 4242 };

describe("windowTitle", () => {
  it("is the project folder name, bounded, without control characters", () => {
    expect(windowTitle("/work/phoenix")).toBe("phoenix");
    expect(windowTitle("/work/a\nb")).toBe("a b");
    expect(windowTitle("/work/a\u202eb\u200bc")).toBe("abc");
    expect(windowTitle(`/w/${"x".repeat(500)}`)).toHaveLength(100);
  });
});

const TARGET_ENV = "PHOENIX_FOCUS_TARGET";
/** Every argv element is `-e` or a script line: nothing variable can be taken for an option. */
const onlyScript = (argv: readonly string[]) =>
  argv.every((a, i) => (i % 2 === 0 ? a === "-e" : !a.startsWith("-")));

describe("macOS (osascript)", () => {
  it("activates by tty first; the tty travels in the environment, never in argv or the script", async () => {
    const { exec, calls } = fake([{ code: 0, stdout: "terminal\n" }]);
    const r = await new MacTerminalFocuser(exec).focus(target);
    expect(r).toEqual({ focused: true, method: "osascript:terminal-tty" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("osascript");
    expect(calls[0]!.env).toEqual({ [TARGET_ENV]: "/dev/ttys003" });
    expect(onlyScript(calls[0]!.argv)).toBe(true);
    expect(calls[0]!.argv.join("\n")).not.toContain("ttys003");
    expect(calls[0]!.argv.join("\n")).toContain('application "iTerm2"');
    expect(calls[0]!.argv.join("\n")).toContain(`$${TARGET_ENV}`);
  });

  it("finds the tty of the agent process with ps when none was reported", async () => {
    const { exec, calls } = fake([
      { code: 0, stdout: "ttys007\n" },
      { code: 0, stdout: "iterm\n" },
    ]);
    const r = await new MacTerminalFocuser(exec).focus({ project: "/work/phoenix", pid: 4242 });
    expect(r.method).toBe("osascript:iterm-tty");
    expect(calls[0]).toEqual({ file: "ps", argv: ["-o", "tty=", "-p", "4242"], env: undefined });
    expect(calls[1]!.env).toEqual({ [TARGET_ENV]: "/dev/ttys007" });
  });

  it("ignores a process without a terminal (ps prints ??) and uses the title", async () => {
    const { exec, calls } = fake([
      { code: 0, stdout: "??\n" },
      { code: 0, stdout: "terminal" },
    ]);
    await new MacTerminalFocuser(exec).focus({ project: "/work/phoenix", pid: 4242 });
    expect(calls[1]!.env).toEqual({ [TARGET_ENV]: "phoenix" });
  });

  it("falls back to the window title when the tty is not found, and says which app matched", async () => {
    const { exec, calls } = fake([{ code: 1 }, { code: 0, stdout: "iterm\n" }]);
    const r = await new MacTerminalFocuser(exec).focus(target);
    expect(r.method).toBe("osascript:iterm-title");
    expect(calls[1]!.env).toEqual({ [TARGET_ENV]: "phoenix" });
  });

  it("works with only a project (no tty)", async () => {
    const { exec, calls } = fake([{ code: 0, stdout: "terminal" }]);
    await new MacTerminalFocuser(exec).focus({ project: "/work/phoenix" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.env).toEqual({ [TARGET_ENV]: "phoenix" });
  });

  it("fails clearly when no window matches", async () => {
    const { exec } = fake([{ code: 1 }, { code: 1 }]);
    await expect(new MacTerminalFocuser(exec).focus(target)).rejects.toThrow(
      /No Terminal or iTerm2 window/,
    );
  });

  it("a hostile window title is data in the environment, never code", async () => {
    const { exec, calls } = fake([{ code: 0 }]);
    const evil = '/w/x" & do shell script "touch pwn" & "';
    await new MacTerminalFocuser(exec).focus({ project: evil });
    expect(calls[0]!.env).toEqual({ [TARGET_ENV]: 'x" & do shell script "touch pwn" & "' });
    expect(calls[0]!.argv.join("\n")).not.toContain("pwn");
  });

  it("a title starting with `-` (-lJavaScript) can never be an osascript option", async () => {
    const { exec, calls } = fake([{ code: 0 }]);
    await new MacTerminalFocuser(exec).focus({ project: "/work/-lJavaScript" });
    expect(calls[0]!.env).toEqual({ [TARGET_ENV]: "-lJavaScript" });
    expect(calls[0]!.argv).not.toContain("-lJavaScript");
    expect(onlyScript(calls[0]!.argv)).toBe(true);
  });
});

describe("Linux (wmctrl / xdotool)", () => {
  it("uses wmctrl -a <title> first", async () => {
    const { exec, calls } = fake([{ code: 0 }]);
    expect(await new LinuxTerminalFocuser(exec).focus(target)).toEqual({
      focused: true,
      method: "wmctrl",
    });
    expect(calls).toEqual([{ file: "wmctrl", argv: ["-a", "phoenix"], env: undefined }]);
  });

  it("falls back to xdotool search + windowactivate, with `--` before a title that looks like an option", async () => {
    const { exec, calls } = fake([{ code: 127 }, { code: 0, stdout: "12345\n" }, { code: 0 }]);
    const r = await new LinuxTerminalFocuser(exec).focus({ project: "/work/--help" });
    expect(r.method).toBe("xdotool");
    expect(calls[1]!.argv).toEqual(["search", "--onlyvisible", "--name", "--", "--help"]);
    expect(calls[2]!.argv).toEqual(["windowactivate", "12345"]);
  });

  it("never passes a non-numeric window id on", async () => {
    const { exec, calls } = fake([{ code: 1 }, { code: 0, stdout: "0x1; rm -rf ~\n" }]);
    await expect(new LinuxTerminalFocuser(exec).focus(target)).rejects.toThrow(/wmctrl or xdotool/);
    expect(calls).toHaveLength(2);
  });
});

describe("Windows (PowerShell AppActivate)", () => {
  it("tries the pid, then the title; the target travels in the environment, not in the script", async () => {
    const { exec, calls } = fake([{ code: 1 }, { code: 0 }]);
    const r = await new WindowsTerminalFocuser(exec).focus(target);
    expect(r).toEqual({ focused: true, method: "powershell:AppActivate-title" });
    expect(calls.map((c) => c.env)).toEqual([
      { PHOENIX_FOCUS_TARGET: "4242" },
      { PHOENIX_FOCUS_TARGET: "phoenix" },
    ]);
    for (const c of calls) {
      expect(c.file).toBe("powershell.exe");
      expect(c.argv).toContain("-NoProfile");
      expect(c.argv.join(" ")).toContain("AppActivate");
      expect(c.argv.join(" ")).not.toContain("phoenix");
    }
  });

  it("fails clearly when nothing activates", async () => {
    const { exec } = fake([{ code: 1 }, { code: 1 }]);
    await expect(new WindowsTerminalFocuser(exec).focus(target)).rejects.toThrow(
      /could be activated/,
    );
  });
});

describe("validation and selection", () => {
  it("refuses an invalid tty or pid before running anything", async () => {
    for (const bad of [
      { project: "/p", tty: "ttys001" },
      { project: "/p", tty: "/dev/../etc/passwd" },
      { project: "/p", tty: "/dev/tty1; id" },
      { project: "/p", pid: -1 },
      { project: "/p", pid: 1.5 },
    ]) {
      for (const make of [
        (e: FocusExec) => new MacTerminalFocuser(e),
        (e: FocusExec) => new LinuxTerminalFocuser(e),
        (e: FocusExec) => new WindowsTerminalFocuser(e),
      ]) {
        const { exec, calls } = fake([{ code: 0 }]);
        await expect(make(exec).focus(bad)).rejects.toThrow();
        expect(calls).toHaveLength(0);
      }
    }
  });

  it("focuserFor picks the implementation per platform and refuses others", () => {
    const { exec } = fake([]);
    expect(focuserFor("darwin", exec)).toBeInstanceOf(MacTerminalFocuser);
    expect(focuserFor("linux", exec)).toBeInstanceOf(LinuxTerminalFocuser);
    expect(focuserFor("win32", exec)).toBeInstanceOf(WindowsTerminalFocuser);
    expect(() => focuserFor("freebsd", exec)).toThrow(/not supported/);
  });
});
