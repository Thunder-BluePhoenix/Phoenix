// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Island states (apps/desktop island_state.rs). */
export type IslandState = "hidden" | "small" | "expanded";

/** Who reports the pointer: the shell polls it, or (Wayland) only this page can see it. */
export type PointerSource = "poll" | "page";

/** What the shell tells the page after every move or resize (apps/desktop island_controller.rs). */
export interface IslandFrame {
  state: IslandState;
  pointer: PointerSource;
  layout: {
    rect: { x: number; y: number; w: number; h: number };
    /** Width of the notch in this window's logical pixels; 0 without a notch. */
    notch_width: number;
    has_notch: boolean;
  };
}

/** The only things the page may tell the shell (island_controller.rs PageEvent). */
export type PageEvent =
  | { kind: "pointer_enter" }
  | { kind: "pointer_leave" }
  | { kind: "toggle" }
  | { kind: "collapse" }
  | { kind: "activity"; active: boolean; urgent: boolean };

/**
 * What the island page needs from the desktop shell. Everything OS-specific lives behind this
 * interface so the page is plain web code (ADR-0013), like the floating page's DesktopShell.
 */
export interface IslandShell {
  /** Where Core is and the current session token (null while Core is not running). */
  connection(): Promise<{ base_url: string; token: string | null }>;
  /** The shell's current frame, for a page that loaded after the last one was emitted. */
  frame(): Promise<IslandFrame | null>;
  /** Calls back for every frame the shell emits; returns the unsubscribe function. */
  onFrame(listener: (frame: IslandFrame) => void): Promise<() => void>;
  send(event: PageEvent): void;
  /** Opens an in-app route (e.g. "/meetings") in the Phoenix web app. */
  openInPhoenix(route: string): void;
  /** Shows the native menu (mode, display, quit). */
  showMenu(): void;
}

type Invoke = <T = void>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

/** The slice of `window.__TAURI__` (withGlobalTauri) the island uses. */
interface TauriGlobal {
  core: { invoke: Invoke };
  event?: { listen: Listen };
}

export const FRAME_EVENT = "island://frame";

/** The shell when running inside the Tauri webview; null in an ordinary browser. */
export function tauriIslandShell(win: Window = window): IslandShell | null {
  // Not declared on `Window` here: the floating page already declares a narrower shape.
  const tauri = (win as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core.invoke;
  const listen = tauri?.event?.listen;
  if (!invoke || !listen) return null;
  // Fire-and-forget commands: a failed report must never break the pet.
  const send = (command: string, args?: Record<string, unknown>) =>
    void invoke(command, args).catch(() => {});
  return {
    connection: () => invoke("core_connection"),
    frame: () => invoke<IslandFrame | null>("island_frame").catch(() => null),
    onFrame: (listener) => listen<IslandFrame>(FRAME_EVENT, (e) => listener(e.payload)),
    send: (event) => send("island_event", { event }),
    openInPhoenix: (route) => send("open_in_phoenix", { route }),
    showMenu: () => send("show_menu"),
  };
}
