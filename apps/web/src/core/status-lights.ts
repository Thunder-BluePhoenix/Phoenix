// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Status lights (Phase 88), web side, for Hue pairing, Luxafor, LIFX discovery and quiet hours.
// Everything a bridge, a light or Core reports is checked before it is shown. Text that a device
// supplied (a name, an id) is cleaned of control and bidirectional characters and is only ever
// rendered as text. No credential is read, held or shown here: a Hue application key and a Luxafor
// token live in Core's credential store, and the only credential this code ever touches is the
// token the owner is typing, which the caller clears as soon as it has been sent.
import { useCallback, useRef, useState } from "react";
import type { MessageKey } from "../i18n";
import { ApiError } from "./client";
import { useClient } from "./context";

export const HUE_BRIDGES_PATH = "/api/status-lights/hue/bridges";
export const HUE_INSPECT_PATH = "/api/status-lights/hue/inspect";
export const LIFX_DISCOVER_PATH = "/api/status-lights/lifx/discover";
export const luxaforTokenPath = (id: string) =>
  `/api/status-lights/luxafor/${encodeURIComponent(id)}/token`;
export const hueBridgeLightsPath = (id: string) =>
  `${HUE_BRIDGES_PATH}/${encodeURIComponent(id)}/lights`;
export const hueBridgePath = (id: string) => `${HUE_BRIDGES_PATH}/${encodeURIComponent(id)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Control, line-break and invisible format (bidi, zero-width) characters: they can reorder or hide
// the text around them, so they never reach the screen.
const HIDDEN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
const MAX_SHOWN = 64;

/** Device-supplied text for display: hidden characters removed, length bounded. Rendered as text only. */
export function deviceText(value: string): string {
  const clean = value.replace(HIDDEN, "");
  const chars = [...clean];
  return chars.length > MAX_SHOWN ? `${chars.slice(0, MAX_SHOWN).join("")}…` : clean;
}

const FINGERPRINT = /^[0-9a-f]{64}$/;
const HUE_RESOURCE = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAC = /^[0-9a-f]{12}$/;
const ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A 64-digit fingerprint as colon-separated upper-case byte pairs, the way a certificate viewer shows it. */
export function formatFingerprint(hex: string): string {
  return (hex.toUpperCase().match(/.{2}/g) ?? []).join(":");
}

function validPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65_536;
}

function readAll<T>(raw: unknown, one: (item: unknown) => T | null): T[] {
  const out: T[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const read = one(item);
    if (read !== null) out.push(read);
  }
  return out;
}

// ── Hue ──────────────────────────────────────────────────────────────────────

export interface HueBridge {
  id: string;
  address: string;
  port: number;
  /** 64 lower-case hex digits. */
  fingerprint: string;
}

function readBridge(raw: unknown): HueBridge | null {
  if (!isRecord(raw)) return null;
  const { id, address, port, fingerprint } = raw;
  if (typeof id !== "string" || !ID.test(id) || typeof address !== "string") return null;
  if (!validPort(port) || typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint))
    return null;
  return { id, address, port, fingerprint };
}

/** GET /api/status-lights/hue/bridges. Only the four known fields are kept; nothing else is read. */
export function readBridges(raw: unknown): HueBridge[] | null {
  return isRecord(raw) && Array.isArray(raw.bridges) ? readAll(raw.bridges, readBridge) : null;
}

export interface HueInspection {
  address: string;
  port: number;
  fingerprint: string;
  commonName: string | null;
}

/** POST /api/status-lights/hue/inspect, or null if the answer is not a usable fingerprint. */
export function readInspection(raw: unknown): HueInspection | null {
  if (!isRecord(raw)) return null;
  const { address, port, fingerprint, common_name } = raw;
  if (typeof address !== "string" || !validPort(port)) return null;
  if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) return null;
  return {
    address,
    port,
    fingerprint,
    commonName: typeof common_name === "string" ? common_name : null,
  };
}

export interface HueBridgeLight {
  id: string;
  name: string;
}

/** GET /api/status-lights/hue/bridges/:id/lights. The names are the bridge's own text. */
export function readBridgeLights(raw: unknown): HueBridgeLight[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.lights)) return null;
  return readAll(raw.lights, (item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !HUE_RESOURCE.test(item.id)) return null;
    return { id: item.id.toLowerCase(), name: typeof item.name === "string" ? item.name : "" };
  });
}

// ── LIFX ─────────────────────────────────────────────────────────────────────

export interface LifxFound {
  mac: string;
  address: string;
  port: number;
  provisioned: boolean;
}

/** POST /api/status-lights/lifx/discover. */
export function readLifxFound(raw: unknown): LifxFound[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.lights)) return null;
  return readAll(raw.lights, (item) => {
    if (!isRecord(item)) return null;
    const { mac, address, port, provisioned } = item;
    if (typeof mac !== "string" || !MAC.test(mac) || typeof address !== "string") return null;
    if (!validPort(port)) return null;
    return { mac, address, port, provisioned: provisioned === true };
  });
}

// ── Quiet hours ──────────────────────────────────────────────────────────────

export interface QuietHours {
  timezone: string;
  start: string;
  end: string;
}

/** The capability's stored `quiet_hours`, or null when unset or not shaped like one. */
export function readQuietHours(config: Record<string, unknown> | undefined): QuietHours | null {
  const raw = config?.quiet_hours;
  if (!isRecord(raw)) return null;
  const { timezone, start, end } = raw;
  return typeof timezone === "string" &&
    typeof start === "string" &&
    typeof end === "string" &&
    TIME.test(start) &&
    TIME.test(end)
    ? { timezone, start, end }
    : null;
}

/** Core's schema allows a 1 to 64 character zone and HH:MM times; the zone must also be a real one. */
export function validQuietHours(hours: QuietHours): boolean {
  if (!TIME.test(hours.start) || !TIME.test(hours.end)) return false;
  if (hours.timezone.length < 1 || hours.timezone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: hours.timezone });
    return true;
  } catch {
    return false;
  }
}

// ── Actions with fixed error texts ───────────────────────────────────────────

/** A translated message key. An error is never Core's or a device's own text. */
export type LightErrorKey = Extract<MessageKey, `statusLights.error.${string}`>;

/**
 * Runs one Core request. On failure the caller's own message key is kept, except that "no OS
 * credential store" has its own fixed message. Core's error text is dropped, because it can quote
 * an id the owner or a device chose.
 */
export function useLightAction() {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LightErrorKey | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      body: unknown,
      failKey: LightErrorKey,
    ): Promise<T | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        return await client.request<T>(method, path, method === "GET" ? undefined : body);
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === "CAPABILITY_UNAVAILABLE"
            ? "statusLights.error.unavailable"
            : failKey,
        );
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client],
  );
  const fail = useCallback((key: LightErrorKey) => setError(key), []);
  return { run, busy, error, fail };
}

export interface LightAction {
  run<T = unknown>(
    method: string,
    path: string,
    body: unknown,
    failKey: LightErrorKey,
  ): Promise<T | undefined>;
  busy: boolean;
  error: LightErrorKey | null;
  fail(key: LightErrorKey): void;
}
