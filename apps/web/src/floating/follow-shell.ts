// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the floating page may read of the desktop for "follow the mouse pointer" (Phase 59). Like
// DesktopShell, ShortcutsShell and FileDropShell this is the only place that knows the Tauri
// command names, so the driver takes a `FollowShell` and tests pass a fake. It only READS: the
// pointer position, the floating window's own place and whether the window is shown. Moving the
// window goes through the existing `move_window_by` command (DesktopShell.moveBy), which refuses
// every window but the floating one.
//
// The reads are Tauri core window commands (`plugin:window|cursor_position`, `outer_position`,
// `outer_size`, `scale_factor`, `is_visible`, `monitor_from_point`), all already part of
// `core:window:default` inside `core:default`, which capabilities/default.json grants to the
// floating and island windows. No capability file changed for this feature (see
// docs/phases/phase-59-fawkes-interactions-and-sounds.md).

/** A point or size in physical screen pixels. */
export interface PhysicalPoint {
  x: number;
  y: number;
}

/** The floating window's top-left corner and size in physical pixels, and its scale (physical per CSS pixel). */
export interface WindowPlace extends PhysicalPoint {
  width: number;
  height: number;
  scale: number;
}

/** The usable part of one monitor (without the menu bar or taskbar), in physical pixels. */
export interface Area extends PhysicalPoint {
  width: number;
  height: number;
}

export interface FollowShell {
  /** Where the mouse pointer is on the whole desktop; null when the system will not say. */
  cursor(): Promise<PhysicalPoint | null>;
  /** Where this window is; null when it cannot be read. */
  window(): Promise<WindowPlace | null>;
  /** Whether this window is shown (a hidden Fawkes must never be moved). */
  visible(): Promise<boolean>;
  /** The usable area of the monitor under `point`; null when there is none or it cannot be read. */
  area(point: PhysicalPoint): Promise<Area | null>;
}

type Invoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

function number(value: unknown, name: string): number | null {
  if (typeof value !== "object" || value === null || !(name in value)) return null;
  const n = (value as Record<string, unknown>)[name];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A `{ x, y }` answer from Tauri, or null for anything that is not two finite numbers. */
export function parsePoint(value: unknown): PhysicalPoint | null {
  const x = number(value, "x");
  const y = number(value, "y");
  return x === null || y === null ? null : { x, y };
}

/** A `{ width, height }` answer from Tauri: two finite numbers above zero, else null. */
export function parseSize(value: unknown): { width: number; height: number } | null {
  const width = number(value, "width");
  const height = number(value, "height");
  return width === null || height === null || width <= 0 || height <= 0 ? null : { width, height };
}

/** A monitor from `monitor_from_point` as its usable area, or null. */
export function parseArea(value: unknown): Area | null {
  if (typeof value !== "object" || value === null) return null;
  const work = (value as Record<string, unknown>).workArea;
  if (typeof work !== "object" || work === null) return null;
  const at = parsePoint((work as Record<string, unknown>).position);
  const size = parseSize((work as Record<string, unknown>).size);
  return at && size ? { ...at, ...size } : null;
}

/** A usable scale factor: finite and above zero, else null. */
export function parseScale(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The follow shell when running inside the Tauri webview; null in an ordinary browser. */
export function tauriFollowShell(win: Window = window): FollowShell | null {
  const invoke = (win as Window & { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core
    ?.invoke;
  if (!invoke) return null;
  return {
    cursor: async () => {
      try {
        return parsePoint(await invoke("plugin:window|cursor_position"));
      } catch {
        return null;
      }
    },
    window: async () => {
      try {
        const at = parsePoint(await invoke("plugin:window|outer_position"));
        const size = parseSize(await invoke("plugin:window|outer_size"));
        const scale = parseScale(await invoke("plugin:window|scale_factor"));
        return at && size && scale !== null ? { ...at, ...size, scale } : null;
      } catch {
        return null;
      }
    },
    visible: async () => {
      try {
        return (await invoke<unknown>("plugin:window|is_visible")) === true;
      } catch {
        // Unknown counts as hidden: a window that cannot be asked about is not moved.
        return false;
      }
    },
    area: async (point) => {
      try {
        return parseArea(
          await invoke("plugin:window|monitor_from_point", { x: point.x, y: point.y }),
        );
      } catch {
        return null;
      }
    },
  };
}
