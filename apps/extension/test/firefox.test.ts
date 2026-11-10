// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Firefox manifest emitter. The output was never loaded in Firefox.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIREFOX_GECKO_ID,
  FIREFOX_MIN_VERSION,
  buildFirefoxManifest,
  emitFirefox,
} from "../scripts/build-firefox.js";
import { buildManifest } from "../scripts/install-host.js";

const root = new URL("..", import.meta.url).pathname;
const chrome = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

describe("Firefox manifest", () => {
  const ff = buildFirefoxManifest(chrome);

  it("swaps service_worker for scripts and adds gecko id and min version", () => {
    expect(chrome.background.service_worker).toBe("src/background.js");
    expect(ff.background).toEqual({ scripts: ["src/background.js"], type: "module" });
    expect(ff.browser_specific_settings).toEqual({
      gecko: { id: FIREFOX_GECKO_ID, strict_min_version: FIREFOX_MIN_VERSION },
    });
    expect(Number.parseInt(FIREFOX_MIN_VERSION, 10)).toBeGreaterThanOrEqual(112);
  });

  it("changes nothing else: same permissions, CSP, action, icons, version", () => {
    const { background: _b, browser_specific_settings: _s, ...rest } = ff;
    const { background: _cb, browser_specific_settings: _cs, ...chromeRest } = chrome;
    expect(rest).toEqual(chromeRest);
    expect([...ff.permissions].sort()).toEqual(["activeTab", "nativeMessaging", "scripting"]);
    expect(ff.host_permissions).toBeUndefined();
  });

  it("does not mutate the Chrome manifest, which keeps its service worker", () => {
    expect(chrome.background.scripts).toBeUndefined();
    expect(chrome.background.service_worker).toBeDefined();
  });

  it("uses the id the host manifest allows for Firefox", () => {
    expect(buildManifest("firefox", "/x", { firefox: FIREFOX_GECKO_ID })).toMatchObject({
      allowed_extensions: [FIREFOX_GECKO_ID],
    });
  });

  it("refuses a manifest with no service worker", () => {
    expect(() => buildFirefoxManifest({ background: {} })).toThrow();
    expect(() => buildFirefoxManifest({})).toThrow();
  });
});

describe("emit", () => {
  it("writes manifest, src and icons to the output directory", () => {
    const out = join(mkdtempSync(join(tmpdir(), "phoenix-ff-")), "firefox");
    emitFirefox({ root, outDir: out });
    expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).toEqual(
      buildFirefoxManifest(chrome),
    );
    expect(existsSync(join(out, "src", "background.js"))).toBe(true);
    expect(existsSync(join(out, "icons", "icon-16.png"))).toBe(true);
    expect(existsSync(join(out, "host"))).toBe(false);
  });
});
