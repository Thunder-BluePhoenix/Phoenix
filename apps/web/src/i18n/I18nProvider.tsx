// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useSavedLocale } from "../core/ui-settings";
import { activate, getActive, makeTranslate, subscribeActive, type Translate } from "./store";
import { dirOf, PSEUDO_LOCALE, type ActiveLocale } from "./supported";

export interface I18nProviderProps {
  /**
   * Show this language and ignore Core's. For tests and dev builds, where it also allows the
   * pseudo-locale "en-XA"; a production build ignores it.
   */
  forceLocale?: ActiveLocale;
  children: ReactNode;
}

/**
 * Shows the app in the language saved in Core (`ui.locale`), and sets `lang` and `dir` on the
 * document so screen readers, hyphenation, fonts and the right-to-left layout follow. Must sit
 * inside CoreProvider. English is shown until the saved language has loaded.
 */
export function I18nProvider({ forceLocale, children }: I18nProviderProps) {
  const saved = useSavedLocale();
  const forced = import.meta.env.DEV || forceLocale !== PSEUDO_LOCALE ? forceLocale : undefined;
  const wanted = forced ?? saved;
  useEffect(() => {
    if (wanted) void activate(wanted);
  }, [wanted]);
  const { locale } = useSyncExternalStore(subscribeActive, getActive);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale === PSEUDO_LOCALE ? "en" : locale;
    root.dir = dirOf(locale);
  }, [locale]);
  return <>{children}</>;
}

/** The translate function for the language on screen; the component re-renders when it changes. */
export function useT(): Translate {
  const state = useSyncExternalStore(subscribeActive, getActive);
  return useMemo(() => makeTranslate(state), [state]);
}

export interface LocaleInfoNow {
  locale: ActiveLocale;
  dir: "ltr" | "rtl";
}

/** The language on screen and its writing direction; re-renders when either changes. */
export function useLocale(): LocaleInfoNow {
  const { locale } = useSyncExternalStore(subscribeActive, getActive);
  return useMemo(() => ({ locale, dir: dirOf(locale) }), [locale]);
}
