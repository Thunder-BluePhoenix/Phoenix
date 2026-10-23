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

/** Phase 59: whether Fawkes makes sounds and how loud, kept like `ui.locale` in the settings store. */
export const UI_SOUNDS_KEY = "ui.sounds";
/** Published after a change so every open window re-reads the sound settings. */
export const UI_SOUNDS_CHANGED = "ui.sounds.changed";
export interface UiSounds {
  /** Master switch. Off by default: Fawkes stays silent until the user turns sounds on. */
  enabled: boolean;
  /** Whole percent, 0..100. */
  volume: number;
}
export const DEFAULT_UI_SOUNDS: Readonly<UiSounds> = { enabled: false, volume: 60 };
const isVolume = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;

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

  /** The saved sound settings; a stored value that is not valid falls back field by field. */
  sounds(): UiSounds {
    const stored = this.settings.get<unknown>(UI_SOUNDS_KEY, null);
    const record =
      stored !== null && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
    return {
      enabled: record.enabled === true,
      volume: isVolume(record.volume) ? record.volume : DEFAULT_UI_SOUNDS.volume,
    };
  }

  setSounds(input: unknown): UiSounds {
    if (input === null || typeof input !== "object" || Array.isArray(input))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Expected an object");
    const change = input as Record<string, unknown>;
    const keys = Object.keys(change);
    if (keys.length === 0 || keys.some((k) => k !== "enabled" && k !== "volume"))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, 'Expected "enabled" and/or "volume"');
    if (change.enabled !== undefined && typeof change.enabled !== "boolean")
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"enabled" must be true or false');
    if (change.volume !== undefined && !isVolume(change.volume))
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"volume" must be a whole number 0 to 100');
    const next: UiSounds = { ...this.sounds(), ...(change as Partial<UiSounds>) };
    this.settings.set(UI_SOUNDS_KEY, next);
    // Every open window (the web page, the floating pet, the island) follows the change.
    const result = this.bus.publish(
      createEvent({
        event_type: UI_SOUNDS_CHANGED,
        source: "core",
        severity: "info",
        payload: { ...next },
      }),
    );
    if (!result.ok) throw result.error;
    return next;
  }
}
