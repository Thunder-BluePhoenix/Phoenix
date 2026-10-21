// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Browser throttling check (macOS, UNVERIFIED on a real Mac). Chromium-family browsers slow
// background tabs' timers and renderers; an agent web UI left in a background tab can stall.
// Two Chromium switches turn that off: --disable-background-timer-throttling and
// --disable-renderer-backgrounding. Detection is read-only: one `ps` listing, parsed for the
// browser's MAIN process (helpers carry --type=) and those two switches. A browser running without
// them is reported "throttled". Nothing is ever changed except by the explicit relaunch command:
// quit gracefully (osascript, bundle id taken from the table below, never from input text), wait
// for it to exit, reopen with `open -a <app name> --args <flags>`. Tabs reload; the caller shows
// that warning and asks the user to confirm every time.
import type { Runner } from "../system";

/** Absolute paths: the PATH is never searched for these tools. */
export const PS = "/bin/ps";
export const OSASCRIPT = "/usr/bin/osascript";
export const OPEN = "/usr/bin/open";

export interface BrowserEntry {
  bundleId: string;
  /** Display name and the `open -a` argument. */
  appName: string;
  /** The main executable inside `<appName>.app/Contents/MacOS/`. */
  executable: string;
}

/** The only browsers this module ever touches. Names are UNVERIFIED against real installs. */
export const BROWSERS: readonly BrowserEntry[] = [
  { bundleId: "com.google.Chrome", appName: "Google Chrome", executable: "Google Chrome" },
  { bundleId: "company.thebrowser.Browser", appName: "Arc", executable: "Arc" },
  { bundleId: "ai.perplexity.comet", appName: "Comet", executable: "Comet" },
  { bundleId: "com.microsoft.edgemac", appName: "Microsoft Edge", executable: "Microsoft Edge" },
  { bundleId: "com.brave.Browser", appName: "Brave Browser", executable: "Brave Browser" },
];

export const UNTHROTTLE_FLAGS: readonly string[] = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
];

export function findBrowser(bundleId: unknown): BrowserEntry | undefined {
  return typeof bundleId === "string" ? BROWSERS.find((b) => b.bundleId === bundleId) : undefined;
}

export interface BrowserStatus {
  bundle_id: string;
  name: string;
  running: boolean;
  /** Running without both switches: background tabs are likely throttled. */
  throttled: boolean;
}

/**
 * Splits `ps -axo command=` output into lines; a line is one process's command line. A line counts
 * only when it BEGINS with the browser's path: it starts with `/` and the text before the
 * `/<app>.app/Contents/MacOS/<exe>` marker has no whitespace and no quote, so `tail -f "<path>"`,
 * `/bin/echo <path>` or `grep <path>` (the path only in the arguments) is never a running browser.
 */
export function parseBrowserStatus(psOutput: string, browser: BrowserEntry): BrowserStatus {
  const marker = `/${browser.appName}.app/Contents/MacOS/${browser.executable}`;
  let running = false;
  let throttled = false;
  for (const raw of psOutput.split("\n")) {
    const line = raw.trimStart();
    if (!line.startsWith("/")) continue;
    const at = line.indexOf(marker);
    if (at === -1 || /[\s"'`]/.test(line.slice(0, at))) continue;
    const rest = line.slice(at + marker.length);
    if (rest !== "" && !rest.startsWith(" ")) continue; // another executable with this prefix
    if (/\s--type=/.test(rest)) continue; // renderer, GPU, utility helpers
    running = true;
    if (!UNTHROTTLE_FLAGS.every((flag) => new RegExp(`(^|\\s)${flag}(\\s|=|$)`).test(rest))) {
      throttled = true;
    }
  }
  return { bundle_id: browser.bundleId, name: browser.appName, running, throttled };
}

export type RelaunchRefusal =
  "unknown_browser" | "protected" | "not_running" | "already_unthrottled" | "unavailable";

export type RelaunchResult =
  | { relaunched: true; bundle_id: string }
  | {
      relaunched: false;
      reason: RelaunchRefusal | "quit_failed" | "still_running" | "open_failed";
    };

export interface ThrottleOptions {
  run: Runner;
  /** True when this browser must not be quit now (a meeting, a recording, dictation). */
  isProtected: (bundleId: string) => boolean;
  sleep: (ms: number) => Promise<void>;
}

const READ_TIMEOUT_MS = 10_000;
const QUIT_TIMEOUT_MS = 15_000;
const EXIT_POLL_MS = 500;
const EXIT_POLLS = 20;

export class ThrottleChecker {
  constructor(private readonly o: ThrottleOptions) {}

  private async list(): Promise<string | null> {
    const ps = await this.o.run(PS, ["-axo", "command="], { timeoutMs: READ_TIMEOUT_MS });
    return ps.code === 0 ? ps.stdout : null;
  }

  /** Read-only. Browsers not running are listed too (running: false), so the UI shows the table. */
  async status(): Promise<BrowserStatus[] | null> {
    const out = await this.list();
    return out === null ? null : BROWSERS.map((b) => parseBrowserStatus(out, b));
  }

  /** Only on explicit command, after the caller's confirmation. */
  async relaunch(bundleId: unknown): Promise<RelaunchResult> {
    const browser = findBrowser(bundleId);
    if (!browser) return { relaunched: false, reason: "unknown_browser" };
    if (this.o.isProtected(browser.bundleId)) return { relaunched: false, reason: "protected" };
    const before = await this.list();
    if (before === null) return { relaunched: false, reason: "unavailable" };
    const state = parseBrowserStatus(before, browser);
    if (!state.running) return { relaunched: false, reason: "not_running" };
    if (!state.throttled) return { relaunched: false, reason: "already_unthrottled" };

    const quit = await this.o.run(
      OSASCRIPT,
      ["-e", `tell application id "${browser.bundleId}" to quit`],
      { timeoutMs: QUIT_TIMEOUT_MS },
    );
    if (quit.code !== 0) return { relaunched: false, reason: "quit_failed" };

    for (let poll = 0; poll < EXIT_POLLS; poll++) {
      const now = await this.list();
      if (now !== null && !parseBrowserStatus(now, browser).running) {
        const open = await this.o.run(
          OPEN,
          ["-a", browser.appName, "--args", ...UNTHROTTLE_FLAGS],
          { timeoutMs: READ_TIMEOUT_MS },
        );
        return open.code === 0
          ? { relaunched: true, bundle_id: browser.bundleId }
          : { relaunched: false, reason: "open_failed" };
      }
      await this.o.sleep(EXIT_POLL_MS);
    }
    // Quit was asked for but the app is still up (a "restore tabs?" dialog, say): never force it.
    return { relaunched: false, reason: "still_running" };
  }
}
