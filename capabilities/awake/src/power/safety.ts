// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one-time safety acknowledgement (Phase 73): before the first lid-closed session the user
// confirms they know a closed laptop that stays awake can overheat (bag, case, no ventilation).
// It is a small JSON file in the Core data dir (0600). The warning text lives in the web UI's
// i18n (power.recovery.*); `SAFETY_VERSION` ties an acknowledgement to a wording: bump it when the
// warning changes materially and everyone is asked again.
import type { JournalFs } from "./journal";

export const SAFETY_VERSION = 1;

export interface SafetyAck {
  acknowledged: boolean;
  version: number;
  acknowledged_at: string | null;
}

/** The stored acknowledgement; anything unreadable, or for another wording, is "not acknowledged". */
export function readSafety(fs: JournalFs, path: string): SafetyAck {
  const none: SafetyAck = { acknowledged: false, version: SAFETY_VERSION, acknowledged_at: null };
  try {
    const parsed: unknown = JSON.parse(fs.read(path) ?? "null");
    if (parsed === null || typeof parsed !== "object") return none;
    const version: unknown = Reflect.get(parsed, "version");
    const at: unknown = Reflect.get(parsed, "acknowledged_at");
    if (version !== SAFETY_VERSION || typeof at !== "string" || Number.isNaN(Date.parse(at)))
      return none;
    return { acknowledged: true, version: SAFETY_VERSION, acknowledged_at: at };
  } catch {
    return none;
  }
}

/** Persists the acknowledgement. Throws if it cannot be stored (then it is not acknowledged). */
export function writeSafety(fs: JournalFs, path: string, dir: string, nowIso: string): void {
  fs.mkdirPrivate(dir);
  fs.replace(path, JSON.stringify({ version: SAFETY_VERSION, acknowledged_at: nowIso }));
}
