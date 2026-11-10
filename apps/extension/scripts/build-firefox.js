// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Emits a Firefox build of the extension into `dist/firefox/`: the same `src/` and `icons/`, and a
// manifest derived from `manifest.json` that differs in exactly two ways. Chrome's own manifest is
// never touched.
//
//   node scripts/build-firefox.js [--out <dir>]
//
// 1. `background.service_worker` becomes `background.scripts`. Firefox does not support
//    `background.service_worker` (it runs background scripts as an event page), and an MV3
//    extension with only a service worker has no background context there:
//    https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
//    (section "Browser support": `service_worker` is not supported in Firefox, bug 1573659;
//    `type: "module"` is supported from Firefox 112 per the same page's compat data).
// 2. `browser_specific_settings.gecko` is added: an explicit `id` (mandatory for signing or
//    self-distributing an MV3 extension, and it is what the host manifest's `allowed_extensions`
//    must name) and `strict_min_version`:
//    https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
//    Native messaging itself needs only the `nativeMessaging` permission plus that id:
//    https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
//    115.0 (ESR) is chosen because it is at least every version the used pieces need (MV3 and the
//    `action` API from 109, `background.type: "module"` from 112, `scripting.executeScript` with
//    `func` from 102) and because the MDN page above names 115.0 as the oldest version that can
//    still receive updates and recognise current extension signatures.
//
// No permission changes, and no browser-namespace shim: Firefox implements the `chrome` namespace
// with callbacks as a porting aid, so the code that already uses `chrome.*` callbacks runs
// unchanged there (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API,
// "Browser namespace differences"). Firefox's `browser.*` is promise-based, so a
// `browser ?? chrome` shim would have changed the call shape on Firefox instead of preserving it.
//
// This build has NEVER been loaded in Firefox. `data_collection_permissions` (required by
// addons.mozilla.org for new submissions from 2025-11-03) is not declared: sideloading does not
// need it and what to declare is the owner's decision.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Must equal the `--firefox-id` given to install-host.js. */
export const FIREFOX_GECKO_ID = "phoenix-send-page@phoenix.invalid";
export const FIREFOX_MIN_VERSION = "115.0";

/** The Firefox manifest for a Chrome manifest. Throws if the input is not the shape we adapt. */
export function buildFirefoxManifest(chromeManifest) {
  const worker = chromeManifest?.background?.service_worker;
  if (typeof worker !== "string" || worker === "") {
    throw new Error("manifest.json has no background.service_worker to convert");
  }
  const manifest = structuredClone(chromeManifest);
  const { service_worker: _removed, ...background } = manifest.background;
  manifest.background = { ...background, scripts: [worker] };
  manifest.browser_specific_settings = {
    gecko: { id: FIREFOX_GECKO_ID, strict_min_version: FIREFOX_MIN_VERSION },
  };
  return manifest;
}

/** Writes dist/firefox (replacing it): src/, icons/ and the Firefox manifest. Returns the dir. */
export function emitFirefox({
  root,
  outDir,
  fs = { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync },
}) {
  const chrome = JSON.parse(fs.readFileSync(join(root, "manifest.json"), "utf8"));
  const manifest = buildFirefoxManifest(chrome);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(join(root, "src"), join(outDir, "src"), { recursive: true });
  fs.cpSync(join(root, "icons"), join(outDir, "icons"), { recursive: true });
  fs.writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return outDir;
}

function main(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" } } });
  const root = resolve(dirname(import.meta.dirname), ".");
  const outDir = resolve(values.out ?? join(root, "dist", "firefox"));
  try {
    console.log(`wrote ${emitFirefox({ root, outDir })}`);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
