// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 91: the rebirth celebration and its two switches, as every Fawkes view sees them. The
// celebration arrives as a live `fawkes.celebration` event from Core (a kind and a delivery number,
// nothing else); the switches are read from Core and re-read whenever they change.
import { useCallback, useEffect, useState } from "react";
import type { FawkesCelebration } from "../components/FawkesRebirth";
import { ApiError } from "./client";
import { useClient } from "./context";

export const REBIRTH_PATH = "/api/fawkes/rebirth";
export const CELEBRATION_EVENT = "fawkes.celebration";
export const REBIRTH_SETTINGS_EVENT = "fawkes.rebirth.changed";

export interface RebirthSettings {
  milestones: boolean;
  highContrast: boolean;
}

const OFF: RebirthSettings = { milestones: false, highContrast: false };
const KINDS = ["rebirth", "first-green-week", "pr-streak"] as const;

/** Tells every hook on this page that the user just saved the switches (another window reloads on connect). */
const changed = new EventTarget();
export const announceRebirthSettings = () => changed.dispatchEvent(new Event("change"));

function isKind(value: unknown): value is FawkesCelebration["kind"] {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

/** A celebration from an untrusted payload: only a known kind and a safe integer are accepted. */
export function celebrationFrom(payload: unknown): FawkesCelebration | null {
  if (payload === null || typeof payload !== "object") return null;
  const { kind, id } = payload as Record<string, unknown>;
  return isKind(kind) && typeof id === "number" && Number.isSafeInteger(id) ? { kind, id } : null;
}

/** The switches saved in Core; both off while Core is unreachable or has no such route. */
export function useRebirthSettings() {
  const client = useClient();
  const [data, setData] = useState<RebirthSettings>(OFF);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const saved = await client.request<Partial<RebirthSettings>>("GET", REBIRTH_PATH);
      setData({ milestones: saved.milestones === true, highContrast: saved.highContrast === true });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    }
  }, [client]);

  useEffect(() => {
    void reload();
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    const on = () => void reload();
    changed.addEventListener("change", on);
    return () => {
      offStatus();
      changed.removeEventListener("change", on);
    };
  }, [client, reload]);

  return { data, error, reload };
}

/** The latest celebration Core pushed to this view (null until one arrives). */
export function useCelebration(): FawkesCelebration | null {
  const client = useClient();
  const [celebration, setCelebration] = useState<FawkesCelebration | null>(null);
  useEffect(
    () =>
      client.eventCreated.on(({ event }) => {
        if (event.event_type !== CELEBRATION_EVENT || event.source !== "core") return;
        const next = celebrationFrom(event.payload);
        if (next) setCelebration(next);
      }),
    [client],
  );
  return celebration;
}
