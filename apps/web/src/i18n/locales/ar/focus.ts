// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "وضع التركيز",
  "focus.start": "بدء التركيز",
  "focus.stop": "إنهاء التركيز",
  "focus.minutes": "الدقائق (اتركه فارغًا بلا مؤقت)",
  "focus.remaining": "الدقائق المتبقية: {count}",
  "focus.active": "التركيز نشط",
  "focus.inactive": "التركيز متوقف",
  "focus.held": "الإشعارات المؤجلة: {count}",
  "focus.osDnd": "وضع عدم الإزعاج في النظام نشط",
  "focus.osUnknown": "حالة عدم الإزعاج غير متاحة",
  "focus.refresh": "تحديث حالة تركيز النظام",
  "focus.pomodoro": "بدء بومودورو",
  "focus.systemUnavailable":
    "ميزة عدم الإزعاج في النظام غير متاحة؛ وضع التركيز يتحكم فقط في إشعارات Phoenix.",
  "focus.screenshot.title": "لقطة شاشة إلى مشكلة",
  "focus.screenshot.capture": "اختر منطقة الشاشة…",
  "focus.screenshot.permission": "يلزم إذن تسجيل الشاشة.",
  "focus.screenshot.error": "تعذر إكمال الطلب: {error}",
  "focus.screenshot.box": "مربع",
  "focus.screenshot.arrow": "سهم",
  "focus.screenshot.text": "نص",
  "focus.screenshot.redact": "حجب نهائي",
  "focus.screenshot.annotationText": "نص التعليق",
  "focus.screenshot.project": "المستودع أو المشروع",
  "focus.screenshot.issueTitle": "عنوان المشكلة",
  "focus.screenshot.body": "وصف المشكلة",
  "focus.screenshot.preview": "معاينة المسودة",
  "focus.screenshot.create": "طلب الموافقة وإنشاء المشكلة",
  "focus.screenshot.draft": "مسودة مشكلة (لم تنشأ)",
  "focus.screenshot.attachment": "إرفاق اللقطة إذا كان مدعومًا",
  "focus.screenshot.noAttachment": "لا يدعم هذا النظام إرفاق الصور؛ لن ترسل الصورة.",
  "focus.screenshot.created": "أُنشئت المشكلة: {url}",
  "focus.screenshot.declined": "لم تتم الموافقة؛ لم يُرسل شيء.",
  "focus.screenshot.tracker": "متتبع المشكلات",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "بلاغ من صورة لديك",
  "focus.issueDraft.intro":
    "أفلت أو الصق أو اختر صورة PNG أو JPEG لديك بالفعل، واكتب البلاغ، وراجع بالضبط ما سيُرسل. لا يلتقط Phoenix شاشتك. لا يُنشأ البلاغ على GitHub إلا بعد تأكيدك هنا ثم مرة أخرى في الموافقات.",
  "focus.issueDraft.unavailable.capability":
    "تكامل GitHub غير مفعّل أو لا يستطيع إنشاء بلاغات، لذا لا يمكن إنشاء شيء.",
  "focus.issueDraft.unavailable.token":
    "لم يُعيَّن رمز كتابة GitHub لتكامل GitHub، لذا لا يمكن إنشاء شيء.",
  "focus.issueDraft.dropLabel": "أفلت صورة للبلاغ",
  "focus.issueDraft.dropHint": "أفلت أو الصق صورة PNG أو JPEG هنا، أو {choose}.",
  "focus.issueDraft.choose": "اختر صورة…",
  "focus.issueDraft.chooseLabel": "اختيار صورة للبلاغ",
  "focus.issueDraft.imageAlt": "صورة للبلاغ: {name}",
  "focus.issueDraft.imageRemove": "إزالة الصورة",
  "focus.issueDraft.oneImage": "أضف صورة واحدة في كل مرة.",
  "focus.issueDraft.imageRequired": "أضف صورة أولاً.",
  "focus.issueDraft.titleRequired": "اكتب عنواناً للبلاغ.",
  "focus.issueDraft.titleTooLong": "يمكن أن يحتوي العنوان على {max} حرفاً كحد أقصى.",
  "focus.issueDraft.bodyTooLong": "يمكن أن يحتوي الوصف على {max} حرفاً كحد أقصى.",
  "focus.issueDraft.secretInTitle":
    "يبدو أن العنوان يحتوي على كلمة مرور أو مفتاح أو رمز. أزله؛ لم يُرسل شيء.",
  "focus.issueDraft.secretInBody":
    "يبدو أن الوصف يحتوي على كلمة مرور أو مفتاح أو رمز. أزله؛ لم يُرسل شيء.",
  "focus.issueDraft.secretInBoth":
    "يبدو أن العنوان والوصف يحتويان على كلمة مرور أو مفتاح أو رمز. أزله؛ لم يُرسل شيء.",
  "focus.issueDraft.previewRepository": "المستودع: {repository}",
  "focus.issueDraft.previewTitle": "العنوان: {title}",
  "focus.issueDraft.previewBody": "الوصف، تماماً كما سيُرسل:",
  "focus.issueDraft.previewNoBody": "لن يُرسل أي وصف.",
  "focus.issueDraft.imageLocal":
    "الصورة ({name}) لا تُرسل. تُنشأ بلاغات GitHub من النص فقط؛ تبقى الصورة على هذا الجهاز ولا تُحفظ. أضفها إلى البلاغ بنفسك إن أردت.",
  "focus.issueDraft.approval":
    "لم يُنشأ شيء بعد. بعد الضغط على الزر يطلب Phoenix موافقتك في الموافقات قبل إرسال أي شيء إلى GitHub.",
  "focus.issueDraft.create": "طلب إنشاء البلاغ",
  "focus.issueDraft.waiting": "في انتظار موافقتك في الموافقات…",
  "focus.issueDraft.denied": "لقد رفضت؛ لم يُرسل شيء إلى GitHub.",
  "focus.issueDraft.blocked": "الإيقاف الطارئ مفعّل؛ لم يُرسل شيء إلى GitHub.",
  "focus.issueDraft.timeout": "لم تتم الموافقة على الطلب في الوقت المناسب أو أُلغي؛ لم يُرسل شيء.",
  "focus.issueDraft.failed": "تعذر إنشاء البلاغ: {message}",
};
