// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the web pages may ask of the desktop shell's GLOBAL shortcuts and mute flag (Phase 70;
// apps/desktop shortcuts.rs and the `shortcuts_*` commands in lib.rs). Like DesktopShell and
// IslandShell this is the only place that knows the Tauri command and event names, so every
// consumer (Settings, the mute hook, the palette) takes a `ShortcutsShell` and tests pass a fake.
//
// The shell answers only the Fawkes and island windows; from any other page the commands refuse
// with code "forbidden" and the events never arrive.

/** Settings key and command argument of each action (shortcuts.rs `Action::as_str`). */
export const SHORTCUT_ACTIONS = [
  "open_chat",
  "jump_to_alert",
  "jump_to_terminal",
  "switch_pills",
  "mute",
  "send_to_desktop",
  "wardrobe",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** How one action stands (shortcuts.rs `State`). */
export const SHORTCUT_STATES = ["active", "off", "unbound", "rejected", "unavailable"] as const;
export type ShortcutState = (typeof SHORTCUT_STATES)[number];

export interface ShortcutStatus {
  action: ShortcutAction;
  /** Canonical text such as "Ctrl+Alt+Shift+C"; null when unbound or rejected. */
  accelerator: string | null;
  defaultAccelerator: string;
  state: ShortcutState;
}

/** What `shortcuts_list` returns and `shortcuts://status` carries. */
export interface ShortcutReport {
  enabled: boolean;
  muted: boolean;
  shortcuts: ShortcutStatus[];
}

/** A command the shell refused: `code` is machine-readable (needs_modifiers, conflict, ...). */
export class ShortcutRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ShortcutsShell {
  list(): Promise<ShortcutReport>;
  /** Binds `action` ("" unbinds). Rejects with ShortcutRefused when the shell refuses the text. */
  set(action: ShortcutAction, accelerator: string): Promise<ShortcutReport>;
  /** Restores the default of one action, or of all of them. */
  reset(action?: ShortcutAction): Promise<ShortcutReport>;
  setEnabled(enabled: boolean): Promise<ShortcutReport>;
  setMuted(muted: boolean): Promise<ShortcutReport>;
  /** Calls back whenever the mute flag changes (`shortcuts://mute`); returns the unsubscribe. */
  onMute(listener: (muted: boolean) => void): Promise<() => void>;
  /** Calls back after bindings are re-registered (`shortcuts://status`); returns the unsubscribe. */
  onStatus(listener: (report: ShortcutReport) => void): Promise<() => void>;
}

export const MUTE_EVENT = "shortcuts://mute";
export const STATUS_EVENT = "shortcuts://status";

const isAction = (v: unknown): v is ShortcutAction => SHORTCUT_ACTIONS.some((a) => a === v);
const isState = (v: unknown): v is ShortcutState => SHORTCUT_STATES.some((s) => s === v);

/** The value of a field of an untrusted object, `undefined` when it is not an object or lacks it. */
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

/** A report from the shell, checked: anything malformed is dropped rather than trusted. */
export function parseReport(value: unknown): ShortcutReport | null {
  const enabled = field(value, "enabled");
  const muted = field(value, "muted");
  if (typeof enabled !== "boolean" || typeof muted !== "boolean") return null;
  const list = field(value, "shortcuts");
  const shortcuts: ShortcutStatus[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const action = field(item, "action");
    const state = field(item, "state");
    if (!isAction(action) || !isState(state)) continue;
    const accelerator = field(item, "accelerator");
    const fallback = field(item, "default_accelerator");
    shortcuts.push({
      action,
      accelerator: typeof accelerator === "string" ? accelerator : null,
      defaultAccelerator: typeof fallback === "string" ? fallback : "",
      state,
    });
  }
  return { enabled, muted, shortcuts };
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

interface TauriGlobal {
  core: { invoke: Invoke };
  event?: { listen: Listen };
}

/** The refusal behind a rejected command: the shell serialises `{ code, message }`. */
function refusal(err: unknown): ShortcutRefused {
  const code = field(err, "code");
  if (typeof code === "string") {
    const message = field(err, "message");
    return new ShortcutRefused(code, typeof message === "string" ? message : code);
  }
  return new ShortcutRefused("unknown", err instanceof Error ? err.message : String(err));
}

/** The shell when running inside the Tauri webview (with events); null in an ordinary browser. */
export function tauriShortcuts(win: Window = window): ShortcutsShell | null {
  const tauri = (win as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core.invoke;
  const listen = tauri?.event?.listen;
  if (!invoke || !listen) return null;
  const report = async (command: string, args?: Record<string, unknown>) => {
    let raw: unknown;
    try {
      raw = await invoke<unknown>(command, args);
    } catch (err) {
      throw refusal(err);
    }
    const parsed = parseReport(raw);
    if (!parsed) throw new ShortcutRefused("unknown", "malformed report");
    return parsed;
  };
  return {
    list: () => report("shortcuts_list"),
    set: (action, accelerator) => report("shortcuts_set", { action, accelerator }),
    reset: (action) => report("shortcuts_reset", action ? { action } : {}),
    setEnabled: (enabled) => report("shortcuts_set_enabled", { enabled }),
    setMuted: (muted) => report("shortcuts_set_muted", { muted }),
    onMute: (listener) =>
      listen<unknown>(MUTE_EVENT, (e) => {
        const muted = field(e.payload, "muted");
        if (typeof muted === "boolean") listener(muted);
      }),
    onStatus: (listener) =>
      listen<unknown>(STATUS_EVENT, (e) => {
        const next = parseReport(e.payload);
        if (next) listener(next);
      }),
  };
}
