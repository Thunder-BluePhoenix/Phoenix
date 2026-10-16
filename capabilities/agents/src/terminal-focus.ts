// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 "jump to the session's terminal window". One interface, one implementation per OS.
// Every implementation runs a fixed program with a fixed argv (no shell); the only variable parts
// (a tty device, a pid, a window title) are passed as separate arguments or environment values and
// are validated first, so none of them can become code. Core asks the user to confirm before
// calling `focus` at all, because it starts a process.
//
// NOT verified against real terminal windows: tests drive these with a fake `exec`.
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

/** What Phoenix knows about where an agent runs. */
export interface TerminalTarget {
  /** Absolute project directory (its folder name is the usual window title). */
  project: string;
  /** The agent process, when a hook reported it. */
  pid?: number;
  /** The controlling terminal, e.g. `/dev/ttys003`. */
  tty?: string;
}

export interface FocusResult {
  focused: true;
  /** Which strategy worked, e.g. `osascript:terminal-tty`. */
  method: string;
}

export interface TerminalFocuser {
  readonly platform: NodeJS.Platform;
  focus(target: TerminalTarget): Promise<FocusResult>;
}

export interface FocusExecResult {
  code: number | null;
  stdout: string;
}

/** Runs `file argv` (no shell) with `env` added to a minimal environment. Tests inject a fake. */
export type FocusExec = (
  file: string,
  argv: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<FocusExecResult>;

/** The real exec: a short deadline, minimal environment plus the given values. */
export const execFocus: FocusExec = (file, argv, env = {}) => {
  const done = Promise.withResolvers<FocusExecResult>();
  execFile(
    file,
    [...argv],
    {
      timeout: 5_000,
      maxBuffer: 100_000,
      windowsHide: true,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    },
    (err, stdout) => {
      done.resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout });
    },
  );
  return done.promise;
};

const TTY = /^\/dev\/[A-Za-z0-9/._-]{1,40}$/;
const MAX_TITLE = 100;

const fail = (message: string) => new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, message);

/** The window title to look for: the project folder's name, bounded and without control characters. */
export function windowTitle(project: string): string {
  // Control characters become spaces; bidi and zero-width characters (invisible, so they could
  // make the confirmation text lie about the title) are dropped.
  return (
    (basename(project) || project)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(
        /[\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g,
        "",
      )
      .slice(0, MAX_TITLE)
  );
}

function checkTarget(target: TerminalTarget): void {
  if (target.tty !== undefined && (!TTY.test(target.tty) || target.tty.includes(".."))) {
    throw fail("The session's terminal device is not valid");
  }
  if (target.pid !== undefined && !(Number.isSafeInteger(target.pid) && target.pid > 0)) {
    throw fail("The session's process id is not valid");
  }
}

const FOCUS_TARGET_ENV = "PHOENIX_FOCUS_TARGET";
const FOCUS_TARGET_LINE = `set wanted to do shell script "printf %s \\"$${FOCUS_TARGET_ENV}\\""`;

/** Terminal.app: match a tab by its tty. iTerm2: match a session by its tty. */
const MAC_TTY_SCRIPT = [
  "on run",
  FOCUS_TARGET_LINE,
  'if application "Terminal" is running then',
  'tell application "Terminal"',
  "repeat with w in windows",
  "repeat with t in tabs of w",
  "if tty of t is wanted then",
  "set selected of t to true",
  "set index of w to 1",
  "activate",
  'return "terminal"',
  "end if",
  "end repeat",
  "end repeat",
  "end tell",
  "end if",
  'if application "iTerm2" is running then',
  'tell application "iTerm2"',
  "repeat with w in windows",
  "repeat with t in tabs of w",
  "repeat with s in sessions of t",
  "if tty of s is wanted then",
  "select t",
  "select s",
  "activate",
  'return "iterm"',
  "end if",
  "end repeat",
  "end repeat",
  "end repeat",
  "end tell",
  "end if",
  'error "no terminal window with that tty"',
  "end run",
];

/** By window name (Terminal.app and iTerm2 title contains the project folder). */
const MAC_TITLE_SCRIPT = [
  "on run",
  FOCUS_TARGET_LINE,
  'if application "Terminal" is running then',
  'tell application "Terminal"',
  "repeat with w in windows",
  "if name of w contains wanted then",
  "set index of w to 1",
  "activate",
  'return "terminal"',
  "end if",
  "end repeat",
  "end tell",
  "end if",
  'if application "iTerm2" is running then',
  'tell application "iTerm2"',
  "repeat with w in windows",
  "if name of w contains wanted then",
  "select w",
  "activate",
  'return "iterm"',
  "end if",
  "end repeat",
  "end tell",
  "end if",
  'error "no terminal window with that title"',
  "end run",
];

/**
 * osascript treats an argument that starts with `-` as one of its options (`-lJavaScript` selects
 * another language), so the tty/title never travels in argv: the script reads it from the
 * environment, byte for byte, through the shell it starts with a fixed command.
 */
const osascriptArgv = (script: readonly string[]): string[] =>
  script.flatMap((line) => ["-e", line]);

/** `/dev/ttysNNN` of the terminal a process runs in, from `ps -o tty=`; undefined for "??" or anything else. */
export async function ttyOfPid(exec: FocusExec, pid: number): Promise<string | undefined> {
  const done = await exec("ps", ["-o", "tty=", "-p", String(pid)]);
  const name = done.stdout.trim();
  return done.code === 0 && /^(?:tty|pts\/)[A-Za-z0-9]{1,20}$/.test(name)
    ? `/dev/${name}`
    : undefined;
}

export class MacTerminalFocuser implements TerminalFocuser {
  readonly platform = "darwin";
  constructor(private readonly exec: FocusExec) {}

  async focus(target: TerminalTarget): Promise<FocusResult> {
    checkTarget(target);
    const tty = target.tty ?? (target.pid ? await ttyOfPid(this.exec, target.pid) : undefined);
    if (tty) {
      const byTty = await this.exec("osascript", osascriptArgv(MAC_TTY_SCRIPT), {
        [FOCUS_TARGET_ENV]: tty,
      });
      if (byTty.code === 0)
        return { focused: true, method: `osascript:${byTty.stdout.trim() || "tty"}-tty` };
    }
    const byTitle = await this.exec("osascript", osascriptArgv(MAC_TITLE_SCRIPT), {
      [FOCUS_TARGET_ENV]: windowTitle(target.project),
    });
    if (byTitle.code === 0)
      return { focused: true, method: `osascript:${byTitle.stdout.trim() || "window"}-title` };
    throw fail(
      "No Terminal or iTerm2 window for this session was found (other terminals are not supported)",
    );
  }
}

export class LinuxTerminalFocuser implements TerminalFocuser {
  readonly platform = "linux";
  constructor(private readonly exec: FocusExec) {}

  async focus(target: TerminalTarget): Promise<FocusResult> {
    checkTarget(target);
    const title = windowTitle(target.project);
    const wmctrl = await this.exec("wmctrl", ["-a", title]);
    if (wmctrl.code === 0) return { focused: true, method: "wmctrl" };
    const found = await this.exec("xdotool", ["search", "--onlyvisible", "--name", "--", title]);
    const id = found.stdout
      .split("\n")
      .find((line) => /^[0-9]{1,12}$/.test(line.trim()))
      ?.trim();
    if (found.code === 0 && id) {
      const activated = await this.exec("xdotool", ["windowactivate", id]);
      if (activated.code === 0) return { focused: true, method: "xdotool" };
    }
    throw fail(
      "Could not focus a window: needs wmctrl or xdotool on an X11 desktop (Wayland does not allow it)",
    );
  }
}

/** Fixed script; the target is read from the environment, never spliced into the command. */
const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName Microsoft.VisualBasic",
  "$target = $env:PHOENIX_FOCUS_TARGET",
  "if ($target -match '^[0-9]+$') { [Microsoft.VisualBasic.Interaction]::AppActivate([int]$target) }",
  "else { [Microsoft.VisualBasic.Interaction]::AppActivate($target) }",
].join("; ");

export class WindowsTerminalFocuser implements TerminalFocuser {
  readonly platform = "win32";
  constructor(private readonly exec: FocusExec) {}

  async focus(target: TerminalTarget): Promise<FocusResult> {
    checkTarget(target);
    const attempts: { value: string; method: string }[] = [
      ...(target.pid ? [{ value: String(target.pid), method: "powershell:AppActivate-pid" }] : []),
      { value: windowTitle(target.project), method: "powershell:AppActivate-title" },
    ];
    for (const attempt of attempts) {
      const done = await this.exec(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT],
        { PHOENIX_FOCUS_TARGET: attempt.value },
      );
      if (done.code === 0) return { focused: true, method: attempt.method };
    }
    throw fail("No window for this session could be activated");
  }
}

/** The focuser for `platform`; throws CAPABILITY_UNAVAILABLE where none exists. */
export function focuserFor(platform: NodeJS.Platform, exec: FocusExec): TerminalFocuser {
  if (platform === "darwin") return new MacTerminalFocuser(exec);
  if (platform === "linux") return new LinuxTerminalFocuser(exec);
  if (platform === "win32") return new WindowsTerminalFocuser(exec);
  throw fail(`Jumping to a terminal is not supported on ${platform}`);
}
