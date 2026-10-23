// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "أصوات Fawkes",
  "sounds.intro":
    "نغمات قصيرة يصدرها Fawkes عند حدوث شيء. متوقفة افتراضيًا. يولّدها Phoenix نفسه ولا تُشغَّل أبدًا في الوضع الهادئ أو الساعات الهادئة أو عند كتم الصوت أو أثناء الإيقاف الطارئ أو في العرض التجريبي.",
  "sounds.enabled": "السماح لـ Fawkes بإصدار أصوات",
  "sounds.volume": "مستوى الصوت",
  "sounds.volumeValue": "{percent} بالمئة",
  "sounds.event.launch": "مرحبًا",
  "sounds.event.poke": "نكزة",
  "sounds.event.dizzy": "دوار",
  "sounds.event.recover": "تعافى",
  "sounds.event.completion": "اكتملت المهمة",
  "sounds.event.needsYou": "يحتاج إليك",
  "sounds.event.failure": "فشل شيء ما",
  "sounds.preview.legend": "استمع إلى صوت",
  "sounds.preview.play": "تشغيل: {name}",
  "sounds.preview.hint":
    "تُشغَّل المعاينة بمستوى الصوت أعلاه حتى لو كانت الأصوات متوقفة، وفقط بعد استخدامك للصفحة.",
  "sounds.preview.muted": "Fawkes مكتوم، لذلك لم يُشغَّل شيء.",
  "sounds.preview.silentVolume": "مستوى الصوت 0، لذلك لم يُشغَّل شيء.",
  "sounds.preview.quiet":
    "الوضع الهادئ أو الساعات الهادئة أو الإيقاف الطارئ أو العرض التجريبي قيد التشغيل، لذلك لم يُشغَّل شيء.",
  "sounds.preview.noGesture": "انقر أو اضغط مفتاحًا في الصفحة أولًا ثم أعد المحاولة.",
  "sounds.preview.failed": "تعذّر تشغيل الصوت على هذا الجهاز.",
  "sounds.saveFailed": "تعذّر حفظ إعدادات الصوت.",
  "sounds.loadFailed": "تعذّر تحميل إعدادات الصوت.",
  "sounds.note": "مجلد أصواتك الخاصة غير متاح بعد؛ تُستخدم فقط نغمات Phoenix المدمجة.",
};
