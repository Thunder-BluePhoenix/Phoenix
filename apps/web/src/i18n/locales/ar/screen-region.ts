// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "التقاط منطقة من الشاشة لبلاغ",
  "screenRegion.intro":
    "اختر «اختيار منطقة الشاشة»، ثم أكّد في «الموافقات»، ثم اسحب المنطقة المطلوبة بمحدّد النظام (مفتاح Esc يلغي). macOS فقط. تبقى الصورة في هذه الصفحة ولا تُحفظ. تُنشأ المشكلة نفسها نصًا فقط بعد موافقتك. وفي Linear وJira يمكنك بعد ذلك إرفاق الصورة المحجوبة بها في خطوة منفصلة بتأكيد خاص؛ أما GitHub فنص فقط.",
  "screenRegion.projectLabel":
    "مستودع GitHub (owner/name) أو معرّف فريق Linear أو مفتاح مشروع Jira",
  "screenRegion.linearTeamInvalid":
    "يشبه معرّف فريق Linear هذا: 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f؛ لم يُرسل شيء.",
  "screenRegion.jiraProjectInvalid":
    "مفتاح مشروع Jira حروف كبيرة وأرقام أو شرطات سفلية، مثل PROJ؛ لم يُرسل شيء.",
  "screenRegion.issuesUnavailable":
    "قدرة «متتبعات المشكلات» متوقفة أو تفتقد أمري الإنشاء والإرفاق، لذلك لم يُرسل شيء. فعّلها أولًا.",
  "screenRegion.issuesNoWriteCredential":
    "لا توجد بيانات اعتماد كتابة لـ {tracker} في «متتبعات المشكلات» (مفاتيح الاستعلام لا تُستخدم أبدًا للكتابة)، لذلك لم يُرسل شيء.",
  "screenRegion.issueKeyInvalid": "هذا ليس مفتاح مشكلة صالحًا؛ لم يُرسل شيء.",
  "focus.screenshot.textOnly":
    "تُنشأ المشكلة نصًا فقط ولا تتضمن اللقطة؛ في Linear وJira يمكنك عرضها منفصلة بعد ذلك.",
  "focus.screenshot.attach.title": "إرفاق اللقطة (اختياري)",
  "focus.screenshot.attach.intro":
    "أُنشئت مشكلة {tracker} {key} بدون الصورة. يمكنك الآن إرفاق اللقطة المحجوبة بها. هذا رفع منفصل يطلب Core موافقتك عليه مرة أخرى. لا يتلقى GitHub الصورة أبدًا.",
  "focus.screenshot.attach.prepare": "إظهار ما سيُرفق",
  "focus.screenshot.attach.details": "ما سيُرفق",
  "focus.screenshot.attach.tracker": "الخدمة: {tracker}",
  "focus.screenshot.attach.issue": "المشكلة: {key}",
  "focus.screenshot.attach.file": "اسم الملف: {name}",
  "focus.screenshot.attach.size": "الحجم: {bytes} بايت",
  "focus.screenshot.attach.hash": "بصمة المحتوى (SHA-256، أول 12 حرفًا): {hash}",
  "focus.screenshot.attach.redacted":
    "هذه هي الصورة كما حُجبت وعُلّقت في هذه الصفحة؛ الحجب مدمج فيها بالفعل. لم يُرسل شيء بعد.",
  "focus.screenshot.attach.confirm": "نعم، ارفع هذه الصورة إلى {tracker}",
  "focus.screenshot.attach.send": "طلب الموافقة والإرفاق",
  "focus.screenshot.attach.done": "أُرفقت اللقطة بـ {key}.",
  "focus.screenshot.attach.problem.badImage": "الصورة ليست PNG صالحة ولم تُرسل.",
  "focus.screenshot.attach.problem.tooLarge": "الصورة أكبر من 5 ميبيبايت ولم تُرسل.",
  "focus.screenshot.attach.problem.changed":
    "تغيّرت الصورة بعد مراجعتك لها؛ راجعها مجددًا. لم يُرسل شيء.",
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
};
