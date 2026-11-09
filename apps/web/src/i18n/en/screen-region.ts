// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the screen-region capture that feeds the screenshot-to-issue tool. */
export const screenRegion = {
  "screenRegion.title": "Capture a region for an issue",
  "screenRegion.intro":
    "Pick Choose screen region, confirm in Approvals, then drag the area you want with the system selector (Esc cancels). Only macOS is supported. The image stays on this page and is not saved. The issue itself is created as text only, after you approve it. For Linear and Jira you can then choose to attach the redacted image to that issue in a separate step with its own confirmation; GitHub is text only.",
  "screenRegion.projectLabel": "GitHub repository (owner/name), Linear team ID or Jira project key",
  "screenRegion.linearTeamInvalid":
    "A Linear team ID looks like 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; nothing was sent.",
  "screenRegion.jiraProjectInvalid":
    "A Jira project key is capital letters, digits or underscores, such as PROJ; nothing was sent.",
  "screenRegion.issuesUnavailable":
    "The Issue trackers capability is off or lacks the create and attach commands, so nothing was sent. Enable it first.",
  "screenRegion.issuesNoWriteCredential":
    "No write credential for {tracker} is set in Issue trackers (the polling keys are never used for writing), so nothing was sent.",
  "screenRegion.issueKeyInvalid": "That is not a valid issue key; nothing was sent.",
  "focus.screenshot.textOnly":
    "The issue is created with text only. The screenshot is not part of it; for Linear and Jira you can offer it separately afterwards.",
  "focus.screenshot.attach.title": "Attach the screenshot (optional)",
  "focus.screenshot.attach.intro":
    "{tracker} issue {key} was created without the image. You can attach the redacted screenshot to it now. This is a separate upload that Core asks you to approve again. GitHub never gets the image.",
  "focus.screenshot.attach.prepare": "Show what would be attached",
  "focus.screenshot.attach.details": "What would be attached",
  "focus.screenshot.attach.tracker": "Tracker: {tracker}",
  "focus.screenshot.attach.issue": "Issue: {key}",
  "focus.screenshot.attach.file": "File name: {name}",
  "focus.screenshot.attach.size": "Size: {bytes} bytes",
  "focus.screenshot.attach.hash": "Content hash (SHA-256, first 12 characters): {hash}",
  "focus.screenshot.attach.redacted":
    "This is the image as redacted and annotated on this page; the redactions are already burned in. Nothing has been sent yet.",
  "focus.screenshot.attach.confirm": "Yes, upload this image to {tracker}",
  "focus.screenshot.attach.send": "Request approval and attach",
  "focus.screenshot.attach.done": "The screenshot was attached to {key}.",
  "focus.screenshot.attach.problem.badImage": "The image is not a valid PNG and was not sent.",
  "focus.screenshot.attach.problem.tooLarge": "The image is larger than 5 MiB and was not sent.",
  "focus.screenshot.attach.problem.changed":
    "The image changed after you reviewed it; review it again. Nothing was sent.",
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
} as const;
