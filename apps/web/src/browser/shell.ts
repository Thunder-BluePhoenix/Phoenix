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
  /** The saved profile this tab belongs to; null for a private (incognito) tab. */
  profileId: string | null;
}

/** What `purge_profile_data` reports once a removed profile's web data has been handled. */
export interface PurgeResult {
  closedTabs: number;
  dataRemoved: boolean;
}

/** A refused or failed purge. `code` is the shell's closed code (forbidden, bad_profile, busy, purge_failed). */
export class PurgeError extends Error {
  constructor(readonly code: string) {
    super(`Profile data purge failed: ${code}`);
    this.name = "PurgeError";
  }
}

/** A refusal is a resolved value (never a rejected promise); `reason` is a navigation.ts denial id, or `dns_private`. */
export type OpenResult = { ok: true; tab: TabInfo } | { ok: false; reason: string };

export interface OpenRequest {
  url: string;
  source: "port_radar";
}

/** The actions the assistant may ask for on the ACTIVE tab (Phase 95). */
export type PageActionKind = "click" | "type" | "submit" | "download" | "navigate";
export const PAGE_ACTION_KINDS: readonly PageActionKind[] = [
  "click",
  "type",
  "submit",
  "download",
  "navigate",
];

/** What `page_snapshot` returns for the active tab. `html` is untrusted page data: never render it. */
export type PageSnapshotResult =
  | { ok: true; tabId: string; url: string; title: string; html: string; truncated: boolean }
  | { ok: false; reason: string };

/** One action on the active tab; `text` is what the user approved to be typed (never log it). */
export interface PageActionRequest {
  kind: PageActionKind;
  selector?: string;
  text?: string;
  destination?: string;
  /** The page the action was approved for; the shell refuses when the tab has moved on. */
  expectedUrl: string;
}

export type PageActionResult = { ok: true; url: string } | { ok: false; reason: string };

export interface BrowserShell {
  /** `profileId` omitted = a private tab; the shell re-validates it (the picker is not a boundary). */
  openTab(url: string, intent: BrowserIntent, profileId?: string): Promise<OpenResult>;
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
  /** Chrome window only: the active tab's page, read by a fixed script. A refusal is a resolved value. */
  pageSnapshot(): Promise<PageSnapshotResult>;
  /** Chrome window only: one approved action on the active tab. A refusal is a resolved value. */
  pageAction(req: PageActionRequest): Promise<PageActionResult>;
  /** Chrome window only: deletes a removed profile's saved web data and closes its tabs. */
  purgeProfileData(profileId: string): Promise<PurgeResult>;
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
  const profileId = field(value, "profileId") ?? null;
  if (typeof tabId !== "string" || tabId === "" || tabId.length > 64) return null;
  if (typeof url !== "string" || typeof title !== "string") return null;
  if (typeof loading !== "boolean" || typeof canGoBack !== "boolean") return null;
  if (typeof canGoForward !== "boolean") return null;
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return null;
  if (typeof blocked !== "number" || !Number.isSafeInteger(blocked) || blocked < 0) return null;
  if (profileId !== null && (typeof profileId !== "string" || profileId.length > 80)) return null;
  return {
    tabId,
    url: url.slice(0, 2048),
    title: title.slice(0, 300),
    loading,
    canGoBack,
    canGoForward,
    zoom,
    blocked,
    profileId,
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

const FAILED = { ok: false, reason: "failed" } as const;

/** A reason string is a short closed id (`no_active_tab`, a navigation denial id...); anything else is `failed`. */
function parseReason(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : "failed";
}

/** Accepts only a well-formed `page_snapshot` answer; every other shape is `{ok:false, reason:'failed'}`. */
export function parsePageSnapshotResult(value: unknown): PageSnapshotResult {
  const ok = field(value, "ok");
  if (ok === true) {
    const tabId = field(value, "tabId");
    const url = field(value, "url");
    const title = field(value, "title");
    const html = field(value, "html");
    const truncated = field(value, "truncated");
    if (
      typeof tabId === "string" &&
      tabId !== "" &&
      tabId.length <= 64 &&
      typeof url === "string" &&
      typeof title === "string" &&
      typeof html === "string" &&
      typeof truncated === "boolean"
    )
      return { ok: true, tabId, url: url.slice(0, 2048), title: title.slice(0, 300), html, truncated };
    return { ...FAILED };
  }
  if (ok === false) return { ok: false, reason: parseReason(field(value, "reason")) };
  return { ...FAILED };
}

/** Accepts only a well-formed `page_action` answer; every other shape is `{ok:false, reason:'failed'}`. */
export function parsePageActionResult(value: unknown): PageActionResult {
  const ok = field(value, "ok");
  if (ok === true) {
    const url = field(value, "url");
    return typeof url === "string" ? { ok: true, url: url.slice(0, 2048) } : { ...FAILED };
  }
  if (ok === false) return { ok: false, reason: parseReason(field(value, "reason")) };
  return { ...FAILED };
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
    openTab: async (url, intent, profileId) =>
      parseOpenResult(
        await invoke("open_tab", { url, intent, ...(profileId ? { profileId } : {}) }),
      ),
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
    purgeProfileData: async (profileId) => {
      try {
        const result = await invoke<unknown>("purge_profile_data", { profileId });
        const closedTabs = field(result, "closedTabs");
        const dataRemoved = field(result, "dataRemoved");
        if (
          typeof closedTabs !== "number" ||
          !Number.isSafeInteger(closedTabs) ||
          closedTabs < 0 ||
          typeof dataRemoved !== "boolean"
        )
          throw new PurgeError("purge_failed");
        return { closedTabs, dataRemoved };
      } catch (error) {
        if (error instanceof PurgeError) throw error;
        const code = field(error, "code");
        throw new PurgeError(typeof code === "string" ? code.slice(0, 32) : "purge_failed");
      }
    },
    pageSnapshot: async () => {
      try {
        return parsePageSnapshotResult(await invoke<unknown>("page_snapshot", {}));
      } catch {
        return { ...FAILED };
      }
    },
    pageAction: async (req) => {
      try {
        return parsePageActionResult(
          await invoke<unknown>("page_action", {
            kind: req.kind,
            ...(req.selector !== undefined ? { selector: req.selector } : {}),
            ...(req.text !== undefined ? { text: req.text } : {}),
            ...(req.destination !== undefined ? { destination: req.destination } : {}),
            expectedUrl: req.expectedUrl,
          }),
        );
      } catch {
        return { ...FAILED };
      }
    },
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
