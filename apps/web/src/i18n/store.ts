// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The language the app is showing right now. One per page: the provider drives it from Core's
// `ui.locale`, React reads it with `useSyncExternalStore`, and plain code (the date and "5 min ago"
// helpers in core/format.ts) reads it directly, so one switch updates both.
import { createElement, Fragment, type ReactNode } from "react";
import { en, type Messages, type MessageKey } from "./en";
import { formatMessage, formatParts, type Vars } from "./icu";
import { intlLocale, PSEUDO_LOCALE, type ActiveLocale, type Locale } from "./supported";

/** What a locale provides at runtime: every key in a build that type-checks, but never trusted to. */
export type LoadedMessages = Readonly<Partial<Record<MessageKey, string>>>;

export interface ActiveI18n {
  locale: ActiveLocale;
  messages: LoadedMessages;
}

/** Variables a rich message accepts: text and numbers, and elements to place inside the text. */
export type RichVars = Readonly<Record<string, ReactNode>>;

/** `t("some.key", { name })`: the message in the active language, falling back to English. */
export interface Translate {
  (key: MessageKey, vars?: Vars): string;
  /** Like `t`, but a variable may be an element (a link, `<code>`) placed inside the sentence. */
  rich(key: MessageKey, vars: RichVars): ReactNode;
}

type Loader = () => Promise<{ default: Messages }>;

/** Each language is its own chunk, fetched when first chosen; English is bundled. */
const LOADERS: Readonly<Record<Exclude<Locale, "en">, Loader>> = {
  zh: () => import("./locales/zh"),
  hi: () => import("./locales/hi"),
  es: () => import("./locales/es"),
  ar: () => import("./locales/ar"),
  fr: () => import("./locales/fr"),
  bn: () => import("./locales/bn"),
  pt: () => import("./locales/pt"),
  ru: () => import("./locales/ru"),
  id: () => import("./locales/id"),
};

/**
 * The messages of a locale. A chunk that cannot be fetched (offline, a stale deployment) gives
 * English rather than a broken page; the pseudo-locale exists only in dev and test builds.
 */
export async function loadMessages(locale: ActiveLocale): Promise<LoadedMessages> {
  if (locale === "en") return en;
  try {
    if (locale === PSEUDO_LOCALE) {
      return import.meta.env.DEV ? (await import("./pseudo")).default : en;
    }
    return (await LOADERS[locale]()).default;
  } catch {
    return en;
  }
}

const ENGLISH: ActiveI18n = { locale: "en", messages: en };
let active: ActiveI18n = ENGLISH;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: ActiveI18n): void {
  active = next;
  for (const listener of listeners) listener();
}

export const subscribeActive = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getActive = (): ActiveI18n => active;

/**
 * Switches the app to `locale`. The previous language stays on screen until the new messages have
 * arrived, so there is never a flash of English; a newer switch cancels an older one still loading.
 */
export async function activate(locale: ActiveLocale): Promise<void> {
  const mine = ++generation;
  if (locale === active.locale) return;
  const messages = await loadMessages(locale);
  if (mine === generation) publish({ locale, messages });
}

/** Back to English (the provider leaving the page; tests). */
export function resetActive(): void {
  generation += 1;
  if (active !== ENGLISH) publish(ENGLISH);
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

function source(state: ActiveI18n, key: MessageKey): string {
  return state.messages[key] ?? en[key] ?? key;
}

export function translate(key: MessageKey, vars: Vars = {}, state: ActiveI18n = active): string {
  return formatMessage(source(state, key), vars, intlLocale(state.locale));
}

export function makeTranslate(state: ActiveI18n): Translate {
  const t = (key: MessageKey, vars: Vars = {}) => translate(key, vars, state);
  const rich = (key: MessageKey, vars: RichVars): ReactNode =>
    formatParts<ReactNode>(source(state, key), vars, intlLocale(state.locale)).map((part, i) =>
      createElement(Fragment, { key: i }, part),
    );
  return Object.assign(t, { rich });
}
