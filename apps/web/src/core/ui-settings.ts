// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 70: the interface language, kept in Core (`ui.locale`) so every window of Phoenix shows the
// same one and it survives a reload.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";
import { isLocale, type Locale } from "../i18n/supported";

export const UI_SETTINGS_PATH = "/api/ui/settings";
export const UI_SETTINGS_EVENT = "ui.settings.changed";

/** GET/POST /api/ui/settings. */
export interface UiSettings {
  locale: Locale;
  supported: Locale[];
}

/** Tells the provider on this page that the user just saved a language (see `useSaveLocale`). */
const savedHere = new Set<(locale: Locale) => void>();
/** How many times the user has saved a language here; a read that started earlier is out of date. */
let savesHere = 0;

/**
 * The language saved in Core, or null until it is known (or when Core has none to give: an old Core
 * without the route). Follows `ui.settings.changed`, so a change made in another window applies
 * here without a reload, and is read again whenever the connection comes back.
 */
export function useSavedLocale(): Locale | null {
  const client = useClient();
  const [saved, setSaved] = useState<Locale | null>(null);

  useEffect(() => {
    let live = true;
    const reload = async () => {
      const startedAt = savesHere;
      try {
        const settings = await client.request<Partial<UiSettings>>("GET", UI_SETTINGS_PATH);
        // An answer that left Core before the user's own save would put the old language back.
        if (live && startedAt === savesHere && isLocale(settings.locale)) {
          setSaved(settings.locale);
        }
      } catch {
        // Not available (offline, an older Core): keep showing the language already on screen.
      }
    };
    void reload();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (event.event_type !== UI_SETTINGS_EVENT) return;
      const locale = event.payload.locale;
      if (live && isLocale(locale)) setSaved(locale);
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    const onSavedHere = (locale: Locale) => live && setSaved(locale);
    savedHere.add(onSavedHere);
    return () => {
      live = false;
      savedHere.delete(onSavedHere);
      offEvent();
      offStatus();
    };
  }, [client]);

  return saved;
}

/** Saves the language in Core; the provider then switches this window to it. `failed`: Core said no. */
export function useSaveLocale() {
  const client = useClient();
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const save = useCallback(
    async (locale: Locale): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setFailed(false);
      setSaved(false);
      try {
        await client.request("POST", UI_SETTINGS_PATH, { locale });
        savesHere += 1;
        for (const listener of savedHere) listener(locale);
        setSaved(true);
        return true;
      } catch (err) {
        if (!(err instanceof ApiError) && !(err instanceof TypeError)) throw err;
        setFailed(true);
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [client],
  );
  return { save, failed, saved };
}
