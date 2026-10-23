// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 70: "switch pills". ONE command moves to the next (or previous) active source pill, and the
// three ways to ask for it all go through `switchPillsCommand`: the global `switch_pills` shortcut
// (the desktop shell sends `shortcuts://switch_pills` to the Fawkes or island window), the in-app
// command palette entries, and the spoken request "switch pills". The pill model's pure `nextPill`
// decides which pill is next; this file only remembers which one is selected per Core client and
// where to go for it.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ShortcutsShell } from "../commands/shortcuts-shell";
import { nextPill, useActivePills, type Pill, type PillDirection } from "./appearance";
import type { PhoenixClient } from "./client";
import { useClient } from "./context";

/** Where "switch pills" goes when no source is active: the activity feed of the Pet Panel. */
export const PILLS_FALLBACK_ROUTE = "/panel/activity";

/** The Phoenix page that shows what a source is doing (agents: the sessions; the rest: capabilities). */
export function routeForPill(id: string): string {
  if (id.startsWith("agent:")) return "/agents";
  if (id.startsWith("capability:")) return "/panel/capabilities";
  return PILLS_FALLBACK_ROUTE;
}

export interface PillSwitchResult {
  /** The pill that is selected now; null when no source is active. */
  pill: Pill | null;
  /** The in-app route that shows it (the fallback route when there is no pill). */
  route: string;
}

/** The pills a window shows and the one the user switched to. One per Core client. */
export class PillSwitcher {
  private pills: readonly Pill[] = [];
  private current: string | null = null;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The id of the selected pill, or null. It may name a source that went quiet since. */
  readonly selected = (): string | null => this.current;

  /** The window's active pills, as `useActivePills` last saw them. */
  publish(pills: readonly Pill[]): void {
    this.pills = pills;
  }

  /** Selects the next (or previous) pill and says where to look at it. */
  switch(direction: PillDirection): PillSwitchResult {
    const pill = nextPill(this.current, this.pills, direction);
    this.current = pill?.id ?? null;
    for (const listener of [...this.listeners]) listener();
    return { pill, route: pill ? routeForPill(pill.id) : PILLS_FALLBACK_ROUTE };
  }
}

const switchers = new WeakMap<PhoenixClient, PillSwitcher>();

/** The one switcher of this client (shared by the shortcut, the palette and the voice assistant). */
export function pillSwitcherFor(client: PhoenixClient): PillSwitcher {
  let switcher = switchers.get(client);
  if (!switcher) {
    switcher = new PillSwitcher();
    switchers.set(client, switcher);
  }
  return switcher;
}

/**
 * THE command. Moves the selection and sends the person to what the pill shows: `navigate` is the
 * web app's hash router by default, the desktop shell's "open in Phoenix" for the Fawkes windows.
 */
export function switchPillsCommand(
  client: PhoenixClient,
  direction: PillDirection,
  navigate: (route: string) => void = (route) => {
    if (typeof window !== "undefined") window.location.hash = `#${route}`;
  },
): PillSwitchResult {
  const result = pillSwitcherFor(client).switch(direction);
  navigate(result.route);
  return result;
}

/**
 * The active pills of this window, kept in the client's switcher so non-React callers (the voice
 * assistant) switch over the same list, plus which one is selected.
 */
export function usePillSwitcher(): { pills: Pill[]; selected: string | null } {
  const client = useClient();
  const switcher = pillSwitcherFor(client);
  const pills = useActivePills();
  switcher.publish(pills);
  const selected = useSyncExternalStore(switcher.subscribe, switcher.selected);
  return { pills, selected };
}

/**
 * The global "switch pills" shortcut: the desktop shell sends `shortcuts://switch_pills` to the one
 * Fawkes window that is on screen, and it runs the same command as the palette and voice.
 * `shell` null (a plain browser) listens to nothing.
 */
export function useSwitchPillsShortcut(
  shell: ShortcutsShell | null,
  open: (route: string) => void,
): void {
  const client = useClient();
  const latest = useRef(open);
  latest.current = open;
  const run = useCallback(
    (direction: PillDirection) => switchPillsCommand(client, direction, (r) => latest.current(r)),
    [client],
  );
  useEffect(() => {
    if (!shell) return;
    let alive = true;
    let off: (() => void) | undefined;
    shell
      .onSwitchPills(run)
      .then((unlisten) => {
        if (alive) off = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      alive = false;
      off?.();
    };
  }, [shell, run]);
}
