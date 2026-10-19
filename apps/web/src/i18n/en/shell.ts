// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** App chrome: the navigation bar, the page shell and the language section of Settings. */
export const shell = {
  "shell.nav.home": "Phoenix home",
  "shell.nav.main": "Main",
  "shell.nav.meetings": "Meetings",
  "shell.nav.provenance": "Provenance",
  "shell.nav.agents": "Agents",
  "shell.nav.workflows": "Workflows",
  "shell.nav.recap": "Recap",
  "shell.nav.settings": "Settings",
  "shell.nav.recording": "Recording",

  "shell.app.skipToContent": "Skip to content",
  "shell.app.tagline": "Phoenix is the platform. Fawkes is the pet.",
  "shell.app.noToken":
    "This page has no session token. Open Phoenix from the address printed by <code>pnpm dev:core</code>.",
  "shell.app.hint": "Click Fawkes in the top bar to see what Phoenix is doing.",

  "shell.language.title": "Language",
  "shell.language.label": "Interface language",
  "shell.language.available":
    "{count, plural, one {# language is available.} other {# languages are available.}}",
  "shell.language.machineNote":
    "Text in languages other than English is machine-translated and has not yet been reviewed by native speakers.",
  "shell.language.saved": "Language changed.",
  "shell.language.failed": "The language could not be saved. Try again.",
} as const;
