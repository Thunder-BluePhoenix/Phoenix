// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "التقاط منطقة من الشاشة لبلاغ",
  "screenRegion.intro":
    "اختر «اختيار منطقة الشاشة»، وأكّد في «الموافقات»، ثم اسحب المنطقة المطلوبة بأداة التحديد في النظام (Esc يلغي). يعمل على macOS فقط. تبقى الصورة في هذه الصفحة ولا تُحفظ؛ ويُنشأ البلاغ كنص فقط على GitHub بعد موافقتك مرة أخرى.",
  "screenRegion.unavailable":
    "التقاط المنطقة متوقف. فعّل قدرة التقاط منطقة الشاشة واسمح بالتقاط الشاشة لاستخدامه. يعمل على macOS فقط.",
  "screenRegion.cancelled": "ألغيت التحديد، لذلك لم يُلتقط شيء.",
  "screenRegion.declined": "رفضت الطلب، لذلك لم يُلتقط شيء.",
  "screenRegion.blocked": "الإيقاف الطارئ مفعّل، لذلك لم يُلتقط شيء.",
  "screenRegion.timeout":
    "لم تُختر أي منطقة في الوقت المناسب أو لم تتم الموافقة على الطلب؛ لم يُلتقط شيء.",
  "screenRegion.failed": "تعذّر التقاط المنطقة: {message}",
  "screenRegion.badImage": "لم تكن اللقطة صورة PNG صالحة وتم تجاهلها.",
  "screenRegion.tooLarge": "المنطقة الملتقطة أكبر من 5 ميبيبايت وتم تجاهلها.",
  "screenRegion.unsupported": "التقاط المنطقة مدعوم على macOS فقط.",
  "screenRegion.expired": "لم تعد اللقطة متاحة. اختر منطقة مرة أخرى.",
  "screenRegion.trackerUnsupported":
    "GitHub وحده يمكنه إنشاء بلاغ من هنا؛ لا يستطيع Linear وJira ذلك بعد، لذلك لم يُرسل شيء.",
};
