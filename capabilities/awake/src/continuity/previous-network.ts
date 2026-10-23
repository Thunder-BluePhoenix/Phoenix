// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The previous Wi-Fi network, kept across a Core restart so "rejoin my previous network" still works.
//
// Why not the Phase 73 recovery journal: that journal is for changes that must be undone (strict
// checksum, owner, pid and a 1 MB budget shared with the privileged undo entries). A Wi-Fi name is
// a convenience, not an undo, and it must never fill that budget or keep the quit veto on. So the
// record lives in its own small file next to the journal (`<data dir>/awake/previous-network.json`)
// and is written through the journal's own file seam (`JournalFs`): the directory 0700, the file
// 0600, replaced atomically (temp file, fsync, rename), so a crash leaves the old file or the new
// one, never half of one.
//
// What is stored: the SSID, the Wi-Fi device (`enN`) and when it was recorded. Never a password,
// a BSSID or a location. Any other key in the file makes the whole file untrusted.
// On load the same rules as joining apply (`isValidSsid`, `isWifiDevice`); a file that is oversized,
// not JSON, has other keys, has a bad field, is dated in the future or is older than
// PREVIOUS_NETWORK_TTL_MS is ignored AND deleted, so a stale or hostile record never rejoins
// anything. A write that fails is reported with a fixed code (never the SSID) and the record then
// lives in memory only, which is what it was before this file existed.
import { dirname } from "node:path";
import { isRecord } from "../guards";
import type { JournalFs } from "../power/journal";
import { isValidSsid, isWifiDevice } from "./config";
import type { PreviousNetwork, PreviousNetworkStore } from "./hotspot";

/** A remembered network older than this is forgotten: the user has moved on. */
export const PREVIOUS_NETWORK_TTL_MS = 24 * 60 * 60_000;
/** A record is about 80 bytes; anything bigger is not ours. */
export const MAX_PREVIOUS_NETWORK_BYTES = 1024;
/** A record dated further ahead than this is not believable (clock jump or a forged file). */
const FUTURE_SKEW_MS = 60_000;
export const PREVIOUS_NETWORK_FILE = "previous-network.json";
const VERSION = 1;
const KEYS = "at,device,ssid,v";

export interface FilePreviousNetworkOptions {
  /** The record's file; its directory is created private. */
  path: string;
  fs: JournalFs;
  now: () => number;
  /** Told, with a fixed reason code, when the file cannot be written or removed. */
  onError?: (reason: "write_failed" | "remove_failed") => void;
}

/** The record as stored, or undefined when it is not exactly a valid, current record. */
function decode(text: string, now: number): PreviousNetwork | undefined {
  if (text.length > MAX_PREVIOUS_NETWORK_BYTES) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || Object.keys(parsed).sort().join(",") !== KEYS) return undefined;
  const { v, ssid, device, at } = parsed;
  if (v !== VERSION || !isValidSsid(ssid) || !isWifiDevice(device)) return undefined;
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) return undefined;
  if (at > now + FUTURE_SKEW_MS || now - at >= PREVIOUS_NETWORK_TTL_MS) return undefined;
  return { ssid, device, at };
}

export function createFilePreviousNetwork(
  options: FilePreviousNetworkOptions,
): PreviousNetworkStore {
  const { path, fs, now, onError } = options;
  let loaded = false;
  let current: PreviousNetwork | null = null;

  function remove(): void {
    try {
      fs.remove(path);
    } catch {
      onError?.("remove_failed");
    }
  }

  function load(): void {
    loaded = true;
    let text: string | undefined;
    try {
      // An oversized file is never read into memory: it is not ours.
      if (fs.size(path) > MAX_PREVIOUS_NETWORK_BYTES) {
        remove();
        return;
      }
      text = fs.read(path);
    } catch {
      return; // unreadable: no record, and nothing is deleted that could not be read
    }
    if (text === undefined) return;
    const record = decode(text, now());
    if (record === undefined) remove();
    else current = record;
  }

  return {
    get() {
      if (!loaded) load();
      if (current !== null && now() - current.at >= PREVIOUS_NETWORK_TTL_MS) {
        current = null;
        remove();
      }
      return current;
    },
    set(value) {
      loaded = true;
      // Nothing to rejoin without a network name: "not associated" is not kept.
      if (value.ssid === null || !isValidSsid(value.ssid) || !isWifiDevice(value.device)) {
        current = null;
        remove();
        return;
      }
      current = { ssid: value.ssid, device: value.device, at: value.at };
      try {
        fs.mkdirPrivate(dirname(path));
        fs.replace(
          path,
          JSON.stringify({ v: VERSION, ssid: value.ssid, device: value.device, at: value.at }),
        );
      } catch {
        onError?.("write_failed");
      }
    },
    clear() {
      loaded = true;
      current = null;
      remove();
    },
  };
}
