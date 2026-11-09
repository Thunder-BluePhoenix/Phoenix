// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "البحث عن موسيقى",
  "musicPlay.body": "Phoenix لا يشغّل أي شيء ولا يختار نتيجة. افتح صفحة البحث واختر نتيجة بنفسك.",
  "musicPlay.service": "الموقع: {service}",
  "musicPlay.query": "البحث عن: {query}",
  "musicPlay.open": "افتح صفحة البحث",
  "musicPlay.checking": "جارٍ التحقق من أن هذا الموقع مسموح…",
  "musicPlay.off": "{service} متوقف. شغّله في الإعدادات ضمن مواقع الموسيقى ثم اطلب مرة أخرى.",
  "musicPlay.failed": "تعذّر إنشاء عنوان البحث.",
  "musicPlay.refused.unknown_service":
    "يمكن البحث بهذه الطريقة في SoundCloud وBandcamp وYouTube فقط.",
  "musicPlay.refused.empty_query": "قل أو اكتب ما تريد البحث عنه.",
  "musicPlay.refused.too_long": "هذا البحث أطول من {max} حرفًا.",
  "musicPlay.refused.bad_characters": "يحتوي هذا البحث على أحرف غير مسموح بها.",
};
