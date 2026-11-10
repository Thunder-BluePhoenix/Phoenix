// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { pageNotes as enPageNotes } from "../../en/page-notes";

/** Machine-translated; unreviewed (see ../../README.md). */
export const pageNotes: Record<keyof typeof enPageNotes, string> = {
  "pageNotes.title": "Страницы, отправленные из браузера",
  "pageNotes.intro":
    "Страницы, которые вы решили отправить через расширение браузера Phoenix. Адрес, заголовок и выделенный текст написаны сайтом, поэтому показываются как обычный текст. Phoenix не открывает их, не читает и не отправляет ИИ; удалите то, что не хотите хранить.",
  "pageNotes.loading": "Загрузка страниц…",
  "pageNotes.loadFailed": "Не удалось загрузить список страниц.",
  "pageNotes.empty": "Страницы не отправлялись.",
  "pageNotes.list": "Страницы, отправленные из браузера",
  "pageNotes.untitled": "(без заголовка)",
  "pageNotes.received": "Получено {time}",
  "pageNotes.selection": "Выделенный текст",
  "pageNotes.delete": "Удалить",
  "pageNotes.deleteLabel": "Удалить страницу {title}",
};
