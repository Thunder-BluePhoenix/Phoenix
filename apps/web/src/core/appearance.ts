// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 61: Fawkes appearance (outfit, user packs, per-source pills) as every Fawkes view sees it.
import {
  defaultSourceStyle,
  resolveOutfit,
  type OutfitPack,
  type SourceStyle,
} from "@phoenix/pet-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "./client";
import { useClient, useTasks } from "./context";
import { useAgentLiveSessions } from "./hooks";

export const APPEARANCE_PATH = "/api/fawkes/appearance";
export const APPEARANCE_EVENT = "fawkes.appearance.changed";
/** The Pet Panel tab the desktop's "Wardrobe" menu entry opens (apps/desktop sends this route). */
export const WARDROBE_ROUTE = "/panel/wardrobe";

/** GET /api/fawkes/appearance. */
export interface Appearance {
  outfit: string;
  hemisphere: "north" | "south";
  packs: OutfitPack[];
  sources: Record<string, SourceStyle>;
  builtin: { id: string; name: string; season: string }[];
  known: { id: string; label: string; kind: "agent" | "capability" }[];
  glyphs: string[];
  limits: { packs: number; pack_bytes: number; sources: number };
}

export const NO_APPEARANCE: Appearance = {
  outfit: "none",
  hemisphere: "north",
  packs: [],
  sources: {},
  builtin: [],
  known: [],
  glyphs: [],
  limits: { packs: 8, pack_bytes: 200_000, sources: 64 },
};

/**
 * The appearance, reloaded whenever Core says it changed, so the navbar, the panel, the floating
 * pet and the island all update live. A Core without the route (or any failure) means "no outfit,
 * default pills": appearance is cosmetic and never blocks Fawkes.
 */
export function useAppearance() {
  const client = useClient();
  const [data, setData] = useState<Appearance>(NO_APPEARANCE);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await client.request<Appearance>("GET", APPEARANCE_PATH));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    }
  }, [client]);

  useEffect(() => {
    void reload();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (event.event_type === APPEARANCE_EVENT) void reload();
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      offEvent();
      offStatus();
    };
  }, [client, reload]);

  return { data, error, reload };
}

/** The outfit to draw on Fawkes right now (null: none). `now` is injectable for the seasons. */
export function useWornOutfit(now: () => Date = () => new Date()): OutfitPack | null {
  const { data } = useAppearance();
  const month = now().getMonth();
  return useMemo(
    () => resolveOutfit(data.outfit, data.hemisphere, data.packs, now()),
    // `month` stands for the clock: the season only changes with the month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.outfit, data.hemisphere, data.packs, month],
  );
}

/** One pill: a source that is active now and that the user wants to see. */
export interface Pill {
  id: string;
  label: string;
  colour: string;
  glyph: SourceStyle["glyph"];
}

/**
 * Pills for what is active right now: coding-agent sessions that are working, and capabilities with a
 * running task. A source the user hid ("show in Fawkes" off) never appears.
 */
export function useActivePills(): Pill[] {
  const { data } = useAppearance();
  const tasks = useTasks();
  const { sessions } = useAgentLiveSessions();
  return useMemo(() => {
    const active: string[] = [];
    for (const s of sessions) if (s.active) active.push(`agent:${s.agent}`);
    for (const t of tasks) if (t.source !== "core") active.push(`capability:${t.source}`);
    const pills: Pill[] = [];
    for (const id of new Set(active)) {
      const style = data.sources[id] ?? defaultSourceStyle(id);
      if (!style.show) continue;
      const label = data.known.find((k) => k.id === id)?.label ?? id.slice(id.indexOf(":") + 1);
      pills.push({ id, label, colour: style.colour, glyph: style.glyph });
    }
    return pills;
  }, [data, tasks, sessions]);
}
