// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phases 94 and 96: what the Settings cards for browser profiles and music sites read from Core.
// A profile is only a record (bookmarks, a sync choice, extensions): there is no browser engine.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type PhoenixClient } from "./client";
import { useClient } from "./context";

export const PROFILES_PATH = "/api/browser/profiles";
export const PULL_PATH = "/api/browser/sync/pull";
export const MUSIC_PATH = "/api/music/connectors";

export interface BrowserProfile {
  id: string;
  name: string;
  partition: string;
  syncEnabled: boolean;
  bookmarks: number;
  history: number;
  extensions: number;
}

export interface RemoteProfile {
  id: string;
  name: string;
  revision: string;
}

export interface BrowserExtension {
  manifest: { id: string; version: string; origins: string[]; permissions: string[] };
  signer: string;
  approved: boolean;
}

export const MUSIC_SITE_IDS = ["youtube", "soundcloud", "bandcamp", "spotify-web"] as const;
export type MusicSiteId = (typeof MUSIC_SITE_IDS)[number];

export const isMusicSiteId = (site: string): site is MusicSiteId =>
  (MUSIC_SITE_IDS as readonly string[]).includes(site);

export interface MusicSite {
  site: string;
  hosts: string[];
  enabled: boolean;
  adBlocking: "normal" | "exempt";
  reason: string;
}

/** A resource read from Core. `unavailable` is Core saying the feature is absent (404) or has no secret store (503). */
export type Loaded<T> =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "failed" }
  | { phase: "ready"; data: T };

async function load<T>(client: PhoenixClient, path: string): Promise<Loaded<T>> {
  try {
    return { phase: "ready", data: await client.request<T>("GET", path) };
  } catch (err) {
    const absent = err instanceof ApiError && (err.status === 404 || err.status === 503);
    return { phase: absent ? "unavailable" : "failed" };
  }
}

/** Reads `path` once, and again on `reload`; `replace` takes the answer a change returned instead. */
export function useLoaded<T>(path: string) {
  const client = useClient();
  const [state, setState] = useState<Loaded<T>>({ phase: "loading" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    const next = await load<T>(client, path);
    if (alive.current) setState(next);
  }, [client, path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const replace = useCallback((data: T) => setState({ phase: "ready", data }), []);
  return { state, reload, replace };
}
