// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { digest as endigest } from "../../en/digest";

/** Machine-translated; unreviewed. */
export const digest: Record<keyof typeof endigest, string> = {
  "digest.title": "Ежедневная сводка",
  "digest.yesterday": "Вчера",
  "digest.today": "Сегодня (подтверждённые планы)",
  "digest.blockers": "Препятствия",
  "digest.endOfDay": "Итоги дня",
  "digest.source": "Источник",
  "digest.none": "Нет связанных действий",
  "digest.date": "Дата",
  "digest.localNote": "Создано локально из связанных действий. Облачная модель не используется.",
  "digest.error": "Не удалось загрузить или скопировать сводку.",
  "digest.loading": "Загрузка сводки…",
  "digest.copy": "Копировать с источниками",
  "digest.copied": "Скопировано",
  "digest.sendUnavailable": "Отправка в Slack и Teams недоступна без одобренной интеграции.",
  "digest.back": "Назад к сводке",
  "digest.eventTitle": "Подтверждение события",
  "digest.eventMissing": "Это событие больше недоступно.",
  "digest.unverified":
    "Не проверено: это локально сохранённое утверждение о событии, а не подтверждение от провайдера.",
  "digest.commitTitle": "Коммит",
  "digest.commitMissing": "Этого коммита нет в отслеживаемом репозитории.",
  "digest.noneIncomplete": "В источниках, которые удалось прочитать, ничего не найдено.",
  "digest.noticeHeading": "Неполная сводка",
  "digest.noticeUnavailable":
    "Прочитать не удалось, поэтому в сводке может не хватать активности: {sources}.",
  "digest.noticePartial":
    "Прочитаны только новейшие записи, более старая активность может отсутствовать: {sources}.",
  "digest.noticeUnattributed":
    "Не настроена личность git (user.email), поэтому коммиты исключены, а не показаны как ваши: {sources}.",
  "digest.sources.git": "репозитории git",
  "digest.sources.events": "история событий",
  "digest.sources.sessions": "сессии агентов",
  "digest.sources.meetings": "встречи",
};
