// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export const recapNotice = {
  "recapNotice.title": "Weekly recap notice",
  "recapNotice.intro":
    "Every Monday at 09:00 local time, show one notice in Phoenix's own notification list with last week's counts. Off by default. It uses fixed text with numbers only (no names, paths or titles), makes no model call and no network request, and is skipped during Proactive quiet hours, in notification quiet mode and during an emergency stop. At most one per week; if Phoenix was not running on Monday it is shown once later that week.",
  "recapNotice.enable": "Show a weekly recap notice on Monday",
  "recapNotice.last": "Last notice for week {week}.",
  "recapNotice.never": "No weekly recap notice has been shown yet.",
  "recapNotice.error": "Could not load or save the weekly recap notice setting.",
  "recapNotice.midweek": "Turning this on mid-week waits for the next Monday.",
} as const;
