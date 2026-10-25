// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: the chrome's state as one pure reducer, so the tab strip, the address bar, the zoom
// buttons and the port-radar confirmation can be tested without a window. The shell is the source
// of truth for tabs (it reports every change); this state only mirrors it plus what the person is
// typing.
import { ZOOM_MAX, ZOOM_MIN, type TabInfo } from "./shell";

/** A refusal shown as text under the address bar. `text` is what was typed or requested. */
export interface AddressError {
  reason: string;
  text: string;
}

/** A loopback page waiting for the person's yes. */
export interface PendingOpen {
  url: string;
  port: number;
}

export interface ChromeState {
  tabs: readonly TabInfo[];
  activeId: string | null;
  /** What the person is typing; shown only while `editing`. */
  draft: string;
  editing: boolean;
  /** The next address opens a new tab instead of replacing the active one. */
  newTab: boolean;
  error: AddressError | null;
  pending: PendingOpen | null;
}

export const INITIAL_STATE: ChromeState = {
  tabs: [],
  activeId: null,
  draft: "",
  editing: false,
  newTab: false,
  error: null,
  pending: null,
};

export type ChromeAction =
  | { type: "tab"; tab: TabInfo; activate?: boolean }
  | { type: "tabClosed"; tabId: string }
  | { type: "activate"; tabId: string }
  | { type: "edit"; text: string }
  | { type: "newTab" }
  | { type: "refused"; error: AddressError }
  | { type: "dismissError" }
  | { type: "requestOpen"; pending: PendingOpen }
  | { type: "endOpen" };

/** Open tabs at once. The shell enforces its own limit; this only keeps the strip sane. */
export const MAX_TABS = 20;

export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(factor * 100) / 100));
}

export function reduce(state: ChromeState, action: ChromeAction): ChromeState {
  switch (action.type) {
    case "tab": {
      const known = state.tabs.some((t) => t.tabId === action.tab.tabId);
      if (!known && state.tabs.length >= MAX_TABS) return state;
      const tabs = known
        ? state.tabs.map((t) => (t.tabId === action.tab.tabId ? action.tab : t))
        : [...state.tabs, action.tab];
      const reset = action.activate === true;
      return {
        ...state,
        tabs,
        activeId: reset || state.activeId === null ? action.tab.tabId : state.activeId,
        // A page the person just opened replaces what was typed; a background update does not.
        editing: reset ? false : state.editing,
        newTab: reset ? false : state.newTab,
        error: reset ? null : state.error,
      };
    }
    case "tabClosed": {
      const index = state.tabs.findIndex((t) => t.tabId === action.tabId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((t) => t.tabId !== action.tabId);
      const activeId =
        state.activeId === action.tabId
          ? (tabs[Math.min(index, tabs.length - 1)]?.tabId ?? null)
          : state.activeId;
      const changed = activeId !== state.activeId;
      return {
        ...state,
        tabs,
        activeId,
        editing: changed ? false : state.editing,
        newTab: tabs.length === 0 ? false : state.newTab,
        error: changed ? null : state.error,
      };
    }
    case "activate":
      if (!state.tabs.some((t) => t.tabId === action.tabId)) return state;
      return { ...state, activeId: action.tabId, editing: false, newTab: false, error: null };
    case "edit":
      return { ...state, draft: action.text, editing: true, error: null };
    case "newTab":
      return { ...state, draft: "", editing: true, newTab: true, error: null };
    case "refused":
      return { ...state, error: action.error };
    case "dismissError":
      return { ...state, error: null };
    case "requestOpen":
      return { ...state, pending: action.pending, error: null };
    case "endOpen":
      return { ...state, pending: null };
  }
}

export function activeTab(state: ChromeState): TabInfo | null {
  return state.tabs.find((t) => t.tabId === state.activeId) ?? null;
}

/** What the address field shows: the typed text while editing, else the active page's address. */
export function addressText(state: ChromeState): string {
  if (state.editing) return state.draft;
  return activeTab(state)?.url ?? "";
}
