// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlancesB as enServiceGlancesB } from "../../en/service-glances-b";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlancesB: Record<keyof typeof enServiceGlancesB, string> = {
  "services.glance.resend.notConfigured":
    "أضف مفتاح واجهة Resend البرمجية في أسرار قدرة Resend لعرض حالة التسليم هنا.",
  "services.glance.resend.empty": "لا توجد رسائل بريد أُرسلت مؤخرًا لعدّها.",
  "services.glance.resend.summary":
    "{count, plural, zero {لا رسائل بريد حديثة} one {رسالة بريد حديثة واحدة} two {رسالتا بريد حديثتان} few {# رسائل بريد حديثة} many {# رسالة بريد حديثة} other {# رسالة بريد حديثة}}",
  "services.glance.resend.newest": "الأحدث: {time}",
  "services.glance.resend.privacy": "أعداد فقط. لا تُعرض هنا الموضوعات ولا المستلمون أبدًا.",
  "services.glance.resend.state.delivered": "تم التسليم",
  "services.glance.resend.state.inFlight": "في الطريق",
  "services.glance.resend.state.delayed": "متأخرة",
  "services.glance.resend.state.bounced": "مرتدة",
  "services.glance.resend.state.complained": "وُسمت كرسائل غير مرغوب فيها",
  "services.glance.resend.state.failed": "فشلت",
  "services.glance.resend.state.other": "أخرى",

  "services.glance.notion.notConfigured":
    "أضف رمز تكامل Notion في أسرار قدرة Notion لعرض الصفحات التي تراقبها هنا.",
  "services.glance.notion.empty":
    "لا توجد صفحات أو قواعد بيانات مراقَبة لعرضها. أدرجها بمعرّفاتها في إعدادات قدرة Notion.",
  "services.glance.notion.summary":
    "{count, plural, zero {لا عناصر مراقَبة} one {عنصر مراقَب واحد} two {عنصران مراقَبان} few {# عناصر مراقَبة} many {# عنصرًا مراقَبًا} other {# عنصر مراقَب}}",
  "services.glance.notion.privacy": "العناوين وأوقات التعديل فقط. لا تُقرأ محتويات الصفحات أبدًا.",
  "services.glance.notion.untitled": "بلا عنوان",
  "services.glance.notion.kind.page": "صفحة",
  "services.glance.notion.kind.database": "قاعدة بيانات",
  "services.glance.notion.kind.archived": "مؤرشفة",
  "services.glance.notion.edited": "عُدّلت {time}",
  "services.glance.notion.open": "فتح في Notion",
  "services.glance.notion.openNamed": "فتح {title} في Notion",

  "services.glance.calcom.notConfigured":
    "أضف مفتاح واجهة Cal.com البرمجية في أسرار قدرة Cal.com لعرض حجوزاتك هنا.",
  "services.glance.calcom.empty": "لا توجد حجوزات قادمة.",
  "services.glance.calcom.summary":
    "{count, plural, zero {لا حجوزات قادمة} one {حجز قادم واحد} two {حجزان قادمان} few {# حجوزات قادمة} many {# حجزًا قادمًا} other {# حجز قادم}}",
  "services.glance.calcom.privacy":
    "الأوقات وأعداد الحضور فقط. لا تُعرض هنا الأسماء ولا عناوين البريد الإلكتروني أبدًا.",
  "services.glance.calcom.booking": "حجز",
  "services.glance.calcom.status.accepted": "مؤكَّد",
  "services.glance.calcom.status.pending": "بانتظار التأكيد",
  "services.glance.calcom.status.other": "أخرى",
  "services.glance.calcom.attendees":
    "{count, plural, zero {لا حضور} one {مشارك واحد} two {مشاركان} few {# مشاركين} many {# مشاركًا} other {# مشارك}}",
  "services.glance.calcom.more":
    "{count, plural, zero {لا حجوزات أخرى} one {حجز آخر واحد} two {حجزان آخران} few {# حجوزات أخرى} many {# حجزًا آخر} other {# حجز آخر}}",
};
