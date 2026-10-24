// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { calendar as enCalendar } from "../../en/calendar";

/** Machine-translated; unreviewed. */
export const calendar: Record<keyof typeof enCalendar, string> = {
  "calendar.title": "Подготовка к встрече",
  "calendar.disabled": "Календарь выключен. Включите его, чтобы видеть предстоящие встречи.",
  "calendar.empty": "Предстоящих встреч нет.",
  "calendar.loading": "Загрузка встреч…",
  "calendar.error": "Не удалось прочитать календарь.",
  "calendar.refresh": "Обновить встречи",
  "calendar.prep": "Подготовка",
  "calendar.decisions": "Предыдущие решения",
  "calendar.actions": "Открытые задачи",
  "calendar.noPrep": "Нет подходящих проверенных решений или открытых задач.",
  "calendar.notetaker": "Начать запись заметок",
  "calendar.notetakerInfo": "Запись начнётся только после вашего выбора и разрешения.",
  "calendar.freeze": "Запрет развёртывания",
  "calendar.busy": "Частное событие",
  "calendar.source": "Из {meeting}",
  "calendar.unconfigured":
    "Поставщик календаря не подключён. Подключите Google, Microsoft или CalDAV, чтобы видеть встречи.",
  "calendar.unavailable":
    "Лента календаря недоступна. Предстоящие встречи и заморозки развёртывания показать нельзя.",
  "calendar.stale":
    "Лента календаря устарела. Встречам и заморозкам развёртывания нельзя доверять, пока она не обновлена.",
  "calendar.lastChecked": "Последнее успешное чтение: {time}",
  "calendar.prepIncomplete": "Подготовка к некоторым встречам неполная.",
};
