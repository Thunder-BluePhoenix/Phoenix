// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "التحضير للاجتماع",
  "calendar.disabled": "التقويم معطّل. فعّل قدرة التقويم لرؤية الاجتماعات القادمة.",
  "calendar.empty": "لا توجد اجتماعات قادمة.",
  "calendar.loading": "جارٍ قراءة الاجتماعات…",
  "calendar.error": "تعذّرت قراءة التقويم.",
  "calendar.refresh": "تحديث الاجتماعات",
  "calendar.prep": "التحضير",
  "calendar.decisions": "قرارات سابقة",
  "calendar.actions": "مهام مفتوحة",
  "calendar.noPrep": "لا توجد قرارات مراجعة أو مهام مفتوحة ذات صلة.",
  "calendar.notetaker": "بدء تدوين الملاحظات",
  "calendar.notetakerInfo": "لن يبدأ التسجيل إلا بعد اختيارك البدء ومنح الإذن.",
  "calendar.freeze": "تجميد النشر",
  "calendar.busy": "حدث خاص",
  "calendar.source": "من {meeting}",
  "calendar.unconfigured":
    "لم يتم ربط أي مزود تقويم. اربط Google أو Microsoft أو CalDAV أو تقويم macOS لعرض الاجتماعات.",
  "calendar.unavailable": "موجز التقويم غير متاح. لا يمكن عرض الاجتماعات القادمة وتجميد النشر.",
  "calendar.stale":
    "موجز التقويم قديم. لا يمكن الوثوق بالاجتماعات القادمة وتجميد النشر حتى يتم التحديث.",
  "calendar.lastChecked": "آخر قراءة ناجحة: {time}",
  "calendar.prepIncomplete": "التحضير غير مكتمل لبعض الاجتماعات.",
};
