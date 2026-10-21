// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  BROWSERS,
  UNTHROTTLE_FLAGS,
  findBrowser,
  parseBrowserStatus,
  type BrowserEntry,
} from "../../src/continuity";
import type { RunResult } from "../../src/system";
import { continuityRig, type RigOptions } from "./rig";

const CHROME = BROWSERS.find((b) => b.bundleId === "com.google.Chrome") as BrowserEntry;
const MAIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HELPER = `/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer --disable-background-timer-throttling`;
const FLAGS = UNTHROTTLE_FLAGS.join(" ");

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

describe("browser table", () => {
  it("has the five Chromium-family bundle ids and refuses all others", () => {
    expect(BROWSERS.map((b) => b.bundleId).sort()).toEqual([
      "ai.perplexity.comet",
      "com.brave.Browser",
      "com.google.Chrome",
      "com.microsoft.edgemac",
      "company.thebrowser.Browser",
    ]);
    expect(findBrowser("com.apple.Safari")).toBeUndefined();
    expect(findBrowser('com.google.Chrome" to quit & do shell script "x')).toBeUndefined();
    expect(findBrowser(undefined)).toBeUndefined();
  });
});

describe("parsing ps output", () => {
  it("running without the flags is throttled", () => {
    expect(parseBrowserStatus(`${MAIN}\n`, CHROME)).toMatchObject({
      running: true,
      throttled: true,
    });
    expect(parseBrowserStatus(`${MAIN} --profile-directory=Default\n`, CHROME)).toMatchObject({
      throttled: true,
    });
  });

  it("running with both flags is not throttled; one flag is not enough", () => {
    expect(parseBrowserStatus(`${MAIN} ${FLAGS}\n`, CHROME)).toMatchObject({
      running: true,
      throttled: false,
    });
    expect(parseBrowserStatus(`${MAIN} --disable-renderer-backgrounding\n`, CHROME)).toMatchObject({
      throttled: true,
    });
  });

  it("not running: only helper processes or other apps do not count", () => {
    expect(parseBrowserStatus("/usr/bin/other\n", CHROME)).toMatchObject({
      running: false,
      throttled: false,
    });
    expect(parseBrowserStatus(`${HELPER}\n`, CHROME)).toMatchObject({ running: false });
    expect(parseBrowserStatus(`${MAIN}-Canary --x\n`, CHROME)).toMatchObject({ running: false });
  });

  it("a flag appearing only in another process's arguments does not unthrottle the main process", () => {
    const text = `${MAIN}\n/bin/echo ${FLAGS}\n`;
    expect(parseBrowserStatus(text, CHROME)).toMatchObject({ throttled: true });
  });

  it("only a command line that BEGINS with the browser path is a running browser (decoys are not)", () => {
    const decoys = [
      `tail -f "${MAIN}"`,
      `/bin/echo ${MAIN}`,
      `grep ${MAIN} /tmp/x`,
      `/usr/bin/grep -c "${MAIN}"`,
      `sudo ${MAIN}`,
      `.${MAIN}`, // a relative path is not an installed app
    ];
    for (const decoy of decoys) {
      expect(parseBrowserStatus(`${decoy}\n`, CHROME)).toMatchObject({
        running: false,
        throttled: false,
      });
    }
    expect(parseBrowserStatus(`  ${MAIN} ${FLAGS}\n${decoys[0]}\n`, CHROME)).toMatchObject({
      running: true,
      throttled: false,
    });
    expect(parseBrowserStatus(`/Users/me/Applications${MAIN.slice(13)}\n`, CHROME)).toMatchObject({
      running: true,
    });
  });

  it("a decoy that merely mentions the browser path never counts as running, at relaunch either", async () => {
    const decoy = `tail -f "${MAIN}"`;
    const r = await continuityRig({
      config: on,
      script: (file) => (file === "/bin/ps" ? ok(`${decoy}\n`) : undefined),
    });
    expect(await r.call("throttle.relaunch", { bundle_id: "com.google.Chrome" })).toEqual({
      relaunched: false,
      reason: "not_running",
    });
    expect(r.sys.runs.map((x) => x.file)).toEqual(["/bin/ps"]);
    r.shutdown();
  });
});

/** Fake `ps` that lists the browser until `quit` ran, then (optionally) forever. */
function fakeBrowser(opts: { psFlags?: boolean; ignoreQuit?: boolean; quitCode?: number } = {}) {
  const state = { running: true, relaunchedWith: null as readonly string[] | null };
  const script: RigOptions["script"] = (file, args) => {
    if (file === "/bin/ps")
      return ok(state.running ? `${MAIN}${opts.psFlags ? ` ${FLAGS}` : ""}\n` : "");
    if (file === "/usr/bin/osascript") {
      if (!opts.ignoreQuit && (opts.quitCode ?? 0) === 0) state.running = false;
      return { code: opts.quitCode ?? 0, stdout: "", stderr: "" };
    }
    if (file === "/usr/bin/open") {
      state.relaunchedWith = args;
      return ok();
    }
    return undefined;
  };
  return { state, script };
}

const on = { continuity: { throttle_check: { enabled: true } } };

describe("throttle.status", () => {
  it("only reports; it runs ps and nothing that changes a browser", async () => {
    const b = fakeBrowser();
    const r = await continuityRig({ config: on, script: b.script });
    const status = await r.call("throttle.status");
    expect(status).toMatchObject({ supported: true });
    expect((status as { browsers: unknown[] }).browsers).toHaveLength(5);
    expect(r.sys.runs.map((x) => [x.file, ...x.args])).toEqual([["/bin/ps", "-axo", "command="]]);
    r.shutdown();
  });

  it("every tool is called by absolute path with exact argv (ps, osascript, open)", async () => {
    const b = fakeBrowser();
    const r = await continuityRig({ config: on, script: b.script });
    const pending = r.call("throttle.relaunch", { bundle_id: "com.google.Chrome" });
    for (let i = 0; i < 4; i++) await r.advance(500);
    await pending;
    const calls = r.sys.runs.map((x) => [x.file, ...x.args]);
    expect(calls.map((c) => c[0])).toEqual([
      "/bin/ps",
      "/usr/bin/osascript",
      "/bin/ps",
      "/usr/bin/open",
    ]);
    for (const c of calls.filter((x) => x[0] === "/bin/ps")) {
      expect(c).toEqual(["/bin/ps", "-axo", "command="]);
    }
    expect(calls[1]).toEqual([
      "/usr/bin/osascript",
      "-e",
      'tell application id "com.google.Chrome" to quit',
    ]);
    expect(calls[3]).toEqual([
      "/usr/bin/open",
      "-a",
      "Google Chrome",
      "--args",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ]);
    r.shutdown();
  });

  it("with the check off it runs nothing", async () => {
    const r = await continuityRig({ config: {} });
    expect(await r.call("throttle.status")).toEqual({ enabled: false, browsers: [] });
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });
});

describe("throttle.relaunch", () => {
  it("is an execute command whose schema lists only the table's bundle ids", async () => {
    const r = await continuityRig({ config: on });
    const spec = r.module.commandSpecs.find((s) => s.name === "throttle.relaunch");
    expect(spec?.side_effect).toBe("execute");
    expect(spec?.description).toMatch(/reload/);
    expect(JSON.stringify(spec?.input_schema)).toContain("com.brave.Browser");
    r.shutdown();
  });

  it("quits gracefully by bundle id, waits for exit, reopens with the exact argv", async () => {
    const b = fakeBrowser();
    const r = await continuityRig({ config: on, script: b.script });
    const pending = r.call("throttle.relaunch", { bundle_id: "com.google.Chrome" });
    for (let i = 0; i < 4; i++) await r.advance(500);
    expect(await pending).toEqual({ relaunched: true, bundle_id: "com.google.Chrome" });
    const calls = r.sys.runs.filter((x) => x.file !== "/bin/ps").map((x) => [x.file, ...x.args]);
    expect(calls).toEqual([
      ["/usr/bin/osascript", "-e", 'tell application id "com.google.Chrome" to quit'],
      [
        "/usr/bin/open",
        "-a",
        "Google Chrome",
        "--args",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    ]);
    expect(r.events.find((e) => e.event_type === "awake.throttle.relaunched")?.payload).toEqual({
      bundle_id: "com.google.Chrome",
    });
    r.shutdown();
  });

  it("refuses an unknown or injected bundle id without running anything", async () => {
    const r = await continuityRig({ config: on });
    for (const bad of ["com.apple.Safari", 'com.google.Chrome" to quit', ""]) {
      expect(await r.call("throttle.relaunch", { bundle_id: bad })).toEqual({
        relaunched: false,
        reason: "unknown_browser",
      });
    }
    await expect(r.call("throttle.relaunch", {})).rejects.toMatchObject({ kind: "invalid" });
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });

  it("refuses while a meeting or dictation is protected, and never quits the browser", async () => {
    const b = fakeBrowser();
    const r = await continuityRig({ config: on, script: b.script });
    await r.feed.publish("kage.meeting.recording", {});
    expect(await r.call("throttle.relaunch", { bundle_id: "com.google.Chrome" })).toEqual({
      relaunched: false,
      reason: "protected",
    });
    expect(r.sys.runs.map((x) => x.file)).not.toContain("/usr/bin/osascript");
    r.shutdown();
  });

  it("does not touch a browser that is not running or already unthrottled", async () => {
    const off = fakeBrowser();
    off.state.running = false;
    const a = await continuityRig({ config: on, script: off.script });
    expect(await a.call("throttle.relaunch", { bundle_id: "com.google.Chrome" })).toEqual({
      relaunched: false,
      reason: "not_running",
    });
    const flagged = fakeBrowser({ psFlags: true });
    const b = await continuityRig({ config: on, script: flagged.script });
    expect(await b.call("throttle.relaunch", { bundle_id: "com.google.Chrome" })).toEqual({
      relaunched: false,
      reason: "already_unthrottled",
    });
    expect([...a.sys.runs, ...b.sys.runs].map((x) => x.file)).toEqual(["/bin/ps", "/bin/ps"]);
    a.shutdown();
    b.shutdown();
  });

  it("never force-kills: if the browser stays up after the quit request it reports and does not reopen", async () => {
    const b = fakeBrowser({ ignoreQuit: true });
    const r = await continuityRig({ config: on, script: b.script });
    const pending = r.call("throttle.relaunch", { bundle_id: "com.google.Chrome" });
    for (let i = 0; i < 25; i++) await r.advance(500);
    expect(await pending).toEqual({ relaunched: false, reason: "still_running" });
    expect(r.sys.runs.map((x) => x.file)).not.toContain("/usr/bin/open");
    expect(r.sys.runs.map((x) => x.file)).not.toContain("kill");
    r.shutdown();
  });

  it("a failed quit does not reopen", async () => {
    const b = fakeBrowser({ quitCode: 1 });
    const r = await continuityRig({ config: on, script: b.script });
    expect(await r.call("throttle.relaunch", { bundle_id: "com.google.Chrome" })).toEqual({
      relaunched: false,
      reason: "quit_failed",
    });
    expect(r.sys.runs.map((x) => x.file)).not.toContain("/usr/bin/open");
    r.shutdown();
  });

  it("is refused when the check is off, and on other platforms", async () => {
    const off = await continuityRig({ config: {} });
    await expect(
      off.call("throttle.relaunch", { bundle_id: "com.google.Chrome" }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    const linux = await continuityRig({ config: on, platform: "linux" });
    await expect(
      linux.call("throttle.relaunch", { bundle_id: "com.google.Chrome" }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect([...off.sys.runs, ...linux.sys.runs]).toEqual([]);
    off.shutdown();
    linux.shutdown();
  });
});
