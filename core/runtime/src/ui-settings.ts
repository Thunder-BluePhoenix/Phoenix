// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The interface language (Phase 70). One setting, `ui.locale`, in the settings store: the user's own
// choice, changed only through the session-token routes. Every view (web, floating pet, island,
// pill) reads it, so the language is the same everywhere.
import type { EventBus } from "@phoenix/event-bus";
import type { SettingsStore } from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";

export const UI_LOCALE_KEY = "ui.locale";
export const UI_SETTINGS_CHANGED = "ui.settings.changed";
/** English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian. */
export const UI_LOCALES = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_UI_LOCALE: UiLocale = "en";

export interface UiSettings {
  locale: UiLocale;
  /** The codes `locale` accepts, so a view never has to hard-code them. */
  supported: readonly UiLocale[];
}

const isUiLocale = (value: unknown): value is UiLocale =>
  typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);

export class UiSettingsRuntime {
  constructor(
    private readonly settings: SettingsStore,
    private readonly bus: EventBus,
  ) {}

  get(): UiSettings {
    const stored = this.settings.get<unknown>(UI_LOCALE_KEY, DEFAULT_UI_LOCALE);
    return { locale: isUiLocale(stored) ? stored : DEFAULT_UI_LOCALE, supported: UI_LOCALES };
  }

  set(input: unknown): UiSettings {
    const locale = (input as { locale?: unknown } | null)?.locale;
    if (!isUiLocale(locale)) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        `"locale" must be one of ${UI_LOCALES.join(", ")}`,
      );
    }
    this.settings.set(UI_LOCALE_KEY, locale);
    const result = this.bus.publish(
      createEvent({
        event_type: UI_SETTINGS_CHANGED,
        source: "core",
        severity: "info",
        payload: { locale },
      }),
    );
    if (!result.ok) throw result.error;
    return this.get();
  }
}
