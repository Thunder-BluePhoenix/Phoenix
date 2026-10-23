// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings screens for scheduled keep-awake (Phase 90) and status lights (Phase 88). */
export const awakeSchedule = {
  "awakeSchedule.loading": "Loading…",

  "awakeSchedule.schedule.title": "Scheduled keep-awake",
  "awakeSchedule.schedule.notAvailable":
    "Scheduled keep-awake is not available: this Phoenix Core has no OS secret store.",
  "awakeSchedule.schedule.loadFailed": "Scheduled keep-awake could not be loaded.",
  "awakeSchedule.schedule.intro":
    "Off by default. Turning it on and saving a window each ask you first in Approvals; while it is on, this computer stays awake during the windows you saved.",
  "awakeSchedule.schedule.awakeOff":
    "The Keep awake capability is not enabled, so no window can hold this computer awake. Enable it in Integrations.",
  "awakeSchedule.schedule.enable": "Keep this computer awake during my saved windows",
  "awakeSchedule.schedule.confirming": "Waiting for you to confirm in Approvals…",

  "awakeSchedule.state.off": "Scheduled keep-awake is off.",
  "awakeSchedule.state.idle": "Scheduled keep-awake is on. No window is running right now.",
  "awakeSchedule.state.holding": "Holding this computer awake now.",
  "awakeSchedule.state.holdingUntil": "Holding this computer awake until {time}.",
  "awakeSchedule.state.waiting": "A window is waiting to start because {reason}",

  "awakeSchedule.waiting.needs_charger": "this computer is not plugged in.",
  "awakeSchedule.waiting.battery_low": "the battery is below your minimum.",
  "awakeSchedule.waiting.low_power_mode": "Low Power Mode is on.",
  "awakeSchedule.waiting.power_unknown": "the power state could not be read.",
  "awakeSchedule.waiting.busy": "another keep-awake session is already running.",
  "awakeSchedule.waiting.battery_floor": "the battery is too low to keep holding.",
  "awakeSchedule.waiting.start_failed": "keep-awake could not start.",
  "awakeSchedule.waiting.unknown": "of a reason this version does not recognise.",

  "awakeSchedule.cancel.button": "Cancel the current window",

  "awakeSchedule.list.title": "Saved windows",
  "awakeSchedule.list.empty": "No windows saved.",
  "awakeSchedule.list.line": "{when}, {start}–{end} ({zone})",
  "awakeSchedule.list.remove": "Remove",
  "awakeSchedule.list.removeNamed": "Remove {name}",

  "awakeSchedule.upcoming.title": "Next windows",
  "awakeSchedule.upcoming.empty": "No upcoming windows.",
  "awakeSchedule.upcoming.line": "{name}: {from} to {to}",
  "awakeSchedule.upcoming.skipped": "Skipped",
  "awakeSchedule.upcoming.skip": "Skip",
  "awakeSchedule.upcoming.unskip": "Unskip",
  "awakeSchedule.upcoming.skipNamed": "Skip {name} at {time}",
  "awakeSchedule.upcoming.unskipNamed": "Unskip {name} at {time}",

  "awakeSchedule.add.title": "Add a window",
  "awakeSchedule.add.id": "Name (lowercase letters, digits, dashes)",
  "awakeSchedule.add.label": "Label (optional)",
  "awakeSchedule.add.zone": "Time zone",
  "awakeSchedule.add.start": "Start",
  "awakeSchedule.add.end": "End",
  "awakeSchedule.add.days": "Repeats on",
  "awakeSchedule.add.charger": "Only while plugged in",
  "awakeSchedule.add.minBattery": "Minimum battery (%)",
  "awakeSchedule.add.submit": "Save window",

  "awakeSchedule.lights.title": "Status lights",
  "awakeSchedule.lights.notAvailable":
    "Status lights are not available: this Phoenix Core has no OS secret store.",
  "awakeSchedule.lights.loadFailed": "Status lights could not be loaded.",
  "awakeSchedule.lights.intro":
    "Fawkes can show what it is doing on a light on your own network. A light is contacted only when you added it here, allowed Fawkes to light it, and the Status lights capability is enabled.",
  "awakeSchedule.lights.limits":
    "Only fixed colours are sent, never any text. Only the Elgato Key Light and LIFX are supported so far; a LIFX light is added through the Core API with its serial.",
  "awakeSchedule.lights.capabilityOff":
    "The Status lights capability is not enabled. Enable it here or in Integrations.",
  "awakeSchedule.lights.enable": "Enable",
  "awakeSchedule.lights.empty": "No lights added.",
  "awakeSchedule.lights.line": "Key Light at {address}",
  "awakeSchedule.lights.lineLifx": "LIFX light at {address}",
  "awakeSchedule.lights.allow": "Allow Fawkes to light this",
  "awakeSchedule.lights.allowNamed": "Allow Fawkes to light {name}",
  "awakeSchedule.lights.remove": "Remove",
  "awakeSchedule.lights.removeNamed": "Remove {name}",
  "awakeSchedule.lights.add.title": "Add a Key Light",
  "awakeSchedule.lights.add.id": "Name",
  "awakeSchedule.lights.add.address": "Address on your network (for example 192.168.1.20)",
  "awakeSchedule.lights.add.submit": "Add light",
} as const;
