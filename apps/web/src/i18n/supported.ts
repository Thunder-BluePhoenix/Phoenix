// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** One language Phoenix can show: its code, its own name for itself and its writing direction. */
export interface LocaleInfo {
  code: Locale;
  /** The language's name in that language: what the picker shows, so anyone can find theirs. */
  native: string;
  dir: "ltr" | "rtl";
}

/** English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian. */
export const LOCALE_CODES = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id"] as const;
export type Locale = (typeof LOCALE_CODES)[number];

/**
 * The pseudo-locale: every English message accented, 30% longer and bracketed, to spot untranslated
 * text and layouts that overflow. Dev and test builds only; never offered in the picker and never
 * accepted from Core.
 */
export const PSEUDO_LOCALE = "en-XA";
export type PseudoLocale = typeof PSEUDO_LOCALE;
export type ActiveLocale = Locale | PseudoLocale;

export const LOCALES: readonly LocaleInfo[] = [
  { code: "en", native: "English", dir: "ltr" },
  { code: "zh", native: "中文", dir: "ltr" },
  { code: "hi", native: "हिन्दी", dir: "ltr" },
  { code: "es", native: "Español", dir: "ltr" },
  { code: "ar", native: "العربية", dir: "rtl" },
  { code: "fr", native: "Français", dir: "ltr" },
  { code: "bn", native: "বাংলা", dir: "ltr" },
  { code: "pt", native: "Português", dir: "ltr" },
  { code: "ru", native: "Русский", dir: "ltr" },
  { code: "id", native: "Bahasa Indonesia", dir: "ltr" },
];

export const DEFAULT_LOCALE: Locale = "en";

const CODES: ReadonlySet<string> = new Set(LOCALE_CODES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && CODES.has(value);
}

/** Right-to-left for Arabic only; everything else, the pseudo-locale included, is left-to-right. */
export function dirOf(locale: ActiveLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** The tag to hand to `Intl`: the pseudo-locale formats like English. */
export function intlLocale(locale: ActiveLocale): string {
  return locale === PSEUDO_LOCALE ? "en" : locale;
}
