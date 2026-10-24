// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 93: what the "Ad and tracker blocking" settings card reads from Core, and how the pure
// Shields model is built from it. There is no browser window yet, so nothing built here filters a
// real page.
import type { PhoenixClient } from "./client";
import { MUSIC_PATH, type MusicSite } from "./browser-profiles";
import { Shields, type ShieldsSettings } from "./browser/shields";

export const FILTER_LISTS_PATH = "/api/browser/filter-lists";
export const SHIELDS_PATH = "/api/browser/shields";

export interface FilterListView {
  id: string;
  title: string;
  purpose: "ads" | "trackers";
  homepage: string;
  /** The exact address an update contacts. */
  source: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  enabled: boolean;
  status: "never" | "ready" | "damaged";
  fetchedAt: string | null;
  bytes: number | null;
  sha256: string | null;
  version: string | null;
  listTitle: string | null;
  lastModified: string | null;
  refreshAfterDays: number | null;
  dueAt: string | null;
  rules: { network: number; exceptions: number; cosmetic: number } | null;
}

export interface FilterListsPayload {
  lists: FilterListView[];
  shields: ShieldsSettings;
}

interface ListText {
  id: string;
  text: string;
}

/**
 * A Shields model from what Core stores: the enabled lists' text, the user's switches, and the
 * music connector policy (so YouTube's exemption is read, not copied). A list that cannot be read
 * is skipped; with no list loaded the starter rules apply.
 */
export async function loadShields(client: PhoenixClient): Promise<Shields> {
  const { lists, shields } = await client.request<FilterListsPayload>("GET", FILTER_LISTS_PATH);
  const texts: ListText[] = [];
  for (const list of lists.filter((l) => l.enabled && l.status === "ready")) {
    try {
      texts.push(
        await client.request<ListText>(
          "GET",
          `${FILTER_LISTS_PATH}/${encodeURIComponent(list.id)}/text`,
        ),
      );
    } catch {
      // Skipped: the card shows the list's own status.
    }
  }
  let music: MusicSite[] = [];
  try {
    music = (await client.request<{ sites: MusicSite[] }>("GET", MUSIC_PATH)).sites;
  } catch {
    // No connector policy: no site is exempt, which is the stricter reading.
  }
  return new Shields({ settings: shields, lists: texts, music });
}
