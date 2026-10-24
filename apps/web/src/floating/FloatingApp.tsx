// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { DragEvent, SoundPlayer } from "@phoenix/pet-runtime";
import { visualFor } from "@phoenix/pet-states";
import { useCallback, useEffect, useMemo, useState } from "react";
import { tauriFileDrop, type FileDropShell } from "../commands/file-drop-shell";
import { tauriShortcuts, type ShortcutsShell } from "../commands/shortcuts-shell";
import { AgentApprovals } from "../components/AgentApprovals";
import { NativeDropStatus } from "../components/NativeDropStatus";
import { RebirthAvatar } from "../components/RebirthAvatar";
import { AwakeCountdown } from "../components/Awake";
import { SourcePills } from "../components/SourcePills";
import { useWornOutfit } from "../core/appearance";
import { useDisplayedState } from "../core/context";
import { useMute } from "../core/mute";
import { useNativeFileDrop } from "../core/native-drop";
import { useSoundHost } from "../core/sounds";
import { usePillSwitcher, useSwitchPillsShortcut } from "../core/pill-switch";
import { useKillSwitch, usePetSettings } from "../core/hooks";
import type { PetState } from "../core/types";
import { useT } from "../i18n";
import { tauriFollowShell, type FollowShell } from "./follow-shell";
import type { FollowTimers } from "./follow-driver";
import type { DesktopShell } from "./shell";
import { useFollowCursor, useReducedMotion } from "./use-follow-cursor";

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
  fileDrop,
  sounds,
  follow,
  followTimers,
}: {
  shell: DesktopShell | null;
  /** The desktop's mute flag and shortcuts (null in a browser, where nothing is muted). */
  shortcuts?: ShortcutsShell | null;
  /** Files dropped on the window itself (null in a browser, where the page gets HTML5 drops). */
  fileDrop?: FileDropShell | null;
  /** The pet's sound player, when the host has one; silenced while the desktop is muted. */
  sounds?: SoundPlayer;
  /**
   * What the desktop lets this page read for follow-the-pointer (null in a browser, where nothing
   * follows). Left out: looked up from the Tauri bridge.
   */
  follow?: FollowShell | null;
  /** Timers behind follow-the-pointer; tests pass fakes. */
  followTimers?: FollowTimers;
}) {
  const t = useT();
  // Looked up once: a new shell object on every render would resubscribe to the mute event.
  const [own] = useState(() => tauriShortcuts());
  const shortcutsShell = shortcuts === undefined ? own : shortcuts;
  const [ownDrop] = useState(() => tauriFileDrop());
  const nativeDrop = useNativeFileDrop(fileDrop === undefined ? ownDrop : fileDrop);
  // A host-injected player (tests) wins; otherwise the window uses the Phase 59 sound host.
  const soundHost = useSoundHost();
  const mute = useMute(shortcutsShell, sounds ?? soundHost.player);
  // "Switch pills": the shell sends the shortcut here while this window shows the pills.
  const { pills, selected } = usePillSwitcher();
  useSwitchPillsShortcut(shortcutsShell, (route) => shell?.openInPhoenix(route));
  const state = useDisplayedState();
  const { data: settings } = usePetSettings();
  const bubble = useBubble(state);
  const outfit = useWornOutfit();

  // Phase 59: follow the pointer and fly home on an alert. Opt-in (off by default), desktop only.
  const [ownFollow] = useState(() => tauriFollowShell());
  const followShell = follow === undefined ? ownFollow : follow;
  const killSwitch = useKillSwitch().data;
  const reduced = useReducedMotion(settings.reduced_motion);
  const moveBy = useMemo(() => (shell ? shell.moveBy.bind(shell) : null), [shell]);
  const driving = useFollowCursor({
    follow: followShell,
    moveBy,
    enabled: settings.follow_cursor === true,
    reducedMotion: reduced,
    alert: state.state !== "OFFLINE" && visualFor(state.state).urgent,
    killSwitch,
    host: soundHost,
    ...(followTimers ? { timers: followTimers } : {}),
  });

  const onDrag = useCallback(
    (e: DragEvent) => {
      if (e.phase === "start") driving.dragStarted();
      else if (e.phase === "move") shell?.moveBy(e.dx, e.dy);
      else if (e.phase === "end") {
        shell?.dragEnded();
        driving.dragEnded();
      }
    },
    [shell, driving],
  );

  return (
    <div
      className="floating-root"
      data-drop-over={nativeDrop.over ? "true" : "false"}
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
      <NativeDropStatus drop={nativeDrop} className="drop-status" />
      <AgentApprovals compact />
      <RebirthAvatar
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
      <SourcePills pills={pills} selected={selected} />
      <AwakeCountdown />
      {state.recording && (
        <span className="rec-pill" role="status">
          <span className="rec-dot" aria-hidden="true" /> {t("common.petState.RECORDING")}
        </span>
      )}
    </div>
  );
}
