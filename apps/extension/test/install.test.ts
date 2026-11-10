// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  hostDirectory,
  install,
  launcherScript,
  uninstall,
} from "../scripts/install-host.js";

const CHROME = "abcdefghijklmnopabcdefghijklmnop";

describe("native-messaging host manifest", () => {
  it("lists exactly the id given and never a wildcard", () => {
    expect(buildManifest("chrome", "/x/launch.sh", { chrome: CHROME })).toEqual({
      name: "dev.phoenix.companion",
      description: expect.any(String),
      path: "/x/launch.sh",
      type: "stdio",
      allowed_origins: [`chrome-extension://${CHROME}/`],
    });
    expect(
      buildManifest("firefox", "/x", { firefox: "phoenix-send-page@phoenix.invalid" }),
    ).toMatchObject({
      allowed_extensions: ["phoenix-send-page@phoenix.invalid"],
    });
    for (const bad of [
      "*",
      "",
      "abc",
      `${CHROME}/`,
      "chrome-extension://*/",
      CHROME.toUpperCase(),
      `${CHROME}a`,
    ]) {
      expect(() => buildManifest("edge", "/x", { chrome: bad }), bad).toThrow();
    }
    for (const bad of ["*", "", "no-at-sign", "a@b c"]) {
      expect(() => buildManifest("firefox", "/x", { firefox: bad }), bad).toThrow();
    }
  });

  it("installs per user only, skips a browser without an id, and uninstalls", () => {
    const home = mkdtempSync(join(tmpdir(), "phoenix-ext-"));
    const root = mkdtempSync(join(tmpdir(), "phoenix-ext-root-"));
    mkdirSync(join(root, "host"));
    writeFileSyncSafe(join(root, "host", "main.js"));
    const log: string[] = [];
    const wrote = install({
      browsers: ["chrome", "chromium", "edge", "firefox"],
      ids: { chrome: CHROME },
      home,
      platform: "darwin",
      nodePath: "/usr/local/bin/node",
      root,
      log: (m: string) => log.push(m),
    });
    expect(wrote).toHaveLength(3);
    expect(log.some((l) => l.includes("skipped firefox"))).toBe(true);
    for (const file of wrote) {
      expect(file.startsWith(home)).toBe(true);
      expect(JSON.parse(readFileSync(file, "utf8")).allowed_origins).toEqual([
        `chrome-extension://${CHROME}/`,
      ]);
    }
    const launcher = join(root, "host", "phoenix-host.sh");
    expect(readFileSync(launcher, "utf8")).toBe(
      launcherScript("/usr/local/bin/node", join(root, "host", "main.js")),
    );
    expect(statSync(launcher).mode & 0o111).not.toBe(0);
    uninstall({
      browsers: ["chrome", "chromium", "edge", "firefox"],
      home,
      platform: "darwin",
      root,
      log: () => {},
    });
    for (const file of wrote) expect(existsSync(file)).toBe(false);
    expect(existsSync(launcher)).toBe(false);
  });

  it("has a per-user directory on macOS and Linux only", () => {
    expect(hostDirectory("chrome", "darwin", "/h")).toBe(
      "/h/Library/Application Support/Google/Chrome/NativeMessagingHosts",
    );
    expect(hostDirectory("firefox", "linux", "/h")).toBe("/h/.mozilla/native-messaging-hosts");
    expect(hostDirectory("chrome", "win32", "/h")).toBeNull();
  });

  it("quotes a path with an apostrophe in the launcher", () => {
    expect(launcherScript("/o'k/node", "/h.js")).toBe("#!/bin/sh\nexec '/o'\\''k/node' '/h.js'\n");
  });
});

import { writeFileSync } from "node:fs";
function writeFileSyncSafe(path: string) {
  writeFileSync(path, "");
}
