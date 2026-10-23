// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { ReminderStore } from "@phoenix/capability-calendar";
import type { SettingsStore } from "@phoenix/persistence";

/**
 * Settings key holding the calendar's reminder de-dup records: `{ version: 1, sent: [{ key, start }] }`
 * where `key` is an opaque digest of the occurrence id and start time. No title, attendee or link.
 */
export const CALENDAR_REMINDERS_KEY = "calendar.reminders.sent";

/**
 * The calendar capability has no database of its own; Core lends it one settings key so a restart
 * inside the five-minute reminder window does not remind again. The capability validates what it
 * reads (a corrupt value, including unparseable JSON, is ignored) and bounds what it writes. The
 * settings are resolved on each call because the capabilities are built before the runtime exists.
 */
export function settingsReminderStore(settings: () => SettingsStore): ReminderStore {
  return {
    read: () => settings().get<unknown>(CALENDAR_REMINDERS_KEY, null),
    write: (value) => settings().set(CALENDAR_REMINDERS_KEY, value),
  };
}
