// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

import { translate, getActive } from "../i18n/store";
import { intlLocale, type ActiveLocale } from "../i18n/supported";
import type { MessageKey } from "../i18n/en";

/**
 * Every helper here formats for the language on screen unless it is given one. A component that
 * calls them without `useT()` or `useLocale()` also has to re-render when the language changes;
 * calling `useLocale()` (and passing its `locale`) does that.
 */
const tag = (locale?: ActiveLocale): string => intlLocale(locale ?? getActive().locale);

const formats = new Map<
  string,
  Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat
>();
function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
  id: string,
  make: () => T,
): T {
  let hit = formats.get(id) as T | undefined;
  if (!hit) {
    hit = make();
    formats.set(id, hit);
  }
  return hit;
}

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14:03:09" / "2:03:09 PM", in the order and digits of the language; "" for a bad date. */
export function formatTime(iso: string, locale?: ActiveLocale): string {
  const d = parse(iso);
  if (!d) return "";
  const t = tag(locale);
  return cached(
    `time:${t}`,
    () => new Intl.DateTimeFormat(t, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  ).format(d);
}

/** "Oct 9, 2026", in the order and script of the language; "" for a bad date. */
export function formatDate(iso: string, locale?: ActiveLocale): string {
  const d = parse(iso);
  if (!d) return "";
  const t = tag(locale);
  return cached(`date:${t}`, () => new Intl.DateTimeFormat(t, { dateStyle: "medium" })).format(d);
}

/** A number with the grouping, decimal mark and digits of the language. */
export function formatNumber(n: number, locale?: ActiveLocale, options?: Intl.NumberFormatOptions) {
  const t = tag(locale);
  if (options) return new Intl.NumberFormat(t, options).format(n);
  return cached(`number:${t}`, () => new Intl.NumberFormat(t)).format(n);
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 1000],
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["month", 2_592_000_000],
  ["year", 31_536_000_000],
];

/** "5 minutes ago" / "in 2 hours" / "now", as a full phrase in the language; "" for a bad date. */
export function formatRelative(iso: string, now: number = Date.now(), locale?: ActiveLocale) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const diff = at - now;
  let step = RELATIVE_STEPS[0]!;
  for (const candidate of RELATIVE_STEPS) {
    if (Math.abs(diff) >= candidate[1]) step = candidate;
  }
  const t = tag(locale);
  const rtf = cached(`relative:${t}`, () => new Intl.RelativeTimeFormat(t, { numeric: "auto" }));
  return rtf.format(Math.round(diff / step[1]), step[0]);
}

/** "just now", "3 min", "2 h", "4 d" */
export function formatSince(iso: string, now: number = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 45_000) return translate("common.time.justNow");
  const min = Math.round(ms / 60_000);
  if (min < 60) return translate("common.time.minutes", { n: formatNumber(min) });
  const h = Math.round(min / 60);
  if (h < 48) return translate("common.time.hours", { n: formatNumber(h) });
  return translate("common.time.days", { n: formatNumber(Math.round(h / 24)) });
}

/** "just now", "3 min ago", "2 h ago": formatSince as a complete phrase. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const since = formatSince(iso, now);
  return since === translate("common.time.justNow")
    ? since
    : translate("common.time.ago", { since });
}

/**
 * A table whose values are read through `translate` each time, so `SEVERITY_LABEL[s]` is always in
 * the language on screen (a component re-renders on a language change through `useT()`).
 */
export function translated(keys: Readonly<Record<string, MessageKey>>): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [name, key] of Object.entries(keys)) {
    Object.defineProperty(table, name, { enumerable: true, get: () => translate(key) });
  }
  return table;
}

export const SEVERITY_LABEL = translated({
  info: "common.severity.info",
  success: "common.severity.success",
  warning: "common.severity.warning",
  error: "common.severity.error",
});

export const SIDE_EFFECT_LABEL = translated({
  none: "common.sideEffect.none",
  read: "common.sideEffect.read",
  write: "common.sideEffect.write",
  execute: "common.sideEffect.execute",
  external: "common.sideEffect.external",
  production: "common.sideEffect.production",
});

/**
 * An http(s) URL that is safe to link to, or null. A source reference is data from memory, so it is
 * only ever linked when it parses as a plain http(s) URL without embedded credentials; everything
 * else (file paths, commit ids, `javascript:` and `data:` URLs) stays text.
 */
export function safeHttpUrl(ref: string | null | undefined): string | null {
  if (!ref || ref.length > 2048 || /\s/.test(ref)) return null;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** Like safeHttpUrl, but only https: an address from another system is linked only when it is secure. */
export function safeHttpsUrl(ref: string | null | undefined): string | null {
  const url = safeHttpUrl(ref);
  return url !== null && url.startsWith("https:") ? url : null;
}
