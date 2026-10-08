// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mountFawkes, type DragEvent, type FawkesController } from "@phoenix/pet-runtime";
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
  },
  ref,
) {
  const host = useRef<HTMLSpanElement>(null);
  const pet = useRef<FawkesController | null>(null);
  const activate = useRef(onActivate);
  activate.current = onActivate;
  const drag = useRef(onDrag);
  drag.current = onDrag;

  useImperativeHandle(ref, () => ({ focus: () => pet.current?.element.focus() }), []);

  useEffect(() => {
    const controller = mountFawkes(host.current!, {
      size,
      actionHint: actionHint ?? "Open Pet Panel",
      ...(draggable ? { draggable } : {}),
    });
    const off = controller.on("activate", () => activate.current?.());
    const offDrag = controller.on("drag", (e) => drag.current?.(e));
    pet.current = controller;
    return () => {
      off();
      offDrag();
      controller.destroy();
      pet.current = null;
    };
  }, [size, draggable, actionHint]);

  useEffect(() => {
    pet.current?.update(state);
  }, [state]);

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
