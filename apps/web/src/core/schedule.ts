// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Scheduled keep-awake (Phase 90) and status lights (Phase 88), web side: what Core reports,
// checked before it is shown, and the date and weekday names in the language on screen.
import { useCallback, useEffect, useState } from "react";
import { intlLocale, type ActiveLocale } from "../i18n/supported";
import { ApiError } from "./client";
import { useClient } from "./context";

export const SCHEDULED_AWAKE_PATH = "/api/scheduled-awake";
export const STATUS_LIGHTS_PATH = "/api/status-lights/devices";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// ── Scheduled keep-awake ─────────────────────────────────────────────────────

export type ScheduleState = "off" | "idle" | "holding" | "waiting";
export type ScheduleRecurrence =
  { kind: "weekly"; days: number[] } | { kind: "once"; date: string };

export interface AwakeSchedule {
  id: string;
  label: string | null;
  timeZone: string;
  start: string;
  end: string;
  recurrence: ScheduleRecurrence;
  requireCharger: boolean;
  minBatteryPercent: number | null;
}

export interface UpcomingWindow {
  key: string;
  scheduleId: string;
  startsAt: number;
  endsAt: number;
  skipped: boolean;
}

export interface ScheduledAwake {
  enabled: boolean;
  state: ScheduleState;
  waitingReason: string | null;
  holdEndsAt: number | null;
  schedules: AwakeSchedule[];
  upcoming: UpcomingWindow[];
  awakeAvailable: boolean;
}

const STATES = ["off", "idle", "holding", "waiting"] as const;

function isState(value: unknown): value is ScheduleState {
  return STATES.some((state) => state === value);
}

function readRecurrence(raw: unknown): ScheduleRecurrence | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "once" && typeof raw.date === "string") return { kind: "once", date: raw.date };
  if (raw.kind === "weekly" && Array.isArray(raw.days)) {
    const days = raw.days.filter(
      (day): day is number =>
        typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
    );
    return { kind: "weekly", days };
  }
  return null;
}

function readSchedule(raw: unknown): AwakeSchedule | null {
  if (!isRecord(raw)) return null;
  const { id, label, timeZone, start, end, power } = raw;
  const recurrence = readRecurrence(raw.recurrence);
  if (
    typeof id !== "string" ||
    typeof timeZone !== "string" ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    recurrence === null
  )
    return null;
  const rules = isRecord(power) ? power : {};
  return {
    id,
    label: typeof label === "string" && label !== "" ? label : null,
    timeZone,
    start,
    end,
    recurrence,
    requireCharger: rules.requireCharger === true,
    minBatteryPercent: typeof rules.minBatteryPercent === "number" ? rules.minBatteryPercent : null,
  };
}

function readUpcoming(raw: unknown): UpcomingWindow | null {
  if (!isRecord(raw)) return null;
  const { key, scheduleId, startsAt, endsAt, skipped } = raw;
  if (
    typeof key !== "string" ||
    typeof scheduleId !== "string" ||
    typeof startsAt !== "number" ||
    typeof endsAt !== "number"
  )
    return null;
  return { key, scheduleId, startsAt, endsAt, skipped: skipped === true };
}

const readAll = <T>(raw: unknown, one: (item: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(one).filter((item): item is T => item !== null) : [];

/** GET /api/scheduled-awake, or null if the answer is not shaped like one. */
export function readScheduledAwake(raw: unknown): ScheduledAwake | null {
  if (!isRecord(raw)) return null;
  const { state, enabled } = raw;
  if (!isState(state) || typeof enabled !== "boolean") return null;
  return {
    enabled,
    state,
    waitingReason: typeof raw.waitingReason === "string" ? raw.waitingReason : null,
    holdEndsAt: typeof raw.holdEndsAt === "number" ? raw.holdEndsAt : null,
    schedules: readAll(raw.schedules, readSchedule),
    upcoming: readAll(raw.upcoming, readUpcoming),
    awakeAvailable: raw.awakeAvailable === true,
  };
}

// ── Status lights ────────────────────────────────────────────────────────────

export type ProvisionedLight = {
  id: string;
  address: string;
  port: number | null;
} & ({ kind: "key-light" } | { kind: "lifx"; mac: string });

function readLight(raw: unknown): ProvisionedLight | null {
  if (!isRecord(raw)) return null;
  const { id, kind, address, port, mac } = raw;
  if (typeof id !== "string" || typeof address !== "string") return null;
  const base = { id, address, port: typeof port === "number" ? port : null };
  if (kind === "key-light") return { ...base, kind };
  if (kind === "lifx" && typeof mac === "string") return { ...base, kind, mac };
  return null;
}

/** GET/PUT /api/status-lights/devices, or null if the answer is not shaped like one. */
export function readLights(raw: unknown): ProvisionedLight[] | null {
  return isRecord(raw) && Array.isArray(raw.lights) ? readAll(raw.lights, readLight) : null;
}

/** A light as the PUT body spells it: the port only when Core reported one, the serial for LIFX. */
export const lightBody = (light: ProvisionedLight) => ({
  id: light.id,
  kind: light.kind,
  address: light.address,
  ...(light.port === null ? {} : { port: light.port }),
  ...(light.kind === "lifx" ? { mac: light.mac } : {}),
});

/** The ids the status-lights capability's `devices` setting allows, from its stored config. */
export function consentedIds(config: Record<string, unknown> | undefined): string[] {
  const devices = config?.devices;
  return Array.isArray(devices) ? devices.filter((id): id is string => typeof id === "string") : [];
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** `absent` is a 404: this Core does not have the feature (it needs the OS secret store). */
export type ResourceStatus = "loading" | "ready" | "absent" | "failed";

/** A Core resource read on mount and whenever Core comes back online; `apply` takes a newer answer. */
export function useCoreResource<T>(path: string, read: (raw: unknown) => T | null) {
  const client = useClient();
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ResourceStatus>("loading");

  const apply = useCallback(
    (raw: unknown) => {
      const next = read(raw);
      if (next === null) {
        setStatus("failed");
        return;
      }
      setData(next);
      setStatus("ready");
    },
    [read],
  );

  const reload = useCallback(async () => {
    try {
      apply(await client.request<unknown>("GET", path));
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 404 ? "absent" : "failed");
    }
  }, [client, path, apply]);

  useEffect(() => {
    void reload();
    return client.statusChanged.on((s) => s === "online" && void reload());
  }, [client, reload]);

  return { data, status, apply, reload };
}

// ── Names and times in the language on screen ────────────────────────────────

/** "Oct 9, 2026, 2:03 PM" for an epoch-ms instant, in the viewer's own time zone. */
export function formatMoment(ms: number, locale: ActiveLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

/** "Mon" for day 1 (0 = Sunday), in the language on screen. */
export function weekdayName(day: number, locale: ActiveLocale): string {
  // 4 January 2026 is a Sunday.
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 4 + day)),
  );
}

/** "Oct 9, 2026" for "2026-10-09"; anything else is returned as it came. */
export function formatCalendarDate(date: string, locale: ActiveLocale): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return date;
  const at = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(at);
}
