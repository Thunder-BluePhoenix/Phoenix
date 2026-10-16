// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** What the shell sends on the `pill://dictation` event. */
export interface PillCommand {
  /** start: begin a session now; stop: finish and paste; cancel (Esc): abandon without pasting. */
  action: "start" | "stop" | "cancel";
  mode?: "hold" | "hands_free";
}

/** The typed error `dictation_paste` rejects with (a plain object, not an Error). */
export interface PillPasteError {
  code: string;
  message: string;
}

export interface PillPasteResult {
  pasted: "clipboard" | "typed";
}

/**
 * What the pill page needs from the desktop shell. The page does the capture and talks to Core;
 * the shell only owns the window, the hotkey and the paste into the focused app.
 */
export interface PillShell {
  /** Pastes the dictated text into the focused app. Rejects with a {@link PillPasteError}. */
  paste(text: string): Promise<PillPasteResult>;
  /**
   * Tells the shell this attempt is over WITHOUT a paste (cancelled, nothing recognised, error).
   * Never called after `paste`: the shell already knows then.
   */
  ended(): void;
  /** Opens an in-app route (e.g. "/notetaker") in the Phoenix web app. Fire-and-forget. */
  openInPhoenix(route: string): void;
  /** Calls back for every hotkey command; returns the unsubscribe function. */
  onDictation(listener: (command: PillCommand) => void): Promise<() => void>;
  /** Shell hotkey permission/Core gate refusal, as a short human-readable message. */
  onError(listener: (message: string) => void): Promise<() => void>;
  /**
   * Tells the shell the page is up and its `onDictation` listener is registered, so commands sent
   * from now on are not lost. Called once, after the listener exists.
   */
  ready(): void;
}

/** How the two route buttons open Phoenix when there is no shell (an ordinary browser tab). */
export type RouteOpener = (route: string) => void;

type Invoke = <T = void>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

/** The slice of `window.__TAURI__` (withGlobalTauri) the pill uses. */
interface TauriGlobal {
  core: { invoke: Invoke };
  event?: { listen: Listen };
}

export const DICTATION_EVENT = "pill://dictation";
export const ERROR_EVENT = "pill://error";

const ACTIONS: Record<PillCommand["action"], true> = { start: true, stop: true, cancel: true };

function isCommand(value: unknown): value is PillCommand {
  if (typeof value !== "object" || value === null || !("action" in value)) return false;
  return typeof value.action === "string" && Object.hasOwn(ACTIONS, value.action);
}

/** The shell when running inside the Tauri webview; null in an ordinary browser. */
export function tauriPillShell(win: Window = window): PillShell | null {
  // `__TAURI__` is not declared on `Window` here: other pages declare narrower shapes.
  const tauriWindow = win as Window & { __TAURI__?: TauriGlobal };
  const tauri = tauriWindow.__TAURI__;
  const invoke = tauri?.core.invoke;
  const listen = tauri?.event?.listen;
  if (!invoke || !listen) return null;
  return {
    paste: (text) => invoke<PillPasteResult>("dictation_paste", { text }),
    // Fire-and-forget: a failed report must never break the pill.
    ended: () => void invoke("dictation_ended").catch(() => {}),
    openInPhoenix: (route) => void invoke("open_in_phoenix", { route }).catch(() => {}),
    ready: () => void invoke("pill_ready").catch(() => {}),
    onDictation: (listener) =>
      listen<unknown>(DICTATION_EVENT, (e) => {
        if (isCommand(e.payload)) listener(e.payload);
      }),
    onError: (listener) =>
      listen<unknown>(ERROR_EVENT, (e) => {
        if (typeof e.payload === "string" && e.payload.length > 0 && e.payload.length <= 200)
          listener(e.payload);
      }),
  };
}

/** Opens `route` of the Phoenix web app (served by Core, hash routed) in a new browser tab. */
export function browserOpener(win: Window = window): RouteOpener {
  return (route) => {
    try {
      win.open(`${win.location.origin}/#${route}`, "_blank", "noopener");
    } catch {
      // A blocked pop-up is not worth an error in a window this small.
    }
  };
}
