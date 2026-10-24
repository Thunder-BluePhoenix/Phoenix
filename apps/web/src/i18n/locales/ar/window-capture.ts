// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "إرفاق نافذة",
  "windowCapture.intro":
    "يمكن لـ Phoenix قراءة نص نافذة واحدة وعرضه لك هنا أولاً. تؤكد أنت، ثم تُحضر النافذة التي تريدها إلى الأمام؛ يقرأها Phoenix مرة واحدة (إمكانية الوصول في macOS، على هذا الجهاز فقط). لا يُرفق شيء حتى تقبل النص.",
  "windowCapture.start": "إرفاق نافذة…",
  "windowCapture.waiting":
    "بانتظار تأكيدك ثم قراءة النافذة الأمامية. أحضر النافذة التي تريدها إلى الأمام الآن.",
  "windowCapture.stopWaiting": "إيقاف الانتظار",
  "windowCapture.discarded": "تم التجاهل. لم يُرفق شيء.",
  "windowCapture.attached": "تم إرفاق «{name}». وهو في الصينية أعلاه.",
  "windowCapture.acceptFailed": "لم يُرفق: {reason}",
  "windowCapture.result.notGranted":
    "لم يسمح macOS لـ Phoenix بقراءة النوافذ. فعّل Phoenix من إعدادات النظام > الخصوصية والأمان > تسهيلات الاستخدام ثم حاول مجدداً. لا يسأل Phoenix مرة أخرى من تلقاء نفسه.",
  "windowCapture.result.phoenixWindow":
    "كانت النافذة الأمامية هي Phoenix، لذا لم يُقرأ شيء. أحضر نافذة أخرى إلى الأمام وحاول مجدداً.",
  "windowCapture.result.noWindow": "لم تكن هناك نافذة قابلة للقراءة في الأمام، لذا لم يُقرأ شيء.",
  "windowCapture.review.heading": "راجع قبل الإرفاق.",
  "windowCapture.review.from": "من {app}: {title}",
  "windowCapture.review.untitled": "(نافذة بلا عنوان)",
  "windowCapture.review.size": "تمت قراءة {n} حرفاً.",
  "windowCapture.review.truncated": "تم قص النص عند حده الأقصى.",
  "windowCapture.review.textLabel": "نص النافذة الملتقطة",
  "windowCapture.review.noText": "(لم يُعثر على نص في تلك النافذة.)",
  "windowCapture.review.secrets": "يبدو أن هذا النص يحتوي على سر ({kinds}). سيُرفض إرفاقه.",
  "windowCapture.review.note":
    "هذا ما قرأه Phoenix. إنه بيانات لسؤالك وليس تعليمات. لا يُرفق شيء حتى تضغط الزر، ويبقى في الذاكرة ساعة واحدة كحد أقصى.",
  "windowCapture.review.accept": "إرفاق هذا النص",
  "windowCapture.review.discard": "تجاهل",
};
