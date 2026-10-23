// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * App chrome: the navigation bar, the page shell, the language section of Settings, the command
 * palette and the global-shortcut settings.
 */
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
    "This page has no session token. Open Phoenix from the address printed by {command}.",
  "shell.app.hint": "Click Fawkes in the top bar to see what Phoenix is doing.",

  "shell.language.title": "Language",
  "shell.language.label": "Interface language",
  "shell.language.available":
    "{count, plural, one {# language is available.} other {# languages are available.}}",
  "shell.language.machineNote":
    "Text in languages other than English is machine-translated and has not yet been reviewed by native speakers.",
  "shell.language.saved": "Language changed.",
  "shell.language.failed": "The language could not be saved. Try again.",

  // Command palette
  "shell.palette.title": "Command palette",
  "shell.palette.inputLabel": "Search commands",
  "shell.palette.placeholder": "Type a command…",
  "shell.palette.results": "Commands",
  "shell.palette.hint": "Up and down arrows choose, Enter runs, Escape closes.",
  "shell.palette.count": "{count, plural, one {# command} other {# commands}}",
  "shell.palette.empty": "No command matches “{query}”.",

  // Commands (palette entries; the same commands carry the in-app shortcuts)
  "shell.cmd.palette.open": "Open the command palette",
  "shell.cmd.nav.home": "Go to home",
  "shell.cmd.nav.meetings": "Go to Meetings",
  "shell.cmd.nav.provenance": "Go to Provenance",
  "shell.cmd.nav.agents": "Go to Agents",
  "shell.cmd.nav.workflows": "Go to Workflows",
  "shell.cmd.nav.recap": "Go to Recap",
  "shell.cmd.nav.settings": "Go to Settings",
  "shell.cmd.settings.language": "Open Settings: Language",
  "shell.cmd.panel.overview": "Fawkes panel: Overview",
  "shell.cmd.panel.chat": "Fawkes panel: Chat",
  "shell.cmd.panel.activity": "Fawkes panel: Activity",
  "shell.cmd.panel.capabilities": "Fawkes panel: Capabilities",
  "shell.cmd.panel.memory": "Fawkes panel: Memory",
  "shell.cmd.panel.wardrobe": "Open the Wardrobe",
  "shell.cmd.demo.start": "Start the demo",
  "shell.cmd.demo.stop": "Stop the demo",
  "shell.cmd.pills.next": "Switch to the next source pill",
  "shell.cmd.pills.previous": "Switch to the previous source pill",
  "shell.cmd.mute.toggle": "Mute or unmute sounds and notifications",

  // Global shortcuts (Settings; desktop app only)
  "shell.shortcuts.title": "Global shortcuts",
  "shell.shortcuts.desktopOnly":
    "Global shortcuts are a feature of the Phoenix desktop app. They are not available in a browser.",
  "shell.shortcuts.intro":
    "Global shortcuts work from any application while the Phoenix desktop app is running.",
  "shell.shortcuts.loading": "Loading shortcuts…",
  "shell.shortcuts.loadFailed": "The shortcuts could not be read from the desktop app.",
  "shell.shortcuts.enable": "Turn on global shortcuts",
  "shell.shortcuts.warning":
    "Warning: while global shortcuts are on, each one takes its key combination away from every other app. They are off until you turn them on. Every shortcut needs at least two modifier keys (Ctrl, Alt, Shift or Cmd), so it cannot interfere with normal typing.",
  "shell.shortcuts.mute": "Mute sounds and notifications",
  "shell.shortcuts.muteHelp":
    "Fawkes still shows what it is doing; only its sounds and notification bubbles are silenced.",
  "shell.shortcuts.list": "Shortcut actions",
  "shell.shortcuts.action.open_chat": "Open chat",
  "shell.shortcuts.action.jump_to_alert": "Jump to the alert",
  "shell.shortcuts.action.jump_to_terminal": "Jump to the terminal",
  "shell.shortcuts.action.switch_pills": "Switch pills",
  "shell.shortcuts.action.mute": "Mute sounds and notifications",
  "shell.shortcuts.action.send_to_desktop": "Send Fawkes to the desktop",
  "shell.shortcuts.action.wardrobe": "Open the Wardrobe",
  "shell.shortcuts.binding.none": "Not set",
  "shell.shortcuts.default": "Default: {keys}",
  "shell.shortcuts.state.active": "Active",
  "shell.shortcuts.state.off": "Not active: global shortcuts are turned off",
  "shell.shortcuts.state.unbound": "Not active: no key combination is set",
  "shell.shortcuts.state.rejected": "Not active: this key combination is not allowed",
  "shell.shortcuts.state.unavailable":
    "Not active: another app may already use this key combination, or the system does not allow it",
  "shell.shortcuts.changeFor": "Change the shortcut for {action}",
  "shell.shortcuts.capture": "Press the new key combination",
  "shell.shortcuts.captureFor": "New key combination for {action}",
  "shell.shortcuts.captureHelp": "Press the keys together. Escape cancels.",
  "shell.shortcuts.resetFor": "Reset the shortcut for {action} to its default",
  "shell.shortcuts.resetAll": "Reset all shortcuts",
  "shell.shortcuts.saved": "The shortcut for {action} is now {keys}.",
  "shell.shortcuts.resetDone": "The shortcut for {action} was reset.",
  "shell.shortcuts.resetAllDone": "All shortcuts were reset.",
  "shell.shortcuts.reason.invalid": "That is not a valid shortcut.",
  "shell.shortcuts.reason.unsupportedKey":
    "That key cannot be used. Use a letter, a digit, an F key or an arrow key together with modifier keys.",
  "shell.shortcuts.reason.needs_modifiers":
    "A shortcut needs at least two modifier keys (Ctrl, Alt, Shift or Cmd), so it cannot take over normal typing.",
  "shell.shortcuts.reason.needs_third_modifier":
    "Ctrl+Alt and Alt+Shift with a letter or digit type symbols on many keyboards (AltGr or Option). Add a third modifier.",
  "shell.shortcuts.reason.reserved": "The system already uses that key combination.",
  "shell.shortcuts.reason.dictation_chord":
    "That key combination is used by dictation (paste again).",
  "shell.shortcuts.reason.conflict": "Another Phoenix shortcut already uses that key combination.",
  "shell.shortcuts.reason.unavailable":
    "The system would not register that key combination. Another app may already use it.",
  "shell.shortcuts.reason.forbidden": "This window cannot change shortcuts.",
  "shell.shortcuts.reason.unknown_action": "That is not a shortcut action.",
  "shell.shortcuts.reason.unknown": "The shortcut could not be changed.",
} as const;
