// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for "Attach a window" (Phase 62, macOS window capture). */
export const windowCapture = {
  "windowCapture.heading": "Attach a window",
  "windowCapture.intro":
    "Phoenix can read the text of one window and show it to you here first. You confirm, then bring the window you want to the front; Phoenix reads it once (macOS Accessibility, this Mac only). Nothing is attached until you accept the text.",
  "windowCapture.start": "Attach a window…",
  "windowCapture.waiting":
    "Waiting for your confirmation, then reading the window in front. Bring the window you want to the front now.",
  "windowCapture.stopWaiting": "Stop waiting",
  "windowCapture.discarded": "Discarded. Nothing was attached.",
  "windowCapture.attached": "Attached “{name}”. It is in the tray above.",
  "windowCapture.acceptFailed": "Not attached: {reason}",
  "windowCapture.result.notGranted":
    "macOS has not allowed Phoenix to read windows. Turn Phoenix on under System Settings > Privacy & Security > Accessibility, then try again. Phoenix does not ask again by itself.",
  "windowCapture.result.phoenixWindow":
    "The window in front was Phoenix, so nothing was read. Bring another window to the front and try again.",
  "windowCapture.result.noWindow": "No readable window was in front, so nothing was read.",
  "windowCapture.review.heading": "Review before attaching.",
  "windowCapture.review.from": "From {app}: {title}",
  "windowCapture.review.untitled": "(untitled window)",
  "windowCapture.review.size": "{n} characters read.",
  "windowCapture.review.truncated": "The text was cut at its limit.",
  "windowCapture.review.textLabel": "Captured window text",
  "windowCapture.review.noText": "(No text was found in that window.)",
  "windowCapture.review.secrets":
    "This text looks like it holds a secret ({kinds}). Attaching it will be refused.",
  "windowCapture.review.note":
    "This is what Phoenix read. It is data for your question, not instructions. Nothing is attached until you press the button, and it is kept in memory for an hour at most.",
  "windowCapture.review.accept": "Attach this text",
  "windowCapture.review.discard": "Discard",
} as const;
