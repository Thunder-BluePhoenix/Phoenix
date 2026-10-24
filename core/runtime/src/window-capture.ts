// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 62 "attach a window as context" (macOS), the reader. It runs ONE fixed AppleScript through
// `osascript` (one `-e` argument per line, no shell, NO variable argument of any kind), which asks
// System Events (the macOS Accessibility API) for the frontmost application, its front window's
// title and the text of that window's static text, text area and text field elements.
//
// Rules this file keeps:
//   * No input reaches the script or the argv: nothing can become code. `WINDOW_SCRIPT_ARGV` is a
//     constant and the exec seam is handed exactly that.
//   * Bounded: 5 s deadline, 512 KB of output read, 100,000 characters of text kept. A deadline hit is
//     an error (`window_timeout`), never a partial answer; too much output is cut and says so.
//   * The text is untrusted DATA. It is never interpreted, only cleaned of control, bidi,
//     zero-width and line/paragraph separator characters (new lines are kept) and returned.
//   * Phoenix's own window (the desktop app, or a browser tab titled "Phoenix") is never returned.
//   * When macOS denies Accessibility or Automation the result is `accessibility_not_granted`. The
//     reader never retries, never opens a settings pane and never asks again by itself.
//
// NOT verified against a real Mac, a real window or a real Accessibility grant: the tests drive this
// with a fake `exec` that returns what a real run is expected to print.
import { execFile } from "node:child_process";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

export const WINDOW_TIMEOUT_MS = 5_000;
/** Bytes of osascript output read; more is cut and the capture is marked truncated. */
export const WINDOW_MAX_OUTPUT_BYTES = 512 * 1024;
export const WINDOW_MAX_TEXT_CHARS = 100_000;
export const WINDOW_MAX_TITLE_CHARS = 120;
export const WINDOW_MAX_APP_CHARS = 60;

/** The bundle id of Phoenix's desktop shell (apps/desktop/src-tauri/tauri.conf.json). */
export const PHOENIX_BUNDLE_ID = "dev.phoenix.desktop";

/** ASCII record separator: the four fields of the answer are joined with it. */
const SEP = "\u001e";

/** The fixed script. Edit with care: no `${}` of any input is ever allowed in here. */
export const WINDOW_SCRIPT: readonly string[] = [
  "on collect(w)",
  'set out to ""',
  'tell application "System Events"',
  "set els to entire contents of w",
  "repeat with e in els",
  "try",
  "set r to role of e",
  'if r is "AXStaticText" or r is "AXTextArea" or r is "AXTextField" then',
  "set v to value of e",
  'if v is not missing value and v is not "" then',
  "set out to out & v & linefeed",
  "if (length of out) > 120000 then exit repeat",
  "end if",
  "end if",
  "end try",
  "end repeat",
  "end tell",
  "return out",
  "end collect",
  "on run",
  "set sep to character id 30",
  'tell application "System Events"',
  "set p to first application process whose frontmost is true",
  "set appName to name of p",
  'set bundleId to ""',
  "try",
  "set bundleId to bundle identifier of p",
  "end try",
  "try",
  "set w to window 1 of p",
  "on error errText number errNum",
  "if errNum is -25211 or errNum is -1743 then error errText number errNum",
  'return appName & sep & bundleId & sep & "" & sep & ""',
  "end try",
  'set winTitle to ""',
  "try",
  "set winTitle to name of w",
  "end try",
  "set bodyText to my collect(w)",
  "return appName & sep & bundleId & sep & winTitle & sep & bodyText",
  "end tell",
  "end run",
];

/** The argv handed to `osascript`: `-e <line>` for every line of the script, nothing else. */
export const WINDOW_SCRIPT_ARGV: readonly string[] = WINDOW_SCRIPT.flatMap((line) => ["-e", line]);

export interface WindowExecResult {
  /** Exit code; null when the process was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The deadline passed and the process was stopped. */
  timedOut: boolean;
  /** The output limit was reached and the process was stopped; `stdout` holds what was read. */
  outputCapped: boolean;
}

/** Runs `file argv` (no shell, minimal environment). Tests inject a fake. */
export type WindowExec = (
  file: string,
  argv: readonly string[],
  limits: { timeoutMs: number; maxOutputBytes: number },
) => Promise<WindowExecResult>;

/** The real exec. stderr is returned to this module only (to recognise a denial); it is never forwarded. */
export const execWindow: WindowExec = (file, argv, limits) => {
  const done = Promise.withResolvers<WindowExecResult>();
  execFile(
    file,
    [...argv],
    {
      timeout: limits.timeoutMs,
      maxBuffer: limits.maxOutputBytes,
      windowsHide: true,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    },
    (err, stdout, stderr) => {
      const capped = err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      done.resolve({
        code: err ? (typeof err.code === "number" ? err.code : null) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? "").slice(0, 2_000),
        // A stop for the output limit also sets `killed`; only the other kills are the deadline.
        timedOut: err !== null && err.killed === true && !capped,
        outputCapped: capped,
      });
    },
  );
  return done.promise;
};

export type WindowReadResult =
  | {
      status: "captured";
      app: string;
      title: string;
      text: string;
      /** Output over the limit, or text over the character limit, was cut. */
      truncated: boolean;
    }
  | { status: "accessibility_not_granted" }
  | { status: "phoenix_window" }
  | { status: "no_window" };

/** macOS "not allowed assistive access" (-25211) and "not authorised to send Apple events" (-1743). */
const DENIED =
  /(?:-25211|-1743|not allowed assistive access|not authori[sz]ed to send apple events)/iu;

/** Control, format (bidi, zero-width) and separator characters. Text is split on line feeds first, so those survive. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, " ")
    .split("\n")
    .map((line) => line.replace(HIDDEN, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function cleanLine(raw: string, max: number): string {
  // Control and separator characters become a space; invisible format characters (bidi, zero-width) vanish.
  return raw
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/ {2,}/gu, " ")
    .trim()
    .slice(0, max);
}

const OWN_TITLE = /^Phoenix(?:\s|$|[-—–|:·])|[\s\-—–|:·]Phoenix\s*$/iu;

/** True for the Phoenix desktop app, and for a window (a browser tab, say) whose title is Phoenix's. */
export function isPhoenixWindow(app: string, bundleId: string, title: string): boolean {
  return bundleId === PHOENIX_BUNDLE_ID || app.toLowerCase() === "phoenix" || OWN_TITLE.test(title);
}

/** Reads the frontmost non-Phoenix window once. Throws PhoenixError for a timeout or a failed run. */
export async function readFrontWindow(
  exec: WindowExec,
  platform: NodeJS.Platform,
): Promise<WindowReadResult> {
  if (platform !== "darwin")
    throw new PhoenixError(
      ErrorCode.CAPABILITY_UNAVAILABLE,
      "Attaching a window is only available on macOS",
    );
  const run = await exec("osascript", WINDOW_SCRIPT_ARGV, {
    timeoutMs: WINDOW_TIMEOUT_MS,
    maxOutputBytes: WINDOW_MAX_OUTPUT_BYTES,
  });
  if (run.timedOut)
    throw new PhoenixError(
      ErrorCode.OPERATION_TIMEOUT,
      "Reading the window took longer than 5 seconds and was stopped",
    );
  if (!run.outputCapped && run.code !== 0) {
    if (DENIED.test(run.stderr)) return { status: "accessibility_not_granted" };
    // stderr can hold window text or paths, so it is not forwarded.
    throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "macOS could not read that window");
  }
  const parts = run.stdout.replace(/\n$/u, "").split(SEP);
  if (parts.length !== 4)
    throw new PhoenixError(
      ErrorCode.CAPABILITY_UNAVAILABLE,
      "macOS returned a window answer Phoenix could not read",
    );
  const [rawApp = "", rawBundle = "", rawTitle = "", rawText = ""] = parts;
  const app = cleanLine(rawApp, WINDOW_MAX_APP_CHARS);
  const title = cleanLine(rawTitle, WINDOW_MAX_TITLE_CHARS);
  if (isPhoenixWindow(app, rawBundle.trim(), title)) return { status: "phoenix_window" };
  const cleaned = cleanText(rawText);
  if (app === "" || (title === "" && cleaned === "")) return { status: "no_window" };
  const cut = cleaned.length > WINDOW_MAX_TEXT_CHARS;
  return {
    status: "captured",
    app,
    title,
    text: cut ? cleaned.slice(0, WINDOW_MAX_TEXT_CHARS) : cleaned,
    truncated: cut || run.outputCapped,
  };
}
