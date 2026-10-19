// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
export { I18nProvider, useLocale, useT } from "./I18nProvider";
export type { I18nProviderProps, LocaleInfoNow } from "./I18nProvider";
export type { Messages, MessageKey } from "./en";
export { isMessageKey, type RichVars, type Translate } from "./store";
export type { Vars } from "./icu";
export {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  LOCALES,
  PSEUDO_LOCALE,
  isLocale,
  type ActiveLocale,
  type Locale,
  type LocaleInfo,
} from "./supported";
