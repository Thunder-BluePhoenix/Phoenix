// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "إشارات هندسية",
  "signals.intro":
    "افحص تنبيهات الاعتماديات واختبارات عدم الاستقرار واتجاهات المدة واختلاف أسماء مفاتيح الإعدادات في المستودعات التي تختارها. القراءة لا تغيّر الملفات.",
  "signals.root": "مجلد المستودع",
  "signals.add": "مراقبة المجلد",
  "signals.remove": "إيقاف المراقبة",
  "signals.refresh": "تحقق الآن",
  "signals.empty": "لا توجد إشارات حالية للمستودعات المراقبة.",
  "signals.unconfigured": "اختر مجلد مستودع للبدء.",
  "signals.error": "تعذرت قراءة الإشارات الهندسية.",
  "signals.advisory": "تنبيه اعتماديات",
  "signals.flaky_test": "اختبار غير مستقر",
  "signals.duration_trend": "زيادة المدة",
  "signals.config_drift": "مفتاح إعداد مفقود",
  "signals.optin": "تتطلب الإشعارات الاستباقية موافقة صريحة وتحترم ساعات الهدوء والحد بالساعة.",
  "signals.privacy": "تُقارن أسماء المفاتيح فقط؛ ولا تُعرض القيم أبداً.",
  "signals.unknown.advisories":
    "لم يتم تقييم تنبيهات الاعتماديات (الحالة غير معروفة، وليست سليمة):",
  "signals.unknown.history":
    "لم يتم تقييم سجل الاختبارات واتجاهات المدة (الحالة غير معروفة، وليست سليمة):",
};
