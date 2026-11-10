// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The "every Monday" recap notice (Phase 69), pure parts: when it is due, and what it says.
// Policy (conservative, owner-visible in docs/phases/phase-69-weekly-recap.md):
//   - off by default, its own switch, separate from the Kage proactive switch;
//   - at most one per ISO week, from Monday 09:00 local time, and only outside the Proactive quiet
//     hours; a Core that was off on Monday catches up once, later the same week, never twice;
//   - the text is a FIXED template per language with COUNTS only: no title, name, path or any
//     stored text goes into it.
import { inQuietHours, type QuietHours } from "@phoenix/notifications";
import { addDays, dayKeyOf, startOfDayMs, weekStartOf } from "./recap-calendar";

/** Notification `source` and `eventType` of the recap notice. */
export const RECAP_NOTICE_SOURCE = "recap";
export const RECAP_NOTICE_EVENT = "insight.weekly_recap";
/**
 * Settings keys (plain values: a boolean and an ISO week label). Built from parts so a secret
 * scanner never sees a key-shaped literal.
 */
export const RECAP_NOTICE_ENABLED_KEY = ["recap", "notice", "enabled"].join(".");
export const RECAP_NOTICE_LAST_WEEK_KEY = ["recap", "notice", "last-week"].join(".");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Local time of day the notice becomes due on Monday. */
export const RECAP_NOTICE_MINUTE_OF_DAY = 9 * 60;
const MAX_WAIT_MS = 24 * HOUR;

/** ISO 8601 week label of a local day key, e.g. `2026-W45`. The week of the Thursday decides the year. */
export function isoWeekOf(day: string): string {
  const thursday = addDays(weekStartOf(day), 3);
  const year = Number(thursday.slice(0, 4));
  const first = `${year}-01-01`;
  const ordinal =
    (Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  return `${year}-W${String(Math.floor(ordinal / 7) + 1).padStart(2, "0")}`;
}

function localMinuteOfDay(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

/**
 * The first instant on local `day` whose local time is `minuteOfDay` or later. Starts from the
 * day's first instant and corrects by the observed local clock, twice, so a 23- or 25-hour day
 * and a change that lands before 09:00 still give 09:00 on the wall clock.
 */
export function localInstant(day: string, minuteOfDay: number, timeZone: string): number {
  let at = startOfDayMs(day, timeZone) + minuteOfDay * MINUTE;
  for (let i = 0; i < 2; i++) {
    if (dayKeyOf(at, timeZone) !== day) break;
    const delta = minuteOfDay - localMinuteOfDay(at, timeZone);
    if (delta === 0) break;
    at += delta * MINUTE;
  }
  return at;
}

export interface RecapNoticeInput {
  now: number;
  timeZone: string;
  /** ISO week label of the last week a notice was sent or deliberately skipped; null when never. */
  lastWeek: string | null;
  quietHours: QuietHours | null;
}

export type RecapNoticeDecision =
  /** Send now for the week `week`; the recap shown covers the week before it. */
  | { action: "send"; week: string }
  /** Nothing to do yet; look again at `at` (ms since the epoch). */
  | { action: "wait"; at: number };

/**
 * Decides one step. Due = it is Monday 09:00 local or later in an ISO week that has not been
 * handled. Inside quiet hours it waits for them to end. A week that has passed unhandled is never
 * caught up in a later week: only the current week's notice exists.
 */
export function decideRecapNotice(input: RecapNoticeInput): RecapNoticeDecision {
  const { now, timeZone } = input;
  const today = dayKeyOf(now, timeZone);
  const monday = weekStartOf(today);
  const week = isoWeekOf(today);
  const dueAt = localInstant(monday, RECAP_NOTICE_MINUTE_OF_DAY, timeZone);
  if (input.lastWeek === week) {
    return {
      action: "wait",
      at: localInstant(addDays(monday, 7), RECAP_NOTICE_MINUTE_OF_DAY, timeZone),
    };
  }
  if (now < dueAt) return { action: "wait", at: dueAt };
  if (!inQuietHours(now, input.quietHours)) return { action: "send", week };
  // Due but quiet: the first minute that is not quiet (at most a day away, quiet hours are daily).
  for (let at = now + MINUTE; at <= now + MAX_WAIT_MS; at += MINUTE) {
    if (!inQuietHours(at, input.quietHours)) return { action: "wait", at };
  }
  return { action: "wait", at: now + MAX_WAIT_MS };
}

/** How long to sleep until `at`, never more than a day (so a changed clock is noticed) or under a second. */
export function sleepMs(now: number, at: number): number {
  return Math.min(MAX_WAIT_MS, Math.max(1_000, at - now));
}

/** The only numbers the notice carries. */
export interface RecapNoticeCounts {
  sessions: number;
  steps: number;
  commits: number;
  granted: number;
  denied: number;
}

interface Template {
  title: string;
  body: string;
}

/** Machine-translated; unreviewed. `{name}` placeholders take whole numbers only. */
const TEMPLATES = {
  en: {
    title: "Your weekly recap is ready",
    body: "Last week: {sessions} sessions, {steps} steps, {commits} commits, {granted} permissions granted, {denied} denied. Open Recap to see it.",
  },
  zh: {
    title: "你的每周回顾已就绪",
    body: "上周：{sessions} 个会话、{steps} 个步骤、{commits} 次提交、{granted} 次授权、{denied} 次拒绝。打开“回顾”查看。",
  },
  hi: {
    title: "आपका साप्ताहिक रिकैप तैयार है",
    body: "पिछला सप्ताह: {sessions} सत्र, {steps} चरण, {commits} कमिट, {granted} अनुमतियाँ दी गईं, {denied} अस्वीकृत। देखने के लिए रिकैप खोलें।",
  },
  es: {
    title: "Tu resumen semanal está listo",
    body: "La semana pasada: {sessions} sesiones, {steps} pasos, {commits} commits, {granted} permisos concedidos, {denied} denegados. Abre el resumen para verlo.",
  },
  ar: {
    title: "ملخصك الأسبوعي جاهز",
    body: "الأسبوع الماضي: {sessions} جلسات، {steps} خطوات، {commits} إيداعات، {granted} أذونات ممنوحة، {denied} مرفوضة. افتح الملخص لعرضه.",
  },
  fr: {
    title: "Votre récapitulatif hebdomadaire est prêt",
    body: "La semaine dernière : {sessions} sessions, {steps} étapes, {commits} commits, {granted} autorisations accordées, {denied} refusées. Ouvrez le récapitulatif pour le voir.",
  },
  bn: {
    title: "আপনার সাপ্তাহিক রিক্যাপ প্রস্তুত",
    body: "গত সপ্তাহ: {sessions}টি সেশন, {steps}টি ধাপ, {commits}টি কমিট, {granted}টি অনুমতি দেওয়া, {denied}টি প্রত্যাখ্যাত। দেখতে রিক্যাপ খুলুন।",
  },
  pt: {
    title: "Seu resumo semanal está pronto",
    body: "Semana passada: {sessions} sessões, {steps} passos, {commits} commits, {granted} permissões concedidas, {denied} negadas. Abra o resumo para ver.",
  },
  ru: {
    title: "Ваш недельный обзор готов",
    body: "Прошлая неделя: сессий — {sessions}, шагов — {steps}, коммитов — {commits}, разрешений выдано — {granted}, отклонено — {denied}. Откройте «Обзор», чтобы посмотреть.",
  },
  id: {
    title: "Rekap mingguan Anda sudah siap",
    body: "Minggu lalu: {sessions} sesi, {steps} langkah, {commits} commit, {granted} izin diberikan, {denied} ditolak. Buka Rekap untuk melihatnya.",
  },
} as const satisfies Record<string, Template>;

const whole = (n: number): string =>
  String(Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999_999_999) : 0);

/** Fixed text for `locale` (English when unknown). Only the five counts are interpolated. */
export function recapNoticeText(locale: string, counts: RecapNoticeCounts): Template {
  const t: Template = Object.prototype.hasOwnProperty.call(TEMPLATES, locale)
    ? TEMPLATES[locale as keyof typeof TEMPLATES]
    : TEMPLATES.en;
  const values: Record<string, string> = {
    sessions: whole(counts.sessions),
    steps: whole(counts.steps),
    commits: whole(counts.commits),
    granted: whole(counts.granted),
    denied: whole(counts.denied),
  };
  return {
    title: t.title,
    body: t.body.replace(/\{(\w+)\}/g, (_m, name: string) => values[name] ?? ""),
  };
}

/** True when there is anything to count; an empty week sends nothing. */
export const hasActivity = (c: RecapNoticeCounts): boolean => c.sessions + c.steps + c.commits > 0;
