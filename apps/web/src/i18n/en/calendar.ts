// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export const calendar = {
  "calendar.title": "Meeting prep",
  "calendar.disabled":
    "Calendar awareness is off. Enable the calendar capability to see upcoming meetings.",
  "calendar.empty": "No upcoming meetings.",
  "calendar.loading": "Reading upcoming meetings…",
  "calendar.error": "The calendar could not be read.",
  "calendar.refresh": "Refresh meetings",
  "calendar.prep": "Preparation",
  "calendar.decisions": "Earlier decisions",
  "calendar.actions": "Open action items",
  "calendar.noPrep": "No relevant reviewed decisions or open action items.",
  "calendar.notetaker": "Start notetaker",
  "calendar.notetakerInfo":
    "Recording starts only after you choose to start it and grant permission.",
  "calendar.freeze": "Deployment freeze",
  "calendar.busy": "Private event",
  "calendar.source": "From {meeting}",
  "calendar.unconfigured":
    "No calendar provider is connected. Connect Google, Microsoft, or CalDAV to see meetings.",
  "calendar.unavailable":
    "The calendar feed is unavailable. Upcoming meetings and deployment freezes cannot be shown.",
  "calendar.stale":
    "The calendar feed is out of date. Upcoming meetings and deployment freezes cannot be trusted until it is refreshed.",
  "calendar.lastChecked": "Last successful read: {time}",
  "calendar.prepIncomplete": "Preparation is incomplete for some meetings.",
} as const;
