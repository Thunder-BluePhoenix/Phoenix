// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * What the floating page needs from the desktop shell (apps/desktop). Everything
 * OS-specific lives behind this interface so the page itself is plain web code
 * (ADR-0013: isolate OS-specific shell code from the runtime).
 */
export interface DesktopShell {
  /** Where Core is and the current session token (null while Core is not running). */
  connection(): Promise<{ base_url: string; token: string | null }>;
  /** Moves the window by a screen-space delta in CSS pixels. */
  moveBy(dx: number, dy: number): void;
  /** The user let go of the window; remember where it is. */
  dragEnded(): void;
  /** Opens an in-app route (e.g. "/meetings") in the Phoenix web app. */
  openInPhoenix(route: string): void;
  /** Shows the native menu (show/hide, always on top, start on login, quit). */
  showMenu(): void;
}

type Invoke = <T = void>(command: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: Invoke } };
  }
}

/** The shell when running inside the Tauri webview; null in an ordinary browser. */
export function tauriShell(win: Window = window): DesktopShell | null {
  const invoke = win.__TAURI__?.core.invoke;
  if (!invoke) return null;
  // Fire-and-forget commands: a failed move must never break the pet.
  const send = (command: string, args?: Record<string, unknown>) =>
    void invoke(command, args).catch(() => {});
  return {
    connection: () => invoke("core_connection"),
    moveBy: (dx, dy) => send("move_window_by", { dx, dy }),
    dragEnded: () => send("drag_finished"),
    openInPhoenix: (route) => send("open_in_phoenix", { route }),
    showMenu: () => send("show_menu"),
  };
}
