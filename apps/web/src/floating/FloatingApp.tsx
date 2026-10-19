// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { DragEvent, SoundPlayer } from "@phoenix/pet-runtime";
import { visualFor } from "@phoenix/pet-states";
import { useCallback, useEffect, useState } from "react";
import { tauriShortcuts, type ShortcutsShell } from "../commands/shortcuts-shell";
import { FawkesAvatar } from "../components/FawkesAvatar";
import { ActiveSourcePills } from "../components/SourcePills";
import { useWornOutfit } from "../core/appearance";
import { useDisplayedState } from "../core/context";
import { useMute } from "../core/mute";
import { usePetSettings } from "../core/hooks";
import type { PetState } from "../core/types";
import { useT } from "../i18n";
import type { DesktopShell } from "./shell";

/** Non-urgent messages fade after this long; urgent ones stay until the state changes. */
export const BUBBLE_MS = 8_000;
export const FLOATING_SIZE = 96;

/**
 * The in-app page that explains a state: meetings for Kage, the Pet Panel's Overview (where the
 * approvals are listed) when Fawkes is waiting for a decision, otherwise the home page.
 */
export function routeFor(state: PetState): string {
  if (state.source === "kage" || state.recording) return "/meetings";
  return state.state === "WAITING" ? "/panel/overview" : "/";
}

/** The speech-bubble text for the current state, or null when Fawkes has nothing to say. */
export function useBubble(state: PetState): string | null {
  const key = `${state.state}|${state.explanation}`;
  const [expired, setExpired] = useState<string | null>(null);
  const quiet = state.state === "IDLE" || state.state === "SLEEPING";
  const sticky = state.state === "OFFLINE" || visualFor(state.state).urgent;

  useEffect(() => {
    if (quiet || sticky) return;
    const timer = setTimeout(() => setExpired(key), BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [key, quiet, sticky]);

  if (quiet || (!sticky && expired === key)) return null;
  return state.explanation;
}

/**
 * Floating Fawkes: the pet, a short speech bubble and, only while Kage is
 * recording, an explicit recording indicator. Hidden or visible, Fawkes never
 * implies recording by itself (PRD §15).
 */
export function FloatingApp({
  shell,
  shortcuts,
  sounds,
}: {
  shell: DesktopShell | null;
  /** The desktop's mute flag and shortcuts (null in a browser, where nothing is muted). */
  shortcuts?: ShortcutsShell | null;
  /** The pet's sound player, when the host has one; silenced while the desktop is muted. */
  sounds?: SoundPlayer;
}) {
  const t = useT();
  // Looked up once: a new shell object on every render would resubscribe to the mute event.
  const [own] = useState(() => tauriShortcuts());
  const mute = useMute(shortcuts === undefined ? own : shortcuts, sounds);
  const state = useDisplayedState();
  const { data: settings } = usePetSettings();
  const bubble = useBubble(state);
  const outfit = useWornOutfit();

  const onDrag = useCallback(
    (e: DragEvent) => {
      if (e.phase === "move") shell?.moveBy(e.dx, e.dy);
      else if (e.phase === "end") shell?.dragEnded();
    },
    [shell],
  );

  return (
    <div
      className="floating-root"
      onContextMenu={(e) => {
        e.preventDefault();
        shell?.showMenu();
      }}
    >
      <div className="bubble-slot">
        {bubble && !mute.muted && (
          // Fawkes' own accessible name already carries this text; don't announce it twice.
          <p className="bubble" data-tone={visualFor(state.state).tone} aria-hidden="true">
            {bubble}
          </p>
        )}
      </div>
      <FawkesAvatar
        state={state}
        size={FLOATING_SIZE}
        draggable
        reducedMotion={settings.reduced_motion}
        outfit={outfit}
        {...(mute.sounds ? { sounds: mute.sounds } : {})}
        actionHint={t("pet.desktop.openInPhoenix")}
        onDrag={onDrag}
        onActivate={() => shell?.openInPhoenix(routeFor(state))}
      />
      <ActiveSourcePills />
      {state.recording && (
        <span className="rec-pill" role="status">
          <span className="rec-dot" aria-hidden="true" /> {t("common.petState.RECORDING")}
        </span>
      )}
    </div>
  );
}
