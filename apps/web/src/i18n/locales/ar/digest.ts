// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "ملخص يومي",
  "digest.yesterday": "أمس",
  "digest.today": "اليوم (خطط مؤكدة)",
  "digest.blockers": "العوائق",
  "digest.endOfDay": "نهاية اليوم",
  "digest.source": "المصدر",
  "digest.none": "لا يوجد نشاط مرتبط",
  "digest.date": "التاريخ",
  "digest.localNote": "أُنشئ محليًا من النشاط المرتبط. لم يُستخدم نموذج سحابي.",
  "digest.error": "تعذر تحميل الملخص أو نسخه.",
  "digest.loading": "جارٍ تحميل الملخص…",
  "digest.copy": "نسخ مع المصادر",
  "digest.copied": "تم النسخ",
  "digest.sendUnavailable": "الإرسال إلى Slack وTeams غير متاح حتى ربط تكامل معتمد.",
  "digest.back": "العودة إلى الملخص",
  "digest.eventTitle": "دليل الحدث",
  "digest.eventMissing": "لم يعد هذا الحدث متاحًا.",
  "digest.unverified": "غير موثّق: هذا ادعاء حدث مخزّن محليًا وليس دليلًا موثّقًا من المزوّد.",
  "digest.commitTitle": "الإيداع",
  "digest.commitMissing": "هذا الإيداع ليس في مستودع مراقَب.",
  "digest.noneIncomplete": "لم يُعثر على شيء في المصادر التي أمكن قراءتها.",
  "digest.noticeHeading": "ملخص غير مكتمل",
  "digest.noticeUnavailable": "تعذرت القراءة، لذا قد ينقص الملخص نشاط: {sources}.",
  "digest.noticePartial": "قُرئت أحدث السجلات فقط، وقد ينقص النشاط الأقدم: {sources}.",
  "digest.noticeUnattributed":
    "لم تُضبط هوية git (user.email)، لذا استُبعدت الإيداعات بدل عرضها كأنها عملك: {sources}.",
  "digest.sources.git": "مستودعات git",
  "digest.sources.events": "سجل الأحداث",
  "digest.sources.sessions": "جلسات الوكيل",
  "digest.sources.meetings": "الاجتماعات",
};
