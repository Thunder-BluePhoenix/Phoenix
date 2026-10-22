// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * What the browser window is created with. The defaults are the private ones; every field that
 * would keep data or talk to a third party is opt-in and `persistent` is not offered here at all
 * (stored profiles belong to Phase 96, behind its own review).
 */
export interface BrowserProfile {
  /** The window's profile name, shown in the UI. Never the user's main browser profile. */
  name: string;
  /** No cookies, storage, cache or history survive the window. */
  persistence: "none";
  thirdPartyCookies: false;
  httpsUpgrade: true;
  telemetry: false;
  /** Downloads always prompt and go to a folder the user picks; there is no silent default folder. */
  downloads: "ask";
  /** Sites where list-based blocking is off by default (see {@link DEFAULT_BLOCKING_EXEMPT_SITES}). */
  blockingExemptSites: readonly string[];
}

/**
 * YouTube's embedded player rules forbid blocking its ads; the blocker leaves these sites alone
 * and the UI says so. The user can change this per site.
 */
export const DEFAULT_BLOCKING_EXEMPT_SITES: readonly string[] = [
  "youtube.com",
  "youtube-nocookie.com",
  "ytimg.com",
  "googlevideo.com",
];

export const PRIVATE_PROFILE: BrowserProfile = {
  name: "Phoenix private",
  persistence: "none",
  thirdPartyCookies: false,
  httpsUpgrade: true,
  telemetry: false,
  downloads: "ask",
  blockingExemptSites: DEFAULT_BLOCKING_EXEMPT_SITES,
};

/**
 * The settings the Rust host must apply when it builds the webview, as data. Each maps to one
 * `WebviewBuilder`/`WebviewWindowBuilder` call named in docs/mini-browser.md; this object is the
 * contract the tests pin, not something that configures a webview by itself.
 */
export interface WebviewSettings {
  /** `.incognito(true)`: WKWebView non-persistent data store, WebView2 InPrivate. */
  incognito: boolean;
  /** No `.data_directory(..)` is set, so nothing is written under the app's data directory. */
  dataDirectory: null;
  /** `.on_permission_request(..)` answers every request from the policy; none uses `Default`. */
  permissionRequests: "policy";
  /** `.on_navigation(..)` and `.on_new_window(..)` consult the policy. */
  navigation: "policy";
  /** `.on_download(..)` returns false until the user has chosen a destination. */
  downloads: "ask";
  /** `.devtools(false)`: the page is untrusted, and developer tools would expose the IPC bridge. */
  devtools: false;
  /** No `withGlobalTauri`/IPC capability for remote pages: the browser webview has no capability file. */
  ipcForRemotePages: false;
}

export function webviewSettings(profile: BrowserProfile): WebviewSettings {
  return {
    incognito: profile.persistence === "none",
    dataDirectory: null,
    permissionRequests: "policy",
    navigation: "policy",
    downloads: profile.downloads,
    devtools: false,
    ipcForRemotePages: false,
  };
}
