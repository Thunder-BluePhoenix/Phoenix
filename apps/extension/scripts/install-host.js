// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Installs or removes the native-messaging host manifest `dev.phoenix.companion` for Chrome,
// Chromium, Edge and Firefox, in the per-user location only (never system-wide, never as root).
//
//   node scripts/install-host.js install   --chrome-id <32 letters a-p> [--firefox-id <id>] [--browser chrome,chromium,edge,firefox]
//   node scripts/install-host.js uninstall [--browser ...]
//
// `allowed_origins` / `allowed_extensions` list exactly the ids you pass; there is no wildcard. A
// browser whose id you did not pass is skipped.
//
// macOS and Linux: a manifest file in the browser's per-user NativeMessagingHosts directory and a
// `phoenix-host.sh` launcher.
//
// Windows: a manifest file under %LOCALAPPDATA%\Phoenix\NativeMessagingHosts\<browser>, a
// `phoenix-host.cmd` launcher, and one per-user registry key per browser whose default value is the
// manifest path, written by spawning reg.exe with an argument array (no shell). The registry layout
// is from:
//   Chrome:   https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
//             (HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\<name>)
//   Chromium: https://issues.chromium.org/issues/40140543 (Chromium reads
//             HKCU\Software\Chromium\NativeMessagingHosts and falls back to the Chrome key)
//   Edge:     https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging
//             (HKCU\Software\Microsoft\Edge\NativeMessagingHosts\<name>)
//   Firefox:  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests#manifest_location
//             (HKCU\SOFTWARE\Mozilla\NativeMessagingHosts\<name>; a .bat/.cmd launcher is the
//             documented way to start a script host on Windows, see the Native_messaging page)
// The Windows branch has NEVER been run on Windows: it is tested only with an injected fake file
// system and an injected fake reg.exe runner.
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const HOST_NAME = "dev.phoenix.companion";
export const CHROME_ID = /^[a-p]{32}$/;
export const FIREFOX_ID = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/;
const DESCRIPTION = "Phoenix: send page to your local Phoenix";

const CHROMIUM_FAMILY = ["chrome", "chromium", "edge"];
const ALL = [...CHROMIUM_FAMILY, "firefox"];

/** Registry key (under HKCU) per browser. The default value holds the manifest's path. */
const WINDOWS_REGISTRY = {
  chrome: "Software\\Google\\Chrome\\NativeMessagingHosts",
  chromium: "Software\\Chromium\\NativeMessagingHosts",
  edge: "Software\\Microsoft\\Edge\\NativeMessagingHosts",
  firefox: "Software\\Mozilla\\NativeMessagingHosts",
};

/** The full per-user registry key for a browser, or `null` for an unknown browser. */
export function registryKey(browser) {
  return Object.hasOwn(WINDOWS_REGISTRY, browser)
    ? `HKCU\\${WINDOWS_REGISTRY[browser]}\\${HOST_NAME}`
    : null;
}

/**
 * Per-user directory for each browser's manifest, or `null` when unsupported. On Windows the
 * directory is Phoenix's own (the browser is pointed at the file by the registry, not by location).
 */
export function hostDirectory(browser, platform, home, localAppData) {
  if (platform === "win32") {
    if (!Object.hasOwn(WINDOWS_REGISTRY, browser)) return null;
    const base = localAppData ?? win32.join(home, "AppData", "Local");
    return win32.join(base, "Phoenix", "NativeMessagingHosts", browser);
  }
  const mac = {
    chrome: "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    chromium: "Library/Application Support/Chromium/NativeMessagingHosts",
    edge: "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    firefox: "Library/Application Support/Mozilla/NativeMessagingHosts",
  };
  const linux = {
    chrome: ".config/google-chrome/NativeMessagingHosts",
    chromium: ".config/chromium/NativeMessagingHosts",
    edge: ".config/microsoft-edge/NativeMessagingHosts",
    firefox: ".mozilla/native-messaging-hosts",
  };
  const table = platform === "darwin" ? mac : platform === "linux" ? linux : null;
  return table && Object.hasOwn(table, browser) ? join(home, table[browser]) : null;
}

/** The manifest a browser reads. The ids are validated here, so a wildcard cannot be written. */
export function buildManifest(browser, launcherPath, ids) {
  const base = { name: HOST_NAME, description: DESCRIPTION, path: launcherPath, type: "stdio" };
  if (browser === "firefox") {
    if (!FIREFOX_ID.test(ids.firefox ?? "")) throw new Error("A valid --firefox-id is required");
    return { ...base, allowed_extensions: [ids.firefox] };
  }
  if (!CHROME_ID.test(ids.chrome ?? "")) {
    throw new Error("--chrome-id must be the 32-letter (a-p) extension id");
  }
  return { ...base, allowed_origins: [`chrome-extension://${ids.chrome}/`] };
}

/** The launcher the browser executes: a fixed node binary and host path, no arguments from outside. */
export function launcherScript(nodePath, hostPath) {
  const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\nexec ${quote(nodePath)} ${quote(hostPath)}\n`;
}

// A Windows path this installer will put inside a .cmd file or pass to reg.exe. It is deliberately
// narrow: an absolute drive path of ASCII letters, digits, space and `. _ + -`, with no quote, no
// `%` (expanded inside quotes by cmd), no `^ & | < > ( ) ! ; , = ' ` and no non-ASCII (the
// .cmd is read in the OEM code page, so other characters would be mangled). A segment may not
// start with a space or end with a space or dot, which also rules out `.` and `..`.
const WINDOWS_SEGMENT = String.raw`(?! )[A-Za-z0-9 ._+-]*[A-Za-z0-9_+-]`;
const WINDOWS_PATH = new RegExp(
  String.raw`^[A-Za-z]:\\(?:${WINDOWS_SEGMENT}\\)*${WINDOWS_SEGMENT}$`,
);
export function isSafeWindowsPath(path) {
  return typeof path === "string" && path.length <= 240 && WINDOWS_PATH.test(path);
}

function requireSafeWindowsPath(label, path) {
  if (!isSafeWindowsPath(path)) {
    throw new Error(
      `${label} is not a path this installer will write on Windows (an absolute drive path of ASCII letters, digits, spaces and . _ + - only): ${JSON.stringify(path)}`,
    );
  }
}

/** The Windows launcher: a fixed node binary and host path, quoted, no arguments from outside. */
export function windowsLauncherScript(nodePath, hostPath) {
  requireSafeWindowsPath("The node path", nodePath);
  requireSafeWindowsPath("The host path", hostPath);
  return `@echo off\r\n"${nodePath}" "${hostPath}"\r\n`;
}

const realFs = { existsSync, mkdirSync, rmSync, writeFileSync };

function runRegChecked(runReg, args) {
  const result = runReg(args);
  if (result.status !== 0) {
    throw new Error(
      `reg ${args[0]} failed (exit ${result.status}): ${String(result.stderr ?? "").trim()}`,
    );
  }
}

function installWindows({ browsers, ids, home, localAppData, nodePath, root, log, fs, runReg }) {
  const launcher = win32.join(root, "host", "phoenix-host.cmd");
  const hostPath = win32.join(root, "host", "main.js");
  const launcherText = windowsLauncherScript(nodePath, hostPath); // validates both paths
  requireSafeWindowsPath("The launcher path", launcher);
  if (!fs.existsSync(hostPath)) throw new Error(`Missing ${hostPath}`);
  const plan = [];
  for (const browser of browsers) {
    const ok =
      browser === "firefox" ? FIREFOX_ID.test(ids.firefox ?? "") : CHROME_ID.test(ids.chrome ?? "");
    if (!ok) {
      log(`skipped ${browser}: no extension id given for it`);
      continue;
    }
    const dir = hostDirectory(browser, "win32", home, localAppData);
    if (dir === null) throw new Error(`${browser} is not supported on win32`);
    const file = win32.join(dir, `${HOST_NAME}.json`);
    requireSafeWindowsPath("The manifest path", file);
    plan.push({ browser, dir, file, manifest: buildManifest(browser, launcher, ids) });
  }
  // Nothing is written until every path and id has been validated.
  const done = [];
  if (plan.length > 0) fs.writeFileSync(launcher, launcherText);
  for (const { browser, dir, file, manifest } of plan) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    log(`wrote ${file}`);
    runRegChecked(runReg, ["add", registryKey(browser), "/ve", "/d", file, "/f"]);
    log(`registered ${registryKey(browser)}`);
    done.push(file);
  }
  return done;
}

function uninstallWindows({ browsers, home, localAppData, root, log, fs, runReg }) {
  const removed = [];
  for (const browser of browsers) {
    const key = registryKey(browser);
    if (key === null) throw new Error(`${browser} is not supported on win32`);
    // `reg query` first: deleting a key that does not exist is not an error for the person.
    if (runReg(["query", key]).status === 0) {
      runRegChecked(runReg, ["delete", key, "/f"]);
      log(`unregistered ${key}`);
    }
    const file = win32.join(
      hostDirectory(browser, "win32", home, localAppData),
      `${HOST_NAME}.json`,
    );
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      log(`removed ${file}`);
      removed.push(file);
    }
  }
  fs.rmSync(win32.join(root, "host", "phoenix-host.cmd"), { force: true });
  return removed;
}

export function install({
  browsers,
  ids,
  home,
  platform,
  nodePath,
  root,
  log,
  localAppData,
  fs = realFs,
  runReg,
}) {
  if (platform === "win32") {
    if (typeof runReg !== "function") throw new Error("A registry runner is required on win32");
    return installWindows({ browsers, ids, home, localAppData, nodePath, root, log, fs, runReg });
  }
  const launcher = join(root, "host", "phoenix-host.sh");
  const hostPath = join(root, "host", "main.js");
  if (!existsSync(hostPath)) throw new Error(`Missing ${hostPath}`);
  const done = [];
  for (const browser of browsers) {
    const dir = hostDirectory(browser, platform, home);
    if (dir === null) throw new Error(`${platform} is not supported`);
    const ok =
      browser === "firefox" ? FIREFOX_ID.test(ids.firefox ?? "") : CHROME_ID.test(ids.chrome ?? "");
    if (!ok) {
      log(`skipped ${browser}: no extension id given for it`);
      continue;
    }
    writeFileSync(launcher, launcherScript(nodePath, hostPath), { mode: 0o755 });
    chmodSync(launcher, 0o755);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${HOST_NAME}.json`);
    writeFileSync(file, `${JSON.stringify(buildManifest(browser, launcher, ids), null, 2)}\n`);
    log(`wrote ${file}`);
    done.push(file);
  }
  return done;
}

export function uninstall({
  browsers,
  home,
  platform,
  root,
  log,
  localAppData,
  fs = realFs,
  runReg,
}) {
  if (platform === "win32") {
    if (typeof runReg !== "function") throw new Error("A registry runner is required on win32");
    return uninstallWindows({ browsers, home, localAppData, root, log, fs, runReg });
  }
  const removed = [];
  for (const browser of browsers) {
    const dir = hostDirectory(browser, platform, home);
    if (dir === null) throw new Error(`${platform} is not supported`);
    const file = join(dir, `${HOST_NAME}.json`);
    if (existsSync(file)) {
      rmSync(file);
      log(`removed ${file}`);
      removed.push(file);
    }
  }
  rmSync(join(root, "host", "phoenix-host.sh"), { force: true });
  return removed;
}

/**
 * The real reg.exe runner: the system reg.exe by absolute path, an argument array, no shell. Never
 * run on Windows by the authors.
 */
export function makeRegRunner(systemRoot, spawn = spawnSync) {
  const root = systemRoot ?? "C:\\Windows";
  requireSafeWindowsPath("SystemRoot", root);
  const exe = win32.join(root, "System32", "reg.exe");
  return (args) => {
    const result = spawn(exe, args, { shell: false, windowsHide: true, encoding: "utf8" });
    return {
      status: result.error ? 1 : result.status,
      stderr: result.error?.message ?? result.stderr,
    };
  };
}

function main(argv) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "chrome-id": { type: "string" },
      "firefox-id": { type: "string" },
      browser: { type: "string" },
    },
  });
  const command = positionals[0];
  const browsers = (values.browser ?? ALL.join(",")).split(",").map((b) => b.trim());
  const bad = browsers.find((b) => !ALL.includes(b));
  if (bad || (command !== "install" && command !== "uninstall")) {
    console.error(
      `usage: install-host.js install|uninstall [--chrome-id ID] [--firefox-id ID] [--browser ${ALL.join(",")}]`,
    );
    return 2;
  }
  const root = resolve(dirname(import.meta.dirname), ".");
  const common = { browsers, home: homedir(), platform: process.platform, root, log: console.log };
  try {
    if (process.platform === "win32") {
      common.localAppData = process.env.LOCALAPPDATA;
      common.runReg = makeRegRunner(process.env.SystemRoot);
    }
    if (command === "install") {
      const wrote = install({
        ...common,
        ids: { chrome: values["chrome-id"], firefox: values["firefox-id"] },
        nodePath: process.execPath,
      });
      if (wrote.length === 0)
        throw new Error("Nothing installed: pass --chrome-id and/or --firefox-id");
    } else uninstall(common);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
