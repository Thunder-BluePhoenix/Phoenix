// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * What the voice window tells the desktop shell, and the ONLY thing it tells it: its document title.
 * The window `phoenix-voice` is in no Tauri capability, so this page can invoke no command and
 * listen to no event; the shell reads the title (`on_document_title_changed`) as a claim and shows
 * its own LISTENING indicator (window title, tray tooltip) from the microphone permission it
 * allowed. These strings are the same as `CLAIM_ACTIVE` and `CLAIM_IDLE` in
 * `apps/desktop/src-tauri/src/voice_window.rs`; a test compares the two files.
 */
export const VOICE_CLAIM_ACTIVE = "phoenix-voice:active";
export const VOICE_CLAIM_IDLE = "phoenix-voice:idle";

/** Where the claim is written. A seam: tests pass a fake document. */
export interface TitleTarget {
  title: string;
}

/**
 * Says "active" from the moment the page starts (BEFORE it asks for the microphone, so it can only
 * over-report) until the assistant is back to idle (the microphone released).
 */
export function claimListening(active: boolean, target: TitleTarget = document): void {
  target.title = active ? VOICE_CLAIM_ACTIVE : VOICE_CLAIM_IDLE;
}

/** True in the desktop shell's webview (Tauri injects the global); false in an ordinary browser. */
export function insideDesktopShell(win: Window = window): boolean {
  return "__TAURI__" in win || "__TAURI_INTERNALS__" in win;
}
