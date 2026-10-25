// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: the ONE bridge between the browser chrome page (tabs, address bar, buttons) and the
// Rust shell that owns the real content webviews. The chrome never renders page content: it only
// shows the text fields of TabInfo. Everything here is typed; the Rust side re-validates every URL
// (this page's checks are for feedback, not enforcement).

/** Logical pixels the chrome page occupies above the content webview. */
export const BROWSER_CHROME_HEIGHT = 80;
/** The height while the open-from-port-radar confirmation panel is shown. */
export const BROWSER_CHROME_PANEL_HEIGHT = 220;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;

export type BrowserIntent = "typed" | "port_radar";

/** One tab as the shell reports it. All text is untrusted page data: render it as text only. */
export interface TabInfo {
  tabId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 1 is 100%. */
  zoom: number;
  /** Requests blocked on the current page. */
  blocked: number;
}

/** A refusal is a resolved value (never a rejected promise); `reason` is a navigation.ts denial id, or `dns_private`. */
export type OpenResult = { ok: true; tab: TabInfo } | { ok: false; reason: string };

export interface OpenRequest {
  url: string;
  source: "port_radar";
}

export interface BrowserShell {
  openTab(url: string, intent: BrowserIntent): Promise<OpenResult>;
  closeTab(tabId: string): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  navigate(tabId: string, url: string): Promise<OpenResult>;
  back(tabId: string): Promise<TabInfo>;
  forward(tabId: string): Promise<TabInfo>;
  reload(tabId: string): Promise<TabInfo>;
  /** Returns the factor the shell applied (it clamps to ZOOM_MIN..ZOOM_MAX). */
  zoom(tabId: string, factor: number): Promise<number>;
  /** Tells the shell to apply blocking on/off for a site (registrable domain) now. */
  setSiteShields(site: string, blocking: boolean): Promise<void>;
  /** How far down the content webview starts. */
  setChromeHeight(height: number): Promise<void>;
  onTab(listener: (tab: TabInfo) => void): Promise<() => void>;
  onTabClosed(listener: (tabId: string) => void): Promise<() => void>;
  onOpenRequest(listener: (request: OpenRequest) => void): Promise<() => void>;
}

type Invoke = <T = void>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

/** The slice of `window.__TAURI__` (withGlobalTauri) the chrome uses. */
interface TauriGlobal {
  core: { invoke: Invoke };
  event?: { listen: Listen };
}

export const TAB_EVENT = "browser://tab";
export const TAB_CLOSED_EVENT = "browser://tab-closed";
export const OPEN_REQUEST_EVENT = "browser://open-request";

/** One property of an untrusted value, `undefined` when it is not an object. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

/** Accepts only a well-formed TabInfo; anything else from the event stream is dropped. */
export function parseTab(value: unknown): TabInfo | null {
  if (value === null || typeof value !== "object") return null;
  const tabId = field(value, "tabId");
  const url = field(value, "url");
  const title = field(value, "title");
  const loading = field(value, "loading");
  const canGoBack = field(value, "canGoBack");
  const canGoForward = field(value, "canGoForward");
  const zoom = field(value, "zoom");
  const blocked = field(value, "blocked");
  if (typeof tabId !== "string" || tabId === "" || tabId.length > 64) return null;
  if (typeof url !== "string" || typeof title !== "string") return null;
  if (typeof loading !== "boolean" || typeof canGoBack !== "boolean") return null;
  if (typeof canGoForward !== "boolean") return null;
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return null;
  if (typeof blocked !== "number" || !Number.isSafeInteger(blocked) || blocked < 0) return null;
  return {
    tabId,
    url: url.slice(0, 2048),
    title: title.slice(0, 300),
    loading,
    canGoBack,
    canGoForward,
    zoom,
    blocked,
  };
}

export function parseOpenResult(value: unknown): OpenResult {
  const ok = field(value, "ok");
  if (ok === true) {
    const tab = parseTab(field(value, "tab"));
    if (tab) return { ok: true, tab };
  }
  const reason = field(value, "reason");
  if (ok === false && typeof reason === "string") return { ok: false, reason: reason.slice(0, 64) };
  return { ok: false, reason: "unparseable" };
}

function requireTab(value: unknown): TabInfo {
  const tab = parseTab(value);
  if (!tab) throw new Error("The shell returned an invalid tab.");
  return tab;
}

function parseOpenRequest(value: unknown): OpenRequest | null {
  const url = field(value, "url");
  if (field(value, "source") !== "port_radar" || typeof url !== "string") return null;
  return { url: url.slice(0, 2048), source: "port_radar" };
}

/** The shell inside the Tauri webview; null in an ordinary browser. */
export function tauriBrowserShell(win: Window = window): BrowserShell | null {
  const tauri = (win as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core.invoke;
  const listen = tauri?.event?.listen;
  if (!invoke || !listen) return null;
  return {
    openTab: async (url, intent) => parseOpenResult(await invoke("open_tab", { url, intent })),
    closeTab: (tabId) => invoke("close_tab", { tabId }),
    activateTab: (tabId) => invoke("activate_tab", { tabId }),
    navigate: async (tabId, url) =>
      parseOpenResult(await invoke("navigate", { tabId, url, intent: "typed" })),
    back: async (tabId) => requireTab(await invoke("back", { tabId })),
    forward: async (tabId) => requireTab(await invoke("forward", { tabId })),
    reload: async (tabId) => requireTab(await invoke("reload", { tabId })),
    zoom: async (tabId, factor) => {
      const applied = await invoke<number>("zoom", { tabId, factor });
      return typeof applied === "number" && Number.isFinite(applied) ? applied : factor;
    },
    setSiteShields: (site, blocking) => invoke("set_site_shields", { site, blocking }),
    setChromeHeight: (height) => invoke("set_chrome_height", { height }),
    onTab: (listener) =>
      listen<unknown>(TAB_EVENT, (e) => {
        const tab = parseTab(e.payload);
        if (tab) listener(tab);
      }),
    onTabClosed: (listener) =>
      listen<unknown>(TAB_CLOSED_EVENT, (e) => {
        const tabId = field(e.payload, "tabId");
        if (typeof tabId === "string") listener(tabId);
      }),
    onOpenRequest: (listener) =>
      listen<unknown>(OPEN_REQUEST_EVENT, (e) => {
        const request = parseOpenRequest(e.payload);
        if (request) listener(request);
      }),
  };
}
