// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The desktop's mute flag in the Fawkes and island windows. The shell only keeps and announces the
// flag (`shortcuts://mute`); these windows are what stay quiet: no sounds, no speech-bubble
// notifications. Fawkes keeps showing its state (the avatar, its accessible name and the recording
// indicator are never muted: a muted pet must still never hide that a call is being recorded).
import type { SoundPlayer } from "@phoenix/pet-runtime";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ShortcutsShell } from "../commands/shortcuts-shell";

/**
 * The flag as this window knows it. Until the shell has answered the flag is unknown, and unknown
 * counts as muted: the launch sound must not play for someone who muted Fawkes yesterday.
 */
export class MuteState {
  private value: boolean | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly settled = Promise.withResolvers<void>();

  /** Without a shell (a plain browser) there is nothing to mute: nothing is ever silenced. */
  constructor(hasShell: boolean) {
    if (!hasShell) {
      this.value = false;
      this.settled.resolve();
    }
  }

  readonly isMuted = (): boolean => this.value ?? true;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Resolves once the flag is known (or the shell could not say, which stays muted). */
  get ready(): Promise<void> {
    return this.settled.promise;
  }

  set(muted: boolean): void {
    this.settled.resolve();
    if (this.value === muted) return;
    this.value = muted;
    for (const listener of [...this.listeners]) listener();
  }

  /** The shell could not report the flag: stay muted rather than guess. */
  giveUp(): void {
    this.settled.resolve();
  }

  /** Follows the shell: its current flag, then every change. Returns the stop function. */
  attach(shell: ShortcutsShell): () => void {
    let alive = true;
    let off: (() => void) | undefined;
    // A change announced while the first answer is still on its way is newer than that answer.
    let announced = false;
    void shell
      .onMute((muted) => {
        if (!alive) return;
        announced = true;
        this.set(muted);
      })
      .then((unlisten) => {
        if (alive) off = unlisten;
        else unlisten();
      })
      .catch(() => this.giveUp());
    void shell
      .list()
      .then((report) => {
        if (alive && !announced) this.set(report.muted);
      })
      .catch(() => this.giveUp());
    return () => {
      alive = false;
      off?.();
    };
  }
}

/** A sound player that stays silent while `state` says muted, and waits for the first answer. */
export function silenced(player: SoundPlayer, state: MuteState): SoundPlayer {
  return {
    async trigger(event) {
      await state.ready;
      return state.isMuted() ? "muted" : player.trigger(event);
    },
  };
}

export interface MuteHandle {
  muted: boolean;
  /** `player` made silent while muted; undefined when there is no player. */
  sounds: SoundPlayer | undefined;
  /** Asks the shell to flip the flag; null without a shell (nothing to mute in a browser). */
  toggle: (() => void) | null;
}

/** Mute state of a desktop window (`shell` null in a browser: never muted). */
export function useMute(shell: ShortcutsShell | null, player?: SoundPlayer): MuteHandle {
  const [state] = useState(() => new MuteState(shell !== null));
  useEffect(() => (shell ? state.attach(shell) : undefined), [shell, state]);
  const muted = useSyncExternalStore(state.subscribe, state.isMuted);
  const sounds = useMemo(() => (player ? silenced(player, state) : undefined), [player, state]);
  const toggle = useMemo(
    () =>
      shell
        ? () =>
            void shell.setMuted(!state.isMuted()).then(
              (r) => state.set(r.muted),
              () => {},
            )
        : null,
    [shell, state],
  );
  return { muted, sounds, toggle };
}
