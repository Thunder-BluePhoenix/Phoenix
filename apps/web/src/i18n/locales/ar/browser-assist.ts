// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "اطلب من فوكس مساعدتك في هذه الصفحة",
  "browser.assist.title": "اطلب من فوكس مساعدتك في هذه الصفحة",
  "browser.assist.goalLabel": "ما الذي تريد إنجازه في هذه الصفحة؟",
  "browser.assist.goalPlaceholder": "مثال: أضف العنصر الأزرق إلى السلة",
  "browser.assist.propose": "اقترح خطوات",
  "browser.assist.proposing": "جارٍ سؤال النموذج المحلي…",
  "browser.assist.close": "إغلاق المساعد",
  "browser.assist.goalTooLong": "يمكن أن يصل الهدف إلى {max} حرفًا كحد أقصى.",
  "browser.assist.goalControl": "لا يمكن أن يحتوي الهدف على أحرف تحكم.",
  "browser.assist.goalHidden": "لا يمكن أن يحتوي الهدف على أحرف اتجاه النص أو أحرف بعرض صفري.",
  "browser.assist.requestFailed": "تعذر الوصول إلى المساعد. لم يتم تشغيل أي شيء.",
  "browser.assist.busy":
    "المساعد لا يزال يعمل على طلب آخر. انتظر قليلًا ثم أعد المحاولة. لم يتم تشغيل أي شيء.",
  "browser.assist.noLocalModel":
    "لا يوجد نموذج على الجهاز، لذا لم يقرأ فوكس هذه الصفحة. لا يُرسل نص الصفحة إلى أي خدمة سحابية أبدًا.",
  "browser.assist.localModelFailed":
    "فشل النموذج على الجهاز. لم يتم تشغيل أي شيء ولم يُرسل شيء إلى أي مكان آخر.",
  "browser.assist.noBrowser": "لا يحتوي تطبيق فينيكس هذا على متصفح لقراءة صفحة منه.",
  "browser.assist.inert":
    "اقترحه نموذج محلي قرأ هذه الصفحة. لم يتم تشغيل أي شيء. هذه الخطوات نص عادي وقد تكون خاطئة.",
  "browser.assist.forPage": "للصفحة: {url}",
  "browser.assist.dropped":
    "{count, plural, one {تم رفض اقتراح واحد من النموذج ولن يظهر.} other {تم رفض # من اقتراحات النموذج ولن تظهر.}}",
  "browser.assist.noSteps": "لم يقترح النموذج أي خطوات لهذه الصفحة.",
  "browser.assist.kind.click": "انقر",
  "browser.assist.kind.type": "اكتب في",
  "browser.assist.kind.submit": "أرسل النموذج",
  "browser.assist.typeText": "النص: {text}",
  "browser.assist.modelWritten": "كتبه النموذج المحلي، وليس أنت",
  "browser.assist.run": "شغّل هذه الخطوة",
  "browser.assist.step.running": "بانتظار موافقتك…",
  "browser.assist.step.done": "تم. لم يتم تشغيل أي شيء آخر.",
  "browser.assist.refused.noTab": "لا توجد علامة تبويب نشطة لتشغيل هذه الخطوة.",
  "browser.assist.refused.moved":
    "لم تعد علامة التبويب على الصفحة التي اقترحت لها هذه الخطوات. اطلب مرة أخرى.",
  "browser.assist.failed.denied": "رفضت هذه الخطوة.",
  "browser.assist.failed.blocked": "رفض فينيكس هذه الخطوة (الصفحة أو عنصر التحكم غير مسموح).",
  "browser.assist.failed.unavailable": "تعذر الوصول إلى المتصفح.",
  "browser.assist.failed.timeout": "انتهت مهلة الخطوة. ربما تم تشغيلها وربما لا.",
  "browser.assist.failed.failed": "لم تُشغَّل الخطوة.",
};
