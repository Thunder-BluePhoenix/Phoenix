// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Key chords for the in-app shortcuts (command palette and navigation), kept apart from the
// desktop's GLOBAL shortcuts (those are the shell's, see shortcuts-shell.ts).
//
// The rules exist so a shortcut can never swallow typing or an AltGr / Option character:
//   * every binding needs the platform modifier ("Mod": Cmd on macOS, Ctrl elsewhere), so a bare
//     letter or digit can never be a shortcut;
//   * Alt is only allowed together with Mod AND Shift (Ctrl+Alt alone is AltGr on Windows and Linux,
//     Option+key types symbols on macOS, and Alt+Shift switches the keyboard layout on Windows);
//   * the key is one letter or digit, matched by its physical position (`event.code`) so Option on
//     macOS, which changes `event.key`, cannot hide it;
//   * the dispatcher (useShortcuts.ts) ignores every chord but the palette's while a text field is
//     focused, so a chord can never insert or replace typed text.
// The whole set is one palette chord (Mod+K) and Mod+Alt+Shift+<digit> for the rest. AltGraph is
// deliberately not tested: Windows reports Ctrl+Alt as AltGraph, which would disable these chords
// there, and outside a text field AltGr types nothing.

export type Platform = "mac" | "other";

/** The parts of `navigator` platform detection reads (all optional: a webview may omit any). */
export interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** macOS (also iPadOS) uses Cmd; every other platform Ctrl. Never throws where `navigator` is absent. */
export function detectPlatform(
  nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Platform {
  const text = nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(text) ? "mac" : "other";
}

export interface Chord {
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** One lower-case letter or digit. */
  key: string;
}

export class ChordError extends Error {}

/** `Mod+K`, `Mod+Shift+K`, `Mod+Alt+Shift+1`. Throws ChordError for anything the rules forbid. */
export function parseChord(text: string): Chord {
  const parts = text.split("+").map((p) => p.trim());
  const key = (parts.pop() ?? "").toLowerCase();
  if (!/^[a-z0-9]$/.test(key))
    throw new ChordError(`"${text}": the key must be one letter or digit`);
  const chord: Chord = { mod: false, alt: false, shift: false, key };
  for (const part of parts) {
    const name = part.toLowerCase();
    if (name === "mod" && !chord.mod) chord.mod = true;
    else if (name === "alt" && !chord.alt) chord.alt = true;
    else if (name === "shift" && !chord.shift) chord.shift = true;
    else throw new ChordError(`"${text}": unknown or repeated modifier "${part}"`);
  }
  if (!chord.mod) throw new ChordError(`"${text}": every shortcut needs the Mod key`);
  if (chord.alt && !chord.shift) {
    throw new ChordError(`"${text}": Alt needs Shift as well (Ctrl+Alt is AltGr)`);
  }
  return chord;
}

/** Canonical text: two chords are the same binding exactly when their ids are equal. */
export function chordId(chord: Chord): string {
  const mods = [chord.mod && "Mod", chord.alt && "Alt", chord.shift && "Shift"].filter(Boolean);
  return [...mods, chord.key.toUpperCase()].join("+");
}

/** What is shown next to a command: Cmd and Option on macOS, Ctrl and Alt elsewhere. */
export function formatChord(chord: Chord, platform: Platform): string {
  const mac = platform === "mac";
  const mods = [
    chord.mod && (mac ? "Cmd" : "Ctrl"),
    chord.alt && (mac ? "Option" : "Alt"),
    chord.shift && "Shift",
  ].filter(Boolean);
  return [...mods, chord.key.toUpperCase()].join("+");
}

/** The value of `aria-keyshortcuts` for a chord. */
export function ariaShortcut(chord: Chord, platform: Platform): string {
  const mods = [
    chord.mod && (platform === "mac" ? "Meta" : "Control"),
    chord.alt && "Alt",
    chord.shift && "Shift",
  ].filter(Boolean);
  return [...mods, chord.key.toUpperCase()].join("+");
}

/** The letter or digit a key event was made with, from its position when it has one. */
function eventKey(e: KeyboardEvent): string | null {
  const code = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code ?? "");
  if (code) return (code[1] ?? code[2] ?? "").toLowerCase();
  return /^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : null;
}

/**
 * The chord a key event is, or null when it cannot be one of ours (a different key, Cmd and Ctrl
 * together, or the wrong platform's modifier).
 */
export function chordFromEvent(e: KeyboardEvent, platform: Platform): Chord | null {
  const mod = platform === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod && (e.metaKey || e.ctrlKey)) return null;
  const key = eventKey(e);
  if (!key) return null;
  return { mod, alt: e.altKey, shift: e.shiftKey, key };
}

/** Whether keystrokes at `target` are text being typed (inputs, textareas, selects, editable content). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target.closest(
      '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    ) !== null
  );
}

/** A keystroke that is part of composing text with an input method (Enter confirms, not submits). */
export const isComposing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229;

const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);
const NAMED_CODES: Readonly<Record<string, string>> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/**
 * A key press as the desktop shell's accelerator text ("Ctrl+Alt+Shift+C"), for capturing a
 * binding. `pending` is a modifier pressed on its own (wait for the main key); `unsupported` is a
 * key the shell's grammar has no name for. Whether the chord is allowed is the shell's decision,
 * never made here.
 */
export type Captured =
  { kind: "pending" } | { kind: "unsupported" } | { kind: "accelerator"; text: string };

export function acceleratorFromEvent(e: KeyboardEvent): Captured {
  if (MODIFIER_KEYS.has(e.key)) return { kind: "pending" };
  const code = e.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit([0-9])$/.exec(code)?.[1];
  const named = NAMED_CODES[code];
  const fkey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)?.[0];
  const main = letter ?? fkey ?? named;
  if (!main) return { kind: "unsupported" };
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd"];
  return { kind: "accelerator", text: [...mods.filter(Boolean), main].join("+") };
}
