// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 59, desktop: lets the floating Fawkes follow the mouse pointer and fly home on an alert.
// Everything is opt-in (Settings > Fawkes, `follow_cursor`, off by default), runs only in the
// desktop app (no `FollowShell` in a browser), and stops while Fawkes is hidden, in quiet mode or
// quiet hours, under the emergency stop or in the demo. Reduced motion makes every move instant.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { SoundHost } from "../core/sounds";
import { FollowDriver, type FollowTimers } from "./follow-driver";
import type { FollowShell } from "./follow-shell";

/** How often the quiet answers are looked at while following (Core's answers are cached 5 s). */
export const QUIET_CHECK_MS = 5_000;

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeSystemMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

const systemPrefersReduced = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(QUERY).matches;

/** The setting (`auto` follows the system) as a yes/no, kept current. */
export function useReducedMotion(setting: "auto" | "on" | "off"): boolean {
  const system = useSyncExternalStore(subscribeSystemMotion, systemPrefersReduced, () => false);
  return setting === "on" || (setting === "auto" && system);
}

export interface FollowCursorOptions {
  /** The desktop reads; null in a browser (nothing happens). */
  follow: FollowShell | null;
  /** The existing window-move command; null in a browser. */
  moveBy: ((dx: number, dy: number) => void) | null;
  /** The saved opt-in. */
  enabled: boolean;
  reducedMotion: boolean;
  /** An urgent state (error, needs you, recording) is showing. */
  alert: boolean;
  /** The emergency stop is engaged. */
  killSwitch: boolean;
  /** Answers whether quiet mode, quiet hours, the emergency stop or the demo is on. */
  host: Pick<SoundHost, "quietNow">;
  timers?: FollowTimers;
}

/** Drag callbacks for the avatar: Fawkes held by the person is never moved by the driver. */
export function useFollowCursor(options: FollowCursorOptions): {
  dragStarted(): void;
  dragEnded(): void;
} {
  const { follow, moveBy, enabled, reducedMotion, alert, killSwitch, host, timers } = options;
  const moveRef = useRef(moveBy);
  moveRef.current = moveBy;
  const driver = useMemo(
    () =>
      follow && moveBy
        ? new FollowDriver({
            shell: follow,
            moveBy: (dx, dy) => moveRef.current?.(dx, dy),
            ...(timers ? { timers } : {}),
          })
        : null,
    // One driver per shell: a changing moveBy goes through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [follow, moveBy === null, timers],
  );

  useEffect(() => () => driver?.dispose(), [driver]);
  useEffect(() => driver?.setReducedMotion(reducedMotion), [driver, reducedMotion]);
  useEffect(() => driver?.setAlert(alert), [driver, alert]);
  useEffect(() => driver?.setEnabled(enabled), [driver, enabled]);

  // Quiet: the emergency stop at once; the other quiet rules every few seconds while following.
  useEffect(() => {
    if (!driver) return;
    if (killSwitch || !enabled) {
      driver.setSuspended(killSwitch);
      return;
    }
    let live = true;
    // Until Core has answered, Fawkes stays where it is.
    driver.setSuspended(true);
    const check = () =>
      void host.quietNow().then(
        (quiet) => live && driver.setSuspended(quiet),
        () => live && driver.setSuspended(true),
      );
    check();
    const id = setInterval(check, QUIET_CHECK_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [driver, enabled, killSwitch, host]);

  return {
    dragStarted: useCallback(() => driver?.dragStarted(), [driver]),
    dragEnded: useCallback(() => driver?.dragEnded(), [driver]),
  };
}
