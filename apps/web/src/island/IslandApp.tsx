// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { visualFor } from "@phoenix/pet-states";
import { useEffect, useState, type CSSProperties } from "react";
import { FawkesAvatar } from "../components/FawkesAvatar";
import { ActiveSourcePills } from "../components/SourcePills";
import { useWornOutfit } from "../core/appearance";
import { useDisplayedState } from "../core/context";
import { usePetSettings } from "../core/hooks";
import type { PetState } from "../core/types";
import { routeFor, useBubble } from "../floating/FloatingApp";
import type { IslandFrame, IslandShell } from "./shell";

export const ISLAND_AVATAR_SIZE = 24;
export const EXPANDED_AVATAR_SIZE = 48;

const QUIET_STATES = ["IDLE", "SLEEPING", "OFFLINE"];

/**
 * What the shell needs to know to decide whether the island may go back to hidden: is Fawkes
 * doing something (`active`), and does it need the user (`urgent`: an approval, an error,
 * recording). Urgent always keeps the island visible (island_state.rs).
 */
export function activityOf(state: PetState): { active: boolean; urgent: boolean } {
  const urgent = visualFor(state.state).urgent || state.recording;
  return { active: urgent || !QUIET_STATES.includes(state.state), urgent };
}

/** The frame a plain browser (no shell) shows: a small pill, so the page can be previewed. */
const PREVIEW_FRAME: IslandFrame = {
  state: "small",
  pointer: "poll",
  layout: { rect: { x: 0, y: 0, w: 220, h: 34 }, notch_width: 0, has_notch: false },
};

/** The shell's frames: the current one on load, then every change. */
export function useFrame(shell: IslandShell | null): IslandFrame {
  const [frame, setFrame] = useState<IslandFrame | null>(null);
  useEffect(() => {
    if (!shell) return;
    let alive = true;
    let off: (() => void) | undefined;
    void shell
      .onFrame((next) => alive && setFrame(next))
      .then((unlisten) => {
        if (alive) off = unlisten;
        else unlisten();
      });
    void shell.frame().then((current) => alive && current && setFrame((prev) => prev ?? current));
    return () => {
      alive = false;
      off?.();
    };
  }, [shell]);
  return frame ?? (shell ? { ...PREVIEW_FRAME, state: "hidden" } : PREVIEW_FRAME);
}

/**
 * Fawkes Island: the same pet as the floating window and the navbar, drawn at the top edge of
 * the screen (in the notch's "ears" on a Mac that has one). Hidden it is invisible; hover
 * peeks it; a click expands it. The shell owns the window and the state machine; this page
 * only draws the frame it is given and reports the hover (where only the page can see the
 * pointer), clicks, Escape and what Fawkes is doing.
 */
export function IslandApp({ shell }: { shell: IslandShell | null }) {
  const state = useDisplayedState();
  const { data: settings } = usePetSettings();
  const bubble = useBubble(state);
  const outfit = useWornOutfit();
  const frame = useFrame(shell);
  const { active, urgent } = activityOf(state);

  useEffect(() => {
    shell?.send({ kind: "activity", active, urgent });
  }, [shell, active, urgent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") shell?.send({ kind: "collapse" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shell]);

  const visual = visualFor(state.state);
  const expanded = frame.state === "expanded";
  const hidden = frame.state === "hidden";
  const style = { "--notch-width": `${frame.layout.notch_width}px` } as CSSProperties;

  return (
    <div
      className="island-root"
      data-state={frame.state}
      data-notch={frame.layout.has_notch ? "true" : "false"}
      data-tone={visual.tone}
      style={style}
      onPointerEnter={() => shell?.send({ kind: "pointer_enter" })}
      onPointerLeave={() => shell?.send({ kind: "pointer_leave" })}
      onContextMenu={(e) => {
        e.preventDefault();
        shell?.showMenu();
      }}
    >
      {!hidden && (
        <>
          <div className="island-bar">
            <div className="island-ear island-ear-left">
              <FawkesAvatar
                state={state}
                size={expanded ? EXPANDED_AVATAR_SIZE : ISLAND_AVATAR_SIZE}
                expanded={expanded}
                reducedMotion={settings.reduced_motion}
                outfit={outfit}
                actionHint={expanded ? "Collapse the island" : "Expand the island"}
                onActivate={() => shell?.send({ kind: "toggle" })}
              />
            </div>
            {frame.layout.has_notch && <div className="island-notch" aria-hidden="true" />}
            <div className="island-ear island-ear-right">
              <span className="island-label" data-tone={visual.tone}>
                {state.recording ? "Recording" : visual.label}
              </span>
            </div>
          </div>
          {expanded && (
            <div className="island-body">
              {state.explanation && (
                <p className="island-text" data-tone={visual.tone}>
                  {bubble ?? state.explanation}
                </p>
              )}
              <ActiveSourcePills />
              {state.recording && (
                <span className="rec-pill" role="status">
                  <span className="rec-dot" aria-hidden="true" /> Recording
                </span>
              )}
              <button
                type="button"
                className="island-open"
                onClick={() => shell?.openInPhoenix(routeFor(state))}
              >
                Open in Phoenix
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
