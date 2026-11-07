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
import { isMessageKey, useT } from "../i18n";

export interface FawkesAvatarProps {
  state: PetState;
  size?: number;
  expanded?: boolean;
  controls?: string;
  onActivate?: () => void;
  /** Desktop companions: a double-click opens the full app instead of the single-click preview. */
  onDoubleActivate?: () => void;
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
    onDoubleActivate,
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
  const t = useT();
  const host = useRef<HTMLSpanElement>(null);
  const pet = useRef<FawkesController | null>(null);
  const activate = useRef(onActivate);
  activate.current = onActivate;
  const doubleActivate = useRef(onDoubleActivate);
  doubleActivate.current = onDoubleActivate;
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = () => {
    if (pendingClick.current !== null) clearTimeout(pendingClick.current);
    pendingClick.current = null;
  };
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
      actionHint: actionHint ?? t("pet.avatar.openPanel"),
      // The accessible name in the language on screen. Core's explanation is data and stays as is.
      describe: (view, parts) => {
        const key = `common.petState.${view.state}`;
        const label = isMessageKey(key) ? t(key) : parts.label;
        const sentences = [t("pet.avatar.name", { label })];
        if (parts.explanation !== parts.label) sentences.push(parts.explanation);
        if (parts.recording && view.state !== "RECORDING") {
          sentences.push(t("pet.avatar.recordingActive"));
        }
        return sentences.reduce((head, tail) => t("pet.avatar.join", { head, tail }));
      },
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
    const off = controller.on("activate", ({ clickCount }) => {
      cancelClick();
      if (!doubleActivate.current || clickCount === 0) {
        activate.current?.();
      } else if (clickCount === 1) {
        // Let the native double-click arrive before changing the window's layout.
        pendingClick.current = setTimeout(() => {
          pendingClick.current = null;
          activate.current?.();
        }, 400);
      }
    });
    const onDoubleClick = () => {
      cancelClick();
      doubleActivate.current?.();
    };
    controller.element.addEventListener("dblclick", onDoubleClick);
    const offDrag = controller.on("drag", (e) => {
      if (e.phase === "start") cancelClick();
      drag.current?.(e);
    });
    pet.current = controller;
    return () => {
      off();
      offDrag();
      cancelClick();
      controller.element.removeEventListener("dblclick", onDoubleClick);
      controller.destroy();
      pet.current = null;
    };
  }, [draggable, actionHint, interactive, t]);

  // Expanding the island resizes the same animated pet instead of restarting its renderer.
  useEffect(() => {
    pet.current?.element.style.setProperty("--fawkes-size", `${size}px`);
  }, [size]);

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
