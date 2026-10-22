// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export const signals = {
  "signals.title": "Engineering signals",
  "signals.intro":
    "Check advisories, test reliability, duration trends and configuration key drift in repositories you choose. Reading does not change your files.",
  "signals.root": "Repository folder",
  "signals.add": "Watch folder",
  "signals.remove": "Stop watching",
  "signals.refresh": "Check now",
  "signals.empty": "No current signals for watched repositories.",
  "signals.unconfigured": "Choose a repository folder to start watching.",
  "signals.error": "Engineering signals could not be read.",
  "signals.advisory": "Dependency advisory",
  "signals.flaky_test": "Flaky test",
  "signals.duration_trend": "Duration increase",
  "signals.config_drift": "Missing configuration key",
  "signals.optin":
    "Proactive notifications require explicit opt-in and obey quiet hours and the hourly limit.",
  "signals.privacy": "Only configuration key names are compared; values are never shown.",
  "signals.unknown.advisories": "Dependency advisories not evaluated (status unknown, not clean):",
  "signals.unknown.history":
    "Test history and duration trends not evaluated (status unknown, not clean):",
} as const;
