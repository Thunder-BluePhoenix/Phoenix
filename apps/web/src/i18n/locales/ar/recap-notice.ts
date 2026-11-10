// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { recapNotice as enrecapNotice } from "../../en/recap-notice";

/** Machine-translated; unreviewed. */
export const recapNotice: Record<keyof typeof enrecapNotice, string> = {
  "recapNotice.title": "إشعار الملخص الأسبوعي",
  "recapNotice.intro":
    "كل اثنين عند 09:00 بالتوقيت المحلي، يعرض إشعارًا واحدًا في قائمة إشعارات Phoenix نفسها بأعداد الأسبوع الماضي. متوقف افتراضيًا. النص ثابت ويتضمن أرقامًا فقط (دون أسماء أو مسارات أو عناوين)، ولا يستدعي أي نموذج ولا يرسل أي طلب شبكة، ويُتخطى خلال ساعات الهدوء الاستباقية ووضع الإشعارات الهادئ وأثناء الإيقاف الطارئ. إشعار واحد كحد أقصى في الأسبوع؛ وإذا لم يكن Phoenix قيد التشغيل يوم الاثنين فيُعرض مرة واحدة لاحقًا في الأسبوع نفسه.",
  "recapNotice.enable": "عرض إشعار الملخص الأسبوعي يوم الاثنين",
  "recapNotice.last": "آخر إشعار كان للأسبوع {week}.",
  "recapNotice.never": "لم يُعرض أي إشعار للملخص الأسبوعي بعد.",
  "recapNotice.error": "تعذّر تحميل إعداد إشعار الملخص الأسبوعي أو حفظه.",
  "recapNotice.midweek": "التفعيل في منتصف الأسبوع ينتظر يوم الاثنين التالي.",
};
