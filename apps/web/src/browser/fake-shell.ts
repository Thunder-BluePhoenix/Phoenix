// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A fake BrowserShell for tests: it keeps tabs in memory, records every call and applies the same
// navigation policy the real shell must (decideNavigation). No webview, window or network exists.
import { DEFAULT_NAVIGATION_POLICY, decideNavigation } from "../core/browser/navigation";
import {
  PurgeError,
  ZOOM_MAX,
  ZOOM_MIN,
  type BrowserIntent,
  type BrowserShell,
  type OpenRequest,
  type OpenResult,
  type PageActionRequest,
  type PageActionResult,
  type PageSnapshotResult,
  type PurgeResult,
  type TabInfo,
} from "./shell";

export interface FakeBrowserShell extends BrowserShell {
  tabs: TabInfo[];
  /** Every call as `[command, ...args]`, in order. */
  calls: unknown[][];
  chromeHeights: number[];
  siteShields: { site: string; blocking: boolean }[];
  /** Pushes a tab update as the real shell does when a page changes. */
  emitTab(tab: Partial<TabInfo> & { tabId: string }): void;
  emitClosed(tabId: string): void;
  emitOpenRequest(url: string): void;
  /** Makes the next call to `command` reject, like an internal shell error. */
  failNext(command: string): void;
  /** What `purge_profile_data` does for a profile: a result, or `{ error: code }` for a rejection. */
  purgeOutcome: (profileId: string) => PurgeResult | { error: string };
  /** While set, purges wait for it (to test that two purge loops never overlap). */
  purgeGate: Promise<void> | null;
  /** The most purge calls that were ever in flight at once. */
  maxConcurrentPurges: number;
  /** What `page_snapshot` answers (set it per test). */
  snapshotOutcome: () => PageSnapshotResult | Promise<PageSnapshotResult>;
  /** What `page_action` answers (set it per test). */
  actionOutcome: (req: PageActionRequest) => PageActionResult | Promise<PageActionResult>;
}

export function createFakeBrowserShell(): FakeBrowserShell {
  const tabListeners = new Set<(tab: TabInfo) => void>();
  const closedListeners = new Set<(tabId: string) => void>();
  const openListeners = new Set<(request: OpenRequest) => void>();
  const failing = new Set<string>();
  let counter = 0;
  let inFlight = 0;

  const guard = (command: string) => {
    if (failing.delete(command)) throw new Error(`${command} failed`);
  };
  const find = (tabId: string) => {
    const tab = shell.tabs.find((t) => t.tabId === tabId);
    if (!tab) throw new Error(`unknown tab ${tabId}`);
    return tab;
  };
  const load = (tab: TabInfo, url: string) => {
    tab.url = url;
    tab.title = `Page at ${new URL(url).host}`;
    tab.blocked = 0;
    tab.canGoBack = true;
  };
  const decide = (url: string, intent: BrowserIntent) => {
    if (intent === "port_radar") {
      return decideNavigation(
        url,
        {
          ...DEFAULT_NAVIGATION_POLICY,
          privateNetworkAllowedSites: ["127.0.0.1"],
          insecureAllowedSites: ["127.0.0.1"],
        },
        "typed",
      );
    }
    return decideNavigation(url, DEFAULT_NAVIGATION_POLICY, "typed");
  };

  const shell: FakeBrowserShell = {
    tabs: [],
    calls: [],
    chromeHeights: [],
    siteShields: [],
    async openTab(url, intent, profileId): Promise<OpenResult> {
      shell.calls.push(
        profileId === undefined ? ["open_tab", url, intent] : ["open_tab", url, intent, profileId],
      );
      guard("open_tab");
      const decision = decide(url, intent);
      if (!decision.allow) return { ok: false, reason: decision.reason };
      const tab: TabInfo = {
        tabId: `tab-${++counter}`,
        url: "",
        title: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        zoom: 1,
        blocked: 0,
        profileId: profileId ?? null,
      };
      load(tab, decision.url);
      tab.canGoBack = false;
      shell.tabs.push(tab);
      return { ok: true, tab: { ...tab } };
    },
    async closeTab(tabId) {
      shell.calls.push(["close_tab", tabId]);
      guard("close_tab");
      shell.tabs = shell.tabs.filter((t) => t.tabId !== tabId);
    },
    async activateTab(tabId) {
      shell.calls.push(["activate_tab", tabId]);
      guard("activate_tab");
    },
    async navigate(tabId, url): Promise<OpenResult> {
      shell.calls.push(["navigate", tabId, url]);
      guard("navigate");
      const tab = find(tabId);
      const decision = decide(url, "typed");
      if (!decision.allow) return { ok: false, reason: decision.reason };
      load(tab, decision.url);
      return { ok: true, tab: { ...tab } };
    },
    async back(tabId) {
      shell.calls.push(["back", tabId]);
      guard("back");
      const tab = find(tabId);
      tab.canGoBack = false;
      tab.canGoForward = true;
      return { ...tab };
    },
    async forward(tabId) {
      shell.calls.push(["forward", tabId]);
      guard("forward");
      const tab = find(tabId);
      tab.canGoForward = false;
      tab.canGoBack = true;
      return { ...tab };
    },
    async reload(tabId) {
      shell.calls.push(["reload", tabId]);
      guard("reload");
      return { ...find(tabId) };
    },
    async zoom(tabId, factor) {
      shell.calls.push(["zoom", tabId, factor]);
      guard("zoom");
      const tab = find(tabId);
      tab.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
      return tab.zoom;
    },
    async setSiteShields(site, blocking) {
      shell.calls.push(["set_site_shields", site, blocking]);
      guard("set_site_shields");
      shell.siteShields.push({ site, blocking });
    },
    async setChromeHeight(height) {
      shell.calls.push(["set_chrome_height", height]);
      shell.chromeHeights.push(height);
    },
    async pageSnapshot() {
      shell.calls.push(["page_snapshot"]);
      guard("page_snapshot");
      return shell.snapshotOutcome();
    },
    async pageAction(req) {
      shell.calls.push(["page_action", req]);
      guard("page_action");
      return shell.actionOutcome(req);
    },
    async purgeProfileData(profileId) {
      shell.calls.push(["purge_profile_data", profileId]);
      guard("purge_profile_data");
      inFlight += 1;
      shell.maxConcurrentPurges = Math.max(shell.maxConcurrentPurges, inFlight);
      try {
        if (shell.purgeGate) await shell.purgeGate;
        const outcome = shell.purgeOutcome(profileId);
        if ("error" in outcome) throw new PurgeError(outcome.error);
        for (const tab of shell.tabs.filter((t) => t.profileId === profileId))
          shell.emitClosed(tab.tabId);
        return outcome;
      } finally {
        inFlight -= 1;
      }
    },
    async onTab(listener) {
      tabListeners.add(listener);
      return () => void tabListeners.delete(listener);
    },
    async onTabClosed(listener) {
      closedListeners.add(listener);
      return () => void closedListeners.delete(listener);
    },
    async onOpenRequest(listener) {
      openListeners.add(listener);
      return () => void openListeners.delete(listener);
    },
    emitTab(patch) {
      const tab = find(patch.tabId);
      Object.assign(tab, patch);
      tabListeners.forEach((l) => l({ ...tab }));
    },
    emitClosed(tabId) {
      shell.tabs = shell.tabs.filter((t) => t.tabId !== tabId);
      closedListeners.forEach((l) => l(tabId));
    },
    emitOpenRequest(url) {
      openListeners.forEach((l) => l({ url, source: "port_radar" }));
    },
    failNext(command) {
      failing.add(command);
    },
    purgeOutcome: () => ({ closedTabs: 0, dataRemoved: true }),
    purgeGate: null,
    maxConcurrentPurges: 0,
    snapshotOutcome: () => ({
      ok: true,
      tabId: "t1",
      url: "https://example.com/",
      title: "Example",
      html: "<html></html>",
      truncated: false,
    }),
    actionOutcome: () => ({ ok: true, url: "https://example.com/" }),
  };
  return shell;
}
