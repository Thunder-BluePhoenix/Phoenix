// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mountFawkes, type FawkesController } from "@phoenix/pet-runtime";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PetState } from "../core/types";

export interface FawkesAvatarProps {
  state: PetState;
  size?: number;
  expanded?: boolean;
  controls?: string;
  onActivate?: () => void;
  /** "auto" follows the OS reduced-motion setting. */
  reducedMotion?: "auto" | "on" | "off";
}

export interface FawkesAvatarHandle {
  focus(): void;
}

/** React wrapper around the framework-free pet runtime (pet/runtime). */
export const FawkesAvatar = forwardRef<FawkesAvatarHandle, FawkesAvatarProps>(function FawkesAvatar(
  { state, size = 32, expanded, controls, onActivate, reducedMotion = "auto" },
  ref,
) {
  const host = useRef<HTMLSpanElement>(null);
  const pet = useRef<FawkesController | null>(null);
  const activate = useRef(onActivate);
  activate.current = onActivate;

  useImperativeHandle(ref, () => ({ focus: () => pet.current?.element.focus() }), []);

  useEffect(() => {
    const controller = mountFawkes(host.current!, { size, actionHint: "Open Pet Panel" });
    const off = controller.on("activate", () => activate.current?.());
    pet.current = controller;
    return () => {
      off();
      controller.destroy();
      pet.current = null;
    };
  }, [size]);

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
