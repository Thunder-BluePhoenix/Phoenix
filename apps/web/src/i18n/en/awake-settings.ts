// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings → Keep awake (Phase 72). The session countdown and battery text reuse `power.awake.*`. */
export const awakeSettings = {
  "awakeSettings.title": "Keep awake",
  "awakeSettings.intro":
    "Keep this computer from sleeping for a set time, for example while a build or an agent runs. A session always has an end: from 1 minute to 7 days.",
  "awakeSettings.approval":
    "Starting, extending and ending a session each ask for your approval in Approvals first. Nothing changes until you approve.",
  "awakeSettings.off": "Keep awake is turned off, so no session can start.",
  "awakeSettings.enable": "Turn on Keep awake",

  "awakeSettings.status.title": "Current session",
  "awakeSettings.status.idle": "No session is running. The computer sleeps as usual.",
  "awakeSettings.status.unreadable": "The Keep awake status could not be read.",
  "awakeSettings.status.mode.timed": "(timed)",
  "awakeSettings.status.mode.agents_grace": "(while agents work)",
  "awakeSettings.status.label": "Label: {label}",

  "awakeSettings.end.button": "End session",

  "awakeSettings.start.title": "Start a session",
  "awakeSettings.start.durations": "Duration presets",
  "awakeSettings.start.minutes": "Minutes",
  "awakeSettings.start.label": "Label (optional)",
  "awakeSettings.start.labelInvalid":
    "The label must be 1 to {max} characters, with no control or invisible characters.",
  "awakeSettings.start.submit": "Ask to start",

  "awakeSettings.outcome.waiting": "Waiting for your approval in Approvals…",
  "awakeSettings.outcome.succeeded.start": "Approved: the session has started.",
  "awakeSettings.outcome.succeeded.extend": "Approved: time was added to the session.",
  "awakeSettings.outcome.succeeded.end": "Approved: the session has ended.",
  "awakeSettings.outcome.denied": "You declined, so nothing was changed.",
  "awakeSettings.outcome.blocked": "The emergency stop is on, so nothing was changed.",
  "awakeSettings.outcome.timeout":
    "The request was not approved in time or was cancelled, so nothing was changed.",
  "awakeSettings.outcome.failed": "Keep awake could not do that: {message}",
} as const;
