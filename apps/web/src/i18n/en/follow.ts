// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings > Fawkes: the floating Fawkes follows the mouse pointer (Phase 59, desktop app only). */
export const follow = {
  "follow.label": "Let the floating Fawkes follow my mouse pointer (desktop app only)",
  "follow.hint":
    "Off by default. Only the floating Fawkes in the desktop app moves; it flies home when something needs you and stays still while it is hidden, in quiet mode or quiet hours, during the emergency stop and in the demo. With reduced motion it jumps instead of gliding. Not available in a browser.",
} as const;
