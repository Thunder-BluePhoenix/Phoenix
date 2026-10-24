// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one-time safety acknowledgement (Phase 73): before the first lid-closed session the user
// confirms they know a closed laptop that stays awake can overheat (bag, case, no ventilation).
// It is a small JSON file in the Core data dir (0600). The warning text lives in the web UI's
// i18n (power.recovery.*); `SAFETY_VERSION` ties an acknowledgement to a wording: bump it when the
// warning changes materially and everyone is asked again.
import { createHash } from "node:crypto";
import type { JournalFs } from "./journal";

export const SAFETY_VERSION = 1;
export const SAFETY_FILE = "safety.json";

/**
 * The canonical wording the acknowledgement is bound to (the UI shows a translation of it). The
 * command carries its SHA-256, so an acknowledgement is a statement about THIS text: changing the
 * wording changes the hash and everybody is asked again (bump SAFETY_VERSION with it).
 *
 * [Command contexts carry no actor, so Core's approval prompt cannot tell a person from an agent;
 * the prompt text (the command description) and this hash are what distinguish the acknowledgement.]
 */
export const SAFETY_TEXT =
  "A closed laptop that stays awake can overheat. Never carry it in a bag, case or any closed space while lid-closed mode is on, and keep the vents clear.";

export const SAFETY_TEXT_SHA256 = createHash("sha256").update(SAFETY_TEXT).digest("hex");

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
