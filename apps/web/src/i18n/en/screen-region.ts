// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the screen-region capture that feeds the screenshot-to-issue tool. */
export const screenRegion = {
  "screenRegion.title": "Capture a region for an issue",
  "screenRegion.intro":
    "Pick Choose screen region, confirm in Approvals, then drag the area you want with the system selector (Esc cancels). Only macOS is supported. The image stays on this page and is not saved; the issue is created as text only, on GitHub, after you approve it again.",
  "screenRegion.unavailable":
    "Region capture is off. Enable the Screen region capture capability and allow screen capture to use it. It works on macOS only.",
  "screenRegion.cancelled": "You cancelled the selection, so nothing was captured.",
  "screenRegion.declined": "You declined, so nothing was captured.",
  "screenRegion.blocked": "The emergency stop is on, so nothing was captured.",
  "screenRegion.timeout":
    "No region was chosen in time, or the request was not approved; nothing was captured.",
  "screenRegion.failed": "The region could not be captured: {message}",
  "screenRegion.badImage": "The capture was not a valid PNG image and was discarded.",
  "screenRegion.tooLarge": "The captured region is larger than 5 MiB and was discarded.",
  "screenRegion.unsupported": "Region capture is only supported on macOS.",
  "screenRegion.expired": "The capture was no longer available. Choose a region again.",
  "screenRegion.trackerUnsupported":
    "Only GitHub can create an issue from here; Linear and Jira cannot yet, so nothing was sent.",
} as const;
