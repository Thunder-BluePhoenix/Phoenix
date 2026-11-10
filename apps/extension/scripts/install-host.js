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
// browser whose id you did not pass is skipped. macOS and Linux only: Windows needs a registry
// entry this script does not write.
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const HOST_NAME = "dev.phoenix.companion";
export const CHROME_ID = /^[a-p]{32}$/;
export const FIREFOX_ID = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/;
const DESCRIPTION = "Phoenix: send page to your local Phoenix";

const CHROMIUM_FAMILY = ["chrome", "chromium", "edge"];
const ALL = [...CHROMIUM_FAMILY, "firefox"];

/** Per-user NativeMessagingHosts directory for each browser, or `null` when unsupported. */
export function hostDirectory(browser, platform, home) {
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

export function install({ browsers, ids, home, platform, nodePath, root, log }) {
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

export function uninstall({ browsers, home, platform, root, log }) {
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

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
