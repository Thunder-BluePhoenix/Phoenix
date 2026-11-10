// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "الصفحات المرسلة من متصفحك",
  "pageNotes.intro":
    "الصفحات التي اخترت إرسالها بإضافة متصفح Phoenix. الرابط والعنوان والنص المحدد كتبها الموقع، لذلك تُعرض كنص عادي. لا يفتحها Phoenix ولا يقرؤها ولا يرسلها إلى الذكاء الاصطناعي؛ احذف ما لا تريد الاحتفاظ به.",
  "pageNotes.loading": "جارٍ تحميل الصفحات…",
  "pageNotes.loadFailed": "تعذّر تحميل قائمة الصفحات.",
  "pageNotes.empty": "لم يتم إرسال أي صفحات.",
  "pageNotes.list": "الصفحات المرسلة من متصفحك",
  "pageNotes.untitled": "(بلا عنوان)",
  "pageNotes.received": "استُلمت {time}",
  "pageNotes.selection": "النص المحدد",
  "pageNotes.delete": "حذف",
  "pageNotes.deleteLabel": "حذف الصفحة {title}",
};
