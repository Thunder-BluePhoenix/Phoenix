// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The ONE keydown listener for in-app shortcuts. Nothing else in the app binds a chord: components
// that need a key (Escape in a popover, arrows in a list) handle it on their own element, and
// everything that is a command goes through the registry and this dispatcher.
import { useEffect, useRef } from "react";
import type { Bindings, Command, CommandContext } from "./registry";
import { available } from "./registry";
import { chordFromEvent, chordId, isComposing, isTypingTarget, type Platform } from "./keys";

/** Marks the palette's own dialog so "another modal is open" can tell it apart. */
export const PALETTE_ATTRIBUTE = "data-command-palette";

/** A modal dialog that is not the command palette is on screen: shortcuts stay out of its way. */
export function otherModalOpen(root: ParentNode = document): boolean {
  return (
    root.querySelector(`[role="dialog"][aria-modal="true"]:not([${PALETTE_ATTRIBUTE}])`) !== null
  );
}

/**
 * What a keydown should run, or null. Pure apart from reading the DOM for the modal check; this is
 * the whole decision, so the listener below only has to call it.
 */
export function commandFor(
  e: KeyboardEvent,
  bindings: Bindings,
  platform: Platform,
  ctx: CommandContext,
): Command | null {
  // An input method is composing text: Enter, arrows and letters belong to it, never to us.
  if (isComposing(e)) return null;
  const chord = chordFromEvent(e, platform);
  if (!chord) return null;
  const command = bindings.byChord.get(chordId(chord));
  if (!command) return null;
  if (!command.allowWhileTyping && isTypingTarget(e.target)) return null;
  if (otherModalOpen()) return null;
  return available([command], ctx).length === 1 ? command : null;
}

/** Installs the dispatcher on the document for as long as the component is mounted. */
export function useShortcuts(bindings: Bindings, platform: Platform, ctx: CommandContext): void {
  // The listener is installed once; the latest context is read when a key arrives.
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = commandFor(e, bindings, platform, latest.current);
      if (!command) return;
      e.preventDefault();
      command.run(latest.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bindings, platform]);
}
