// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  mountFawkes,
  type DragEvent,
  type FawkesController,
  type InteractionOptions,
  type OutfitPack,
  type SoundPlayer,
} from "@phoenix/pet-runtime";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PetState } from "../core/types";

export interface FawkesAvatarProps {
  state: PetState;
  size?: number;
  expanded?: boolean;
  controls?: string;
  onActivate?: () => void;
  /** Suffix for the accessible name (default "Open Pet Panel"). */
  actionHint?: string;
  /** Lets the pointer drag Fawkes (floating desktop pet); reports movement through onDrag. */
  draggable?: boolean;
  onDrag?: (e: DragEvent) => void;
  /** "auto" follows the OS reduced-motion setting. */
  reducedMotion?: "auto" | "on" | "off";
  /**
   * Phase 59 interactions: greeting, eyes following the cursor, hover, poke, dizzy and the happy
   * jump on a real completion event (default on). All of it is cosmetic and never changes `state`.
   */
  interactive?: boolean;
  /**
   * Phase 61: the outfit Fawkes wears (null or omitted: none). Purely cosmetic: it never changes
   * `data-state`, the accessible name or the live region, and under reduced motion only the still
   * variants render.
   */
  outfit?: OutfitPack | null;
  /** Sound player (policy and backend injected by the host). Omit for a silent Fawkes. */
  sounds?: SoundPlayer;
  /** Test seam: injected clock/RNG/timers for the interactions. */
  interactionOptions?: Pick<InteractionOptions, "timers" | "config" | "cursorTarget">;
}

export interface FawkesAvatarHandle {
  focus(): void;
}

/** React wrapper around the framework-free pet runtime (pet/runtime). */
export const FawkesAvatar = forwardRef<FawkesAvatarHandle, FawkesAvatarProps>(function FawkesAvatar(
  {
    state,
    size = 32,
    expanded,
    controls,
    onActivate,
    draggable,
    onDrag,
    actionHint,
    reducedMotion = "auto",
    interactive = true,
    outfit,
    sounds,
    interactionOptions,
  },
  ref,
) {
  const host = useRef<HTMLSpanElement>(null);
  const pet = useRef<FawkesController | null>(null);
  const activate = useRef(onActivate);
  activate.current = onActivate;
  const drag = useRef(onDrag);
  drag.current = onDrag;
  const soundPlayer = useRef(sounds);
  soundPlayer.current = sounds;
  const injected = useRef(interactionOptions);
  injected.current = interactionOptions;
  const initial = useRef(state);
  initial.current = state;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const outfitRef = useRef(outfit);
  outfitRef.current = outfit;

  useImperativeHandle(ref, () => ({ focus: () => pet.current?.element.focus() }), []);

  useEffect(() => {
    const controller = mountFawkes(host.current!, {
      size,
      actionHint: actionHint ?? "Open Pet Panel",
      ...(draggable ? { draggable } : {}),
      reducedMotion:
        reducedMotionRef.current === "auto" ? "auto" : reducedMotionRef.current === "on",
      outfit: outfitRef.current ?? null,
      ...(interactive
        ? {
            interactions: {
              ...injected.current,
              // Resolved at trigger time so a settings change applies without remounting.
              sounds: {
                trigger: (event) =>
                  soundPlayer.current?.trigger(event) ?? Promise.resolve("disabled"),
              },
              greetOnMount: true,
            },
          }
        : {}),
    });
    controller.update(initial.current);
    const off = controller.on("activate", () => activate.current?.());
    const offDrag = controller.on("drag", (e) => drag.current?.(e));
    pet.current = controller;
    return () => {
      off();
      offDrag();
      controller.destroy();
      pet.current = null;
    };
  }, [size, draggable, actionHint, interactive]);

  useEffect(() => {
    pet.current?.update(state);
  }, [state]);

  useEffect(() => {
    pet.current?.setOutfit(outfit ?? null);
  }, [outfit]);

  useEffect(() => {
    pet.current?.setReducedMotion(reducedMotion === "auto" ? "auto" : reducedMotion === "on");
  }, [reducedMotion, size]);

  useEffect(() => {
    const el = pet.current?.element;
    if (!el) return;
    if (expanded !== undefined) el.setAttribute("aria-expanded", String(expanded));
    if (controls) el.setAttribute("aria-controls", controls);
  }, [expanded, controls]);

  return <span ref={host} className="fawkes-host" />;
});
