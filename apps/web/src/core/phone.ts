// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the phone-link routes (see core/api for the protocol) and the pure helpers the
// Settings section uses. Nothing here touches the network, the clock or storage.

import { useEffect, useState } from "react";

/** GET /api/phone/status, and what POST /api/phone/settings answers. */
export interface PhoneStatus {
  enabled: boolean;
  listening: boolean;
  address: string | null;
  port: number | null;
  addresses: string[];
  /** Uppercase hex pairs separated by ":". */
  fingerprint: string | null;
  require_user_verification: boolean;
  kill_switch: boolean;
  pairing: { expires_at: string } | null;
  pending_pair: PhonePendingPair | null;
  locked_out_until: string | null;
  /** Why an enabled link is not listening, when Core knows: the chosen address is gone. */
  off_reason: "address_changed" | null;
  devices: number;
}

export interface PhonePendingPair {
  /** Chosen by the phone: untrusted text. */
  name: string;
  key_fingerprint: string;
  requested_at: string;
  expires_at: string;
  confirmation_id: string | null;
}

/** POST /api/phone/pairing. The code is shown once and lives only in component state. */
export interface PhonePairingCode {
  code: string;
  expires_at: string;
  fingerprint: string;
  address: string;
  port: number;
  uri: string;
}

export interface PhoneDevice {
  id: string;
  /** Chosen by the phone: untrusted text. */
  name: string;
  key_fingerprint: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

/** How often the status is re-read while a pairing code or a pairing request is open. */
export const PHONE_POLL_MS = 2_000;

const MAX_NAME = 64;

/**
 * A phone's self-chosen name made safe to show next to a yes/no question: control, line-break and
 * bidirectional/format characters (which can reorder or hide text) are removed, runs of whitespace
 * collapse, and the length is capped. Ordinary letters of any script are kept.
 */
export function safeDeviceName(name: string): string {
  const clean = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const chars = Array.from(clean);
  return chars.length > MAX_NAME ? `${chars.slice(0, MAX_NAME).join("")}…` : clean;
}

/** "ABCD-EFGH-JKLM": letters and digits only, upper case, in groups of four. */
export function groupCode(code: string): string {
  const flat = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (flat.match(/.{1,4}/g) ?? []).join("-");
}

/** "AB:CD:EF": upper-case hex pairs separated by ":", whatever separators Core used. */
export function groupFingerprint(fingerprint: string): string {
  const flat = fingerprint.toUpperCase().replace(/[^0-9A-F]/g, "");
  return (flat.match(/.{1,2}/g) ?? []).join(":");
}

/** "192.168.1.5:4443", or "[fe80::1]:4443" for an IPv6 address. */
export function hostPort(address: string, port: number | null): string {
  const host = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
  return port === null ? host : `${host}:${port}`;
}

/** Wall-clock now, re-read every second while `active`. */
export function usePhoneNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
