// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSettings as enAwakeSettings } from "../../en/awake-settings";

/** Machine-translated; unreviewed. */
export const awakeSettings: Record<keyof typeof enAwakeSettings, string> = {
  "awakeSettings.title": "إبقاء الجهاز مستيقظًا",
  "awakeSettings.intro":
    "يمنع هذا الكمبيوتر من النوم لمدة محددة، مثلًا أثناء تشغيل عملية بناء أو وكيل. للجلسة نهاية دائمًا: من دقيقة واحدة إلى 7 أيام.",
  "awakeSettings.approval":
    "بدء الجلسة وتمديدها وإنهاؤها يطلب كلٌّ منها موافقتك أولًا في الموافقات. لا يتغير شيء حتى توافق.",
  "awakeSettings.off": "ميزة إبقاء الجهاز مستيقظًا متوقفة، لذا لا يمكن بدء أي جلسة.",
  "awakeSettings.enable": "تشغيل إبقاء الجهاز مستيقظًا",
  "awakeSettings.status.title": "الجلسة الحالية",
  "awakeSettings.status.idle": "لا توجد جلسة قيد التشغيل. ينام الكمبيوتر كالمعتاد.",
  "awakeSettings.status.unreadable": "تعذّرت قراءة حالة إبقاء الجهاز مستيقظًا.",
  "awakeSettings.status.mode.timed": "(بمدة محددة)",
  "awakeSettings.status.mode.agents_grace": "(أثناء عمل الوكلاء)",
  "awakeSettings.status.label": "التسمية: {label}",
  "awakeSettings.end.button": "إنهاء الجلسة",
  "awakeSettings.start.title": "بدء جلسة",
  "awakeSettings.start.durations": "مدد جاهزة",
  "awakeSettings.start.minutes": "الدقائق",
  "awakeSettings.start.label": "التسمية (اختياري)",
  "awakeSettings.start.labelInvalid":
    "يجب أن تتكون التسمية من 1 إلى {max} حرفًا، دون أحرف تحكم أو أحرف غير مرئية.",
  "awakeSettings.start.submit": "اطلب البدء",
  "awakeSettings.outcome.waiting": "بانتظار موافقتك في الموافقات…",
  "awakeSettings.outcome.succeeded.start": "تمت الموافقة: بدأت الجلسة.",
  "awakeSettings.outcome.succeeded.extend": "تمت الموافقة: أُضيف وقت إلى الجلسة.",
  "awakeSettings.outcome.succeeded.end": "تمت الموافقة: انتهت الجلسة.",
  "awakeSettings.outcome.denied": "لقد رفضت، لذا لم يتغير شيء.",
  "awakeSettings.outcome.blocked": "الإيقاف الطارئ مفعّل، لذا لم يتغير شيء.",
  "awakeSettings.outcome.timeout":
    "لم تتم الموافقة على الطلب في الوقت المحدد أو أُلغي، لذا لم يتغير شيء.",
  "awakeSettings.outcome.failed": "تعذّر على إبقاء الجهاز مستيقظًا تنفيذ ذلك: {message}",
};
